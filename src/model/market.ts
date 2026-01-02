import type { Params } from './types';

export function getDemand(year: number, params: Params): number {
  const t = year - 2026;
  const growth = Math.max(0.25, params.demandGrowth + 0.20 - t * 0.015);
  return params.demand2025 * Math.pow(1 + growth, t);
}

/**
 * Calculate BTM share for a given year.
 * BTM share responds dynamically to interconnection pain and energy costs.
 */
export function getBtmShare(year: number, params: Params): number {
  const t = year - 2026;
  const queuePain = params.interconnect / 36;  // normalized to 36-month baseline
  const energyPain = params.energyCost / 0.065; // normalized to baseline
  const btmIncentive = (queuePain + energyPain) / 2;
  return Math.min(0.5, params.btmShare * btmIncentive + t * params.btmShareGrowth);
}

export function getGroundSupply(year: number, params: Params): number {
  const t = year - 2026;
  const yearBtmShare = getBtmShare(year, params);

  // Grid-connected capacity (slow - subject to interconnect delays)
  const gridDelay = params.interconnect / 12;
  const gridEffectiveT = Math.max(0, t - gridDelay);
  const annualGrowth = params.supplyGrowth * params.supply2025;
  const gridCapacity = (1 - yearBtmShare) * annualGrowth * gridEffectiveT;

  // BTM capacity (fast - only btmDelay)
  const btmDelay = params.btmDelay / 12;
  const btmEffectiveT = Math.max(0, t - btmDelay);
  const btmCapacity = yearBtmShare * annualGrowth * btmEffectiveT;

  let baseSupply = params.supply2025 + gridCapacity + btmCapacity;

  // SMR boost independent of space fission
  if (params.smrOn && year >= params.smrYear) {
    const smrMaturity = Math.min(1, (year - params.smrYear) / 5);
    const smrBoost = (10 + smrMaturity * 15) * (year - params.smrYear);
    baseSupply += smrBoost;
  }

  return baseSupply;
}

/**
 * Calculate demand pressure for Wright's Law learning rate coupling.
 * High demand = faster learning (more production volume).
 * Returns 0.2 to 2.0 multiplier.
 */
export function getDemandPressure(year: number, params: Params): number {
  const demand = getDemand(year, params);
  const supply = getGroundSupply(year, params);
  return Math.max(0.2, Math.min(2.0, demand / supply));
}
