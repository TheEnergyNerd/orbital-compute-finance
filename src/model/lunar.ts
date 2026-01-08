import type { Params, SimulationState, LunarReadinessDetails } from './types';

/**
 * Lunar Infrastructure Readiness Index
 *
 * Multi-factor readiness instead of single threshold.
 * Lunar unlocks when ready, not when arbitrary number hit.
 *
 * Key insight (The Efficiency Paradox):
 * If thermo/photonic is 1000x efficient, you need 1000x less mass for same compute.
 * Earth launch becomes "good enough forever." Lunar may never be needed.
 */

// Sigmoid function for smooth transitions
function sigmoid(x: number, x0: number, k: number = 4): number {
  return 1 / (1 + Math.pow(x0 / Math.max(x, 0.001), k));
}

// Thresholds (x0 = 50% readiness point)
// Realistic values based on fleet scaling:
// - 100k platforms × 1000kg = 100M kg cumulative mass
// - Global compute ~1000 Exaflops by 2040
// - Orbital power ~1 TW by 2040
const MASS_THRESHOLD = 500_000_000;       // 500k tonnes cumulative (500M kg)
const COMPUTE_THRESHOLD = 2000;            // 2,000 Exaflops global
const POWER_THRESHOLD = 5;                 // 5 TW orbital
const TIME_THRESHOLD = 2050;               // Calendar year maturity

// Weights
const W_MASS = 0.35;
const W_COMPUTE = 0.25;
const W_POWER = 0.20;
const W_TIME = 0.20;

// Mass driver cost once lunar is unlocked
export const MASS_DRIVER_COST_PER_KG = 5;  // $5/kg from lunar surface

/**
 * Calculate lunar infrastructure readiness index
 */
export function getLunarReadiness(
  state: SimulationState,
  params: Params
): LunarReadinessDetails {
  // Component scores
  const massScore = sigmoid(state.cumulativeMassToOrbitKg, MASS_THRESHOLD);
  const computeScore = sigmoid(state.globalComputeExaflops, COMPUTE_THRESHOLD);
  const powerScore = sigmoid(state.orbitalPowerTW, POWER_THRESHOLD);
  const timeScore = sigmoid(state.year, TIME_THRESHOLD, 8);  // Steeper

  // Tech modifiers
  let techBonus = 0;
  if (params.fissionOn && state.year >= params.fissionYear) techBonus += 0.15;
  if (params.fusionOn && state.year >= params.fusionYear) techBonus += 0.25;

  // Efficiency penalty (thermo/photonic reduce pressure for lunar)
  // This is the key insight: better efficiency = less need for lunar
  let efficiencyPenalty = 0;
  if (params.thermoOn && state.year >= params.thermoYear) efficiencyPenalty += 0.20;
  if (params.photonicOn && state.year >= params.photonicYear) efficiencyPenalty += 0.10;

  const baseReadiness =
    W_MASS * massScore +
    W_COMPUTE * computeScore +
    W_POWER * powerScore +
    W_TIME * timeScore;

  const overallReadiness = Math.min(1.0, Math.max(0, baseReadiness + techBonus - efficiencyPenalty));

  // Status message
  let status: string;
  if (overallReadiness >= 0.7) {
    status = 'Ready for lunar infrastructure';
  } else if (efficiencyPenalty > 0.15 && massScore < 0.3) {
    status = 'Earth launch sufficient — high efficiency reduces expansion pressure';
  } else if (overallReadiness >= 0.4) {
    status = 'Building toward viability';
  } else {
    status = 'Not yet viable';
  }

  return {
    massScore,
    computeScore,
    powerScore,
    timeScore,
    techBonus,
    efficiencyPenalty,
    overallReadiness,
    status
  };
}

/**
 * Get lunar unlock year (when readiness first exceeds 70%)
 * Returns null if never reached, or year + 10 for build time
 */
export function getLunarUnlockYear(
  readinessHistory: { year: number; readiness: number }[]
): number | null {
  const thresholdYear = readinessHistory.find((r) => r.readiness >= 0.7)?.year;
  return thresholdYear ? thresholdYear + 10 : null;
}

/**
 * Get cislunar launch cost (collapses after lunar unlock)
 */
export function getCislunarLaunchCost(
  year: number,
  baseCost: number,
  lunarUnlockYear: number | null
): number {
  if (lunarUnlockYear && year >= lunarUnlockYear) {
    // After lunar unlock, cislunar platforms sourced from lunar materials
    return MASS_DRIVER_COST_PER_KG;
  }
  return baseCost;
}
