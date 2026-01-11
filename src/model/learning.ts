import type { Params, RnDBoost, SimulationState } from './types';
import { STARSHIP_PAYLOAD_KG } from './constants';

/**
 * AI R&D Acceleration Model
 *
 * More global compute → AI accelerates R&D → faster progress on everything.
 * Uses R&D stock (K) that compute feeds into with saturation.
 */

// Reference: 100 Exaflops (roughly 2026 baseline)
const C_REF = 100;
const ALPHA = 0.15;  // Growth rate
const DELTA = 0.02;  // Decay/diffusion rate
const K_MAX = 5.0;   // Cap at 500% max improvement

/**
 * Update R&D stock based on global compute (saturating log growth)
 */
export function updateRnDStock(globalComputeExaflops: number, prevK: number): number {
  // Log scaling with saturation
  const dK = ALPHA * Math.log10(1 + globalComputeExaflops / C_REF) - DELTA * prevK;
  const newK = Math.max(0, prevK + dK);
  return Math.min(newK, K_MAX);
}

/**
 * Apply R&D stock to improve parameters
 * Each parameter has its own sensitivity and cap
 */
export function applyRnDBoost(K: number): RnDBoost {
  return {
    chipEfficiencyMult: 1 + Math.min(K * 0.3, 1.5),      // Up to +150%
    solarEfficiencyMult: 1 + Math.min(K * 0.1, 0.3),     // Up to +30%
    manufacturingCostMult: Math.exp(-K * 0.2),           // Exponential decay
    launchLearnBoost: Math.min(K * 0.02, 0.08)           // Up to +8%
  };
}

/**
 * Demand-Coupled Launch Learning
 *
 * AI compute demand drives Starship flights, which accelerates launch learning curve.
 * Loop: AI demand → More platforms → More flights → Cheaper launch → Lower LCOC → More demand
 */

const BASELINE_FLIGHTS_PER_YEAR = 200;   // Non-compute Starship demand
const CADENCE_BOOST_THRESHOLD = 500;     // Flights/year where boost kicks in
const CADENCE_BOOST_MAX = 0.08;          // +8% max learning rate boost

export interface LaunchLearningResult {
  effectiveLaunchLearn: number;
  orbitalFlights: number;
  totalFlightsThisYear: number;
  cadenceBoost: number;
}

/**
 * Calculate launch learning rate boost from high flight cadence
 */
export function updateLaunchLearning(
  annualMassKg: number,
  params: Params
): LaunchLearningResult {
  // Flights needed this year for orbital compute
  const orbitalFlights = annualMassKg / STARSHIP_PAYLOAD_KG;

  // Total Starship flights (orbital compute + other demand)
  const totalFlightsThisYear = orbitalFlights + BASELINE_FLIGHTS_PER_YEAR;

  // Learning boost from high cadence
  const cadenceBoost = Math.min(
    CADENCE_BOOST_MAX,
    (totalFlightsThisYear / CADENCE_BOOST_THRESHOLD) * CADENCE_BOOST_MAX
  );

  const effectiveLaunchLearn = params.launchLearn + cadenceBoost;

  return {
    effectiveLaunchLearn,
    orbitalFlights,
    totalFlightsThisYear,
    cadenceBoost
  };
}

/**
 * Initialize simulation state
 */
export function initSimulationState(): SimulationState {
  return {
    year: 2026,
    cumulativeMassToOrbitKg: 0,
    cumulativeOrbitalFlights: 0,
    cumulativeSatellitesBuilt: 0,
    orbitalPowerTW: 0,
    fleetCapacityExaflops: 0,
    globalComputeExaflops: 100,  // 2026 baseline
    rndStock: 0,
    lunarReadiness: 0,
    effectiveLaunchLearnRate: 0.18,
    launchCostPerKg: 1500
  };
}
