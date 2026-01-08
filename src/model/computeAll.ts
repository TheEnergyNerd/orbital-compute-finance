import { YEARS, SCENARIOS } from './constants';
import type { Params, ScenarioResult, SimulationState, LunarReadinessDetails } from './types';
import { calcSatellite } from './satellite';
import { calcGround } from './ground';
import { calcFleet, resetFleetTracker } from './fleet';
import { updateRnDStock, updateLaunchLearning, initSimulationState } from './learning';
import { getLunarReadiness, getLunarUnlockYear } from './lunar';

/**
 * Get scenario-adjusted parameters
 */
export function getScenarioParams(
  scenario: string,
  baseParams: Params
): Params {
  const s = SCENARIOS[scenario] || SCENARIOS.baseline;
  return {
    ...baseParams,
    aiLearn: baseParams.aiLearn * s.learnMult,
    launchLearn: baseParams.launchLearn * s.launchLearnMult,
    thermalYear: baseParams.thermalYear + s.techYearOffset,
    fissionYear: baseParams.fissionYear + s.techYearOffset,
    fusionYear: baseParams.fusionYear + s.techYearOffset,
    demandGrowth: baseParams.demandGrowth * s.demandMult
  };
}

/**
 * Run a complete scenario calculation
 */
export function runScenario(
  scenario: string,
  baseParams: Params
): ScenarioResult {
  const params = getScenarioParams(scenario, baseParams);

  // Reset fleet tracker for fresh scenario
  resetFleetTracker();

  // First pass: calculate satellites and initial fleets
  const sats = YEARS.map((y) => calcSatellite(y, params));
  resetFleetTracker();  // Reset again for pre-fleets
  const preFleets = YEARS.map((y) => calcFleet(y, null, params));
  const preGnds = YEARS.map((y) => calcGround(y, 0, params));


  // Find crossover year
  const crossIdx = preFleets.findIndex(
    (f, i) => f.lcocEffective < preGnds[i].market
  );
  const crossoverYear = crossIdx >= 0 ? YEARS[crossIdx] : null;

  // Second pass: recalculate with crossover
  resetFleetTracker();  // Reset for final fleet calculation
  const fleets = YEARS.map((y) => calcFleet(y, crossoverYear, params));
  const gnds = YEARS.map((y, i) =>
    calcGround(y, fleets[i].totalPowerTw * 1000, params)
  );


  // Track simulation state through the years
  const states: SimulationState[] = [];
  const lunarReadinessDetails: LunarReadinessDetails[] = [];
  let prevState = initSimulationState();

  YEARS.forEach((year, i) => {
    const fleet = fleets[i];
    const gnd = gnds[i];

    // Update cumulative metrics
    const cumulativeMassToOrbitKg = prevState.cumulativeMassToOrbitKg + fleet.annualMassKg;
    const cumulativeOrbitalFlights = prevState.cumulativeOrbitalFlights + fleet.annualStarshipFlights;
    const cumulativeSatellitesBuilt = prevState.cumulativeSatellitesBuilt +
      (fleet.totalPlatforms - (i > 0 ? fleets[i - 1].totalPlatforms : 0));

    // Current metrics
    const orbitalPowerTW = fleet.totalPowerTw;
    const deliveredComputeExaflops = fleet.fleetTflops / 1e6;  // TFLOPS to Exaflops
    const groundComputeExaflops = gnd.groundSupply * 3;  // Rough: 3 Exaflops per GW
    const globalComputeExaflops = deliveredComputeExaflops + groundComputeExaflops;

    // Update R&D stock
    const rndStock = updateRnDStock(globalComputeExaflops, prevState.rndStock);

    // Update launch learning
    const launchLearning = updateLaunchLearning(fleet.annualMassKg, params);
    const effectiveLaunchLearnRate = launchLearning.effectiveLaunchLearn;

    // Calculate launch cost (simplified - could be enhanced)
    const t = year - 2026;
    const launchCostPerKg = Math.max(
      params.launchFloor,
      params.launchCost * Math.pow(1 - effectiveLaunchLearnRate, t)
    );

    const state: SimulationState = {
      year,
      cumulativeMassToOrbitKg,
      cumulativeOrbitalFlights,
      cumulativeSatellitesBuilt,
      orbitalPowerTW,
      deliveredComputeExaflops,
      globalComputeExaflops,
      rndStock,
      lunarReadiness: 0,  // Will be set below
      effectiveLaunchLearnRate,
      launchCostPerKg
    };

    // Calculate lunar readiness
    const lunarDetails = getLunarReadiness(state, params);
    state.lunarReadiness = lunarDetails.overallReadiness;

    states.push(state);
    lunarReadinessDetails.push(lunarDetails);
    prevState = state;
  });

  // Find lunar unlock year
  const readinessHistory = states.map((s) => ({ year: s.year, readiness: s.lunarReadiness }));
  const lunarUnlockYear = getLunarUnlockYear(readinessHistory);

  return { sats, fleets, gnds, crossoverYear, states, lunarUnlockYear, lunarReadinessDetails };
}

/**
 * Compute all three scenarios
 */
export function computeAll(params: Params): {
  aggressive: ScenarioResult;
  baseline: ScenarioResult;
  conservative: ScenarioResult;
} {
  return {
    aggressive: runScenario('aggressive', params),
    baseline: runScenario('baseline', params),
    conservative: runScenario('conservative', params)
  };
}
