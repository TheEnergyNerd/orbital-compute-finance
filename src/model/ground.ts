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
  // SMRs provide abundant, cheap, clean baseload power
  // Major impact: reduces energy costs significantly as fleet scales
  const hasSmr = params.smrOn && year >= params.smrYear;
  const smrMaturity = hasSmr ? Math.min(1, (year - params.smrYear) / 8) : 0;
  const smrDiscount = hasSmr
    ? 0.6 - 0.4 * smrMaturity  // 40% discount initially → 80% discount at maturity (8 years)
    : 1.0;

  // BTM share for this year
  const yearBtmShare = getBtmShare(year, params);

  // Hardware cost with WACC/CRF
  // GPU price declines ~16%/year (Moore's Law + competition)
  const gpuPrice = 25000 * Math.pow(0.84, t);
  // Server overhead (chassis, networking, power supplies) = 1.5x raw GPU cost
  // Note: /3 was wrong - that's depreciation, which CRF already handles
  const hwCapex = (gpuPrice * 1.5) / (gflopsW / 2800);

  // Apply capex premium for BTM portion
  const btmCapexOverhead = yearBtmShare * (params.btmCapexMult - 1);
  const hwCapexAdjusted = hwCapex * (1 + btmCapexOverhead);

  const groundHwLife = 5;
  const crfGround = getCRF(params.waccGround, groundHwLife);
  const hwCost = hwCapexAdjusted * crfGround;

  // Blended energy costs (grid vs BTM)
  // Fusion: If fusion is available, it provides ultra-cheap baseload power
  // This benefits ground datacenters significantly (abundant clean power)
  // Even before full commercial fusion, R&D spillovers reduce energy tech costs
  const hasFusion = params.fusionOn && year >= params.fusionYear;
  const fusionMaturity = hasFusion ? Math.min(1, (year - params.fusionYear) / 8) : 0;
  const fusionDiscount = hasFusion ? (0.4 - 0.3 * fusionMaturity) : 1.0;  // 60% → 90% discount at maturity
  
  // Combined energy technology discount (SMRs + fusion both reduce energy costs)
  const energyTechDiscount = smrDiscount * fusionDiscount;
  
  const gridEnergy = params.energyCost * Math.pow(1 + params.energyEscal, t) * energyTechDiscount;
  const btmEnergy = params.btmEnergyCost * energyTechDiscount; // BTM also benefits from cheaper energy tech
  const blendedEnergy = gridEnergy * (1 - yearBtmShare) + btmEnergy * yearBtmShare;

  const pue = Math.max(1.08, params.groundPue - t * 0.01);
  const enCost = (700 * 8760 * SLA * blendedEnergy * pue) / 1000;

  // Overhead: datacenter opex, staff, networking, real estate, profit margin
  // Declines over time as AI compute becomes commoditized
  // 2026: $0.50/hr (cloud premium) → 2050: $0.15/hr (commodity)
  const overheadBase = 0.50 * Math.pow(0.95, t);  // 5% annual decline
  const overheadFloor = 0.15;  // Minimum overhead (physical limits)
  const overhead = Math.max(overheadFloor, overheadBase) * 8760 * SLA;

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
    // Extreme scarcity: logarithmic growth (demand destruction slows price rise but doesn't stop it)
    // At 10x demand/supply: ~6x premium
    // At 100x demand/supply: ~10x premium
    // At 1000x demand/supply: ~14x premium
    premium = 4 + 2 * Math.log10(unmetRatio);
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
