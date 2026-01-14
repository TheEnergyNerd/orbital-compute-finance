import type { Params } from './types';

/**
 * Calculate global AI compute demand for a given year (in GW).
 * Uses exponential growth model with an early-years boost that tapers off.
 * 
 * @param year - Simulation year
 * @param params - Model parameters (uses demand2025, demandGrowth)
 * @returns Demand in GW
 */
export function getDemand(year: number, params: Params): number {
  // Exponential growth model using params.demandGrowth
  // Default 55% matches historical AI compute growth (~4x/year)
  const t = year - 2026;
  const baseGrowth = params.demandGrowth;  // Use param instead of hardcoded
  // Add early-years boost that tapers off
  const earlyBoost = Math.max(0, 0.10 * Math.exp(-t / 8));  // 10% extra initially, decays
  const growth = baseGrowth + earlyBoost;
  return params.demand2025 * Math.pow(1 + growth, t);
}

/**
 * Calculate BTM (behind-the-meter) share for a given year.
 * BTM share responds dynamically to interconnection pain and energy costs.
 * Higher interconnect delays and energy costs push more capacity to BTM.
 * 
 * @param year - Simulation year
 * @param params - Model parameters
 * @returns BTM share as fraction (0-0.5)
 */
export function getBtmShare(year: number, params: Params): number {
  const t = year - 2026;
  const queuePain = params.interconnect / 36;  // normalized to 36-month baseline
  const energyPain = params.energyCost / 0.065; // normalized to baseline
  const btmIncentive = (queuePain + energyPain) / 2;
  return Math.min(0.5, params.btmShare * btmIncentive + t * params.btmShareGrowth);
}

/**
 * Calculate ground datacenter supply for a given year (in GW).
 * Combines grid-connected capacity (slow, delayed by interconnect queue)
 * and BTM capacity (fast, only btmDelay).
 * 
 * SMR deployment provides multiplicative boost after smrYear.
 * 
 * @param year - Simulation year
 * @param params - Model parameters
 * @returns Ground supply in GW
 */
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
  // SMRs provide reliable, fast-to-deploy baseload power
  // Significantly accelerates datacenter buildout by eliminating grid bottlenecks
  if (params.smrOn && year >= params.smrYear) {
    const smrMaturity = Math.min(1, (year - params.smrYear) / 8);
    // Multiplicative boost: 20% → 100% extra supply capacity as SMRs mature
    const smrMultiplier = 1 + (0.2 + 0.8 * smrMaturity);
    baseSupply *= smrMultiplier;
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
