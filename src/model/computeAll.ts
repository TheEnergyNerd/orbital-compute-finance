import { YEARS, SCENARIOS } from './constants';
import type { Params, ScenarioResult } from './types';
import { calcSatellite } from './satellite';
import { calcGround } from './ground';
import { calcFleet } from './fleet';

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
    dropletYear: baseParams.dropletYear + s.techYearOffset,
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

  // First pass: calculate satellites and initial fleets
  const sats = YEARS.map((y) => calcSatellite(y, params));
  const preFleets = YEARS.map((y) => calcFleet(y, null, params));
  const preGnds = YEARS.map((y) => calcGround(y, 0, params));

  // Find crossover year
  const crossIdx = preFleets.findIndex(
    (f, i) => f.lcocEffective < preGnds[i].market
  );
  const crossoverYear = crossIdx >= 0 ? YEARS[crossIdx] : null;

  // Second pass: recalculate with crossover
  const fleets = YEARS.map((y) => calcFleet(y, crossoverYear, params));
  const gnds = YEARS.map((y, i) =>
    calcGround(y, fleets[i].totalPowerTw * 1000, params)
  );

  return { sats, fleets, gnds, crossoverYear };
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
