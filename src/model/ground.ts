import { SLA } from './constants';
import type { Params, GroundResult } from './types';
import { getGroundEfficiency } from './physics';
import { getDemand, getGroundSupply, getBtmShare } from './market';
import { getCRF } from './finance';

export function calcGround(
  year: number,
  orbitalSupplyGW: number,
  params: Params
): GroundResult {
  const t = year - 2026;
  const gflopsW = getGroundEfficiency(year, params);

  // SMR synergy: DECOUPLED from space fission - independent ground policy
  const hasSmr = params.smrOn && year >= params.smrYear;
  const smrDiscount = hasSmr
    ? 0.7 - Math.min(0.3, (year - params.smrYear) * 0.03)
    : 1.0;

  // BTM share for this year
  const yearBtmShare = getBtmShare(year, params);

  // Hardware cost with WACC/CRF
  const gpuPrice = 25000 * Math.pow(0.84, t);
  const hwCapex = (gpuPrice / 3) / (gflopsW / 2800);

  // Apply capex premium for BTM portion
  const btmCapexOverhead = yearBtmShare * (params.btmCapexMult - 1);
  const hwCapexAdjusted = hwCapex * (1 + btmCapexOverhead);

  const groundHwLife = 5;
  const crfGround = getCRF(params.waccGround, groundHwLife);
  const hwCost = hwCapexAdjusted * crfGround;

  // Blended energy costs (grid vs BTM)
  const gridEnergy = params.energyCost * Math.pow(1 + params.energyEscal, t) * smrDiscount;
  const btmEnergy = params.btmEnergyCost; // Stable, no escalation
  const blendedEnergy = gridEnergy * (1 - yearBtmShare) + btmEnergy * yearBtmShare;

  const pue = Math.max(1.08, params.groundPue - t * 0.01);
  const enCost = (700 * 8760 * SLA * blendedEnergy * pue) / 1000;

  // Overhead: datacenter opex, staff, networking, real estate, profit margin
  // $0.50/hr baseline reflects real cloud GPU pricing overhead
  const overhead = 0.50 * 8760 * SLA;

  // Utilization factor: datacenters don't run at 100% - typical 60-80%
  const utilization = 0.70;
  const base = (hwCost + enCost + overhead) / (8760 * SLA * utilization);

  // Market dynamics
  const demand = getDemand(year, params);
  const groundSupply = getGroundSupply(year, params);
  const totalSupply = groundSupply + orbitalSupplyGW;
  const unmetRatio = (demand - totalSupply) / totalSupply;

  // Revised scarcity premium with demand destruction and oversupply discount
  let premium: number;
  if (unmetRatio <= -0.3) {
    // Severe oversupply: price war (floor at 0.6x cost)
    premium = Math.max(0.6, 0.85 + unmetRatio);
  } else if (unmetRatio <= 0) {
    // Mild oversupply: slight discount
    premium = 1.0 + unmetRatio * 0.5;
  } else if (unmetRatio <= 0.3) {
    // Moderate scarcity: linear premium
    premium = 1 + unmetRatio * 4;
  } else if (unmetRatio <= 1.0) {
    // High scarcity: slower growth (demand destruction kicks in)
    premium = 2.2 + (unmetRatio - 0.3) * 2.5;
  } else {
    // Extreme scarcity: plateau (demand destruction dominates)
    premium = Math.min(6, 4 + (unmetRatio - 1) * 0.5);
  }

  // Carbon intensity
  const gridCarbon = 380 * Math.pow(0.97, t);
  const carbonPerTflop = gridCarbon * (pue / gflopsW) + 5;

  return {
    year,
    base,
    market: base * premium,
    premium,
    carbonPerTflop,
    gflopsW,
    demand,
    groundSupply,
    totalSupply,
    unmetRatio
  };
}
