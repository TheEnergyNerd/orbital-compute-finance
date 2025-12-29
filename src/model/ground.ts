import { SLA } from './constants';
import type { Params, GroundResult } from './types';
import { getGroundEfficiency } from './physics';
import { getDemand, getGroundSupply } from './market';
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

  // Hardware cost with WACC/CRF
  const gpuPrice = 25000 * Math.pow(0.84, t);
  const hwCapex = (gpuPrice / 3) / (gflopsW / 2800);
  const groundHwLife = 5; // 5 year hardware refresh cycle
  const crfGround = getCRF(params.waccGround, groundHwLife);
  const hwCost = hwCapex * crfGround; // Annualized hardware cost

  // Energy costs
  const energy =
    params.energyCost * Math.pow(1 + params.energyEscal, t) * smrDiscount;
  const pue = Math.max(1.08, params.groundPue - t * 0.01);
  const enCost = (700 * 8760 * SLA * energy * pue) / 1000;
  const overhead = 0.2 * 8760 * SLA;
  const base = (hwCost + enCost + overhead) / (8760 * SLA);

  // Market dynamics
  const demand = getDemand(year, params);
  const groundSupply = getGroundSupply(year, params);
  const totalSupply = groundSupply + orbitalSupplyGW;
  const unmetRatio = Math.max(0, (demand - totalSupply) / totalSupply);

  // Scarcity premium
  let premium: number;
  if (unmetRatio <= 0) premium = 1.0;
  else if (unmetRatio <= 0.5) premium = 1 + unmetRatio * 8;
  else if (unmetRatio <= 2) premium = 5 + (unmetRatio - 0.5) * 20;
  else premium = 35 + (unmetRatio - 2) * 15;

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
