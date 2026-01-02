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

  // First pass: calculate satellites and initial fleets
  const sats = YEARS.map((y) => calcSatellite(y, params));
  const preFleets = YEARS.map((y) => calcFleet(y, null, params));
  const preGnds = YEARS.map((y) => calcGround(y, 0, params));

  // Debug: log key values for crossover analysis
  if (scenario === 'baseline') {
    console.log('=== CROSSOVER DEBUG (Baseline) ===');
    console.log('Key params:', {
      opTemp: params.opTemp,
      solarEff: params.solarEff,
      radPen: params.radPen,
      launchLearn: params.launchLearn,
      launchFloor: params.launchFloor
    });
    [2030, 2031, 2032, 2033, 2034, 2035].forEach(y => {
      const idx = YEARS.indexOf(y);
      if (idx >= 0) {
        const sat = sats[idx];
        const fleet = preFleets[idx];
        const gnd = preGnds[idx];
        console.log(`${y}: orbitalLCOC=$${sat.lcoc.toFixed(2)}, effective=$${fleet.lcocEffective.toFixed(2)}, groundMarket=$${gnd.market.toFixed(2)}, cross=${fleet.lcocEffective < gnd.market}`);
      }
    });
  }

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
