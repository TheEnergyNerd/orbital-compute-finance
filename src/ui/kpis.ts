import type { ScenarioResult, GroundResult, FleetResult, SatelliteResult, SimulationState, LunarReadinessDetails } from '../model/types';
import type { Params } from '../model/types';
import { STEFAN_BOLTZMANN, SHELLS } from '../model/constants';
import { getLaunchCost } from '../model/physics';

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/**
 * Format delivered tokens per year in Petatokens for consistency
 */
function formatDeliveredTokens(tokens: number): string {
  const peta = tokens / 1e15;
  if (peta >= 100) {
    return peta.toFixed(0) + ' Peta';
  } else if (peta >= 10) {
    return peta.toFixed(1) + ' Peta';
  } else if (peta >= 1) {
    return peta.toFixed(2) + ' Peta';
  }
  return peta.toFixed(3) + ' Peta';
}

export function updateKPIs(
  result: ScenarioResult,
  gnds: GroundResult[],
  fleets: FleetResult[],
  sats: SatelliteResult[],
  params: Params
): void {
  const i26 = 0; // 2026
  const i30 = 4; // 2030
  const i35 = 9; // 2035
  const i40 = 14; // 2040
  const i50 = 24; // 2050
  const i60 = 34; // 2060
  const i70 = 44; // 2070

  // Header badges
  setText('badge-crossover', result.crossoverYear?.toString() ?? 'Never');
  setText('badge-fleet50', fleets[i50].totalPowerTw.toFixed(1) + ' TW');

  // Core KPIs
  setText('kpi-orb25', '$' + fleets[i26].lcocEffective.toFixed(2));
  setText('kpi-gnd25', '$' + gnds[i26].market.toFixed(2));
  setText('kpi-orb30', '$' + fleets[i30].lcocEffective.toFixed(2));
  setText('kpi-gnd30', '$' + gnds[i30].market.toFixed(2));
  setText('kpi-orb40', '$' + fleets[i40].lcocEffective.toFixed(2));
  setText('kpi-gnd40', '$' + gnds[i40].market.toFixed(2));
  setText('kpi-orb50', '$' + fleets[i50].lcocEffective.toFixed(3));
  setText('kpi-gnd50', '$' + gnds[i50].market.toFixed(2));

  // Derived values
  const radPower = params.emissivity * STEFAN_BOLTZMANN * Math.pow(params.opTemp, 4);
  setText('d-radPower', radPower.toFixed(0));
  setText('d-radMass', sats[i30].radMassPerMW.toFixed(0));
  setText('d-launchLeo', getLaunchCost(2030, params, 'leo').toFixed(0));
  setText('d-launchGeo', getLaunchCost(2030, params, 'geo').toFixed(0));
  setText('d-satPower', sats[i30].powerKw.toFixed(0));
  setText('d-satMass', sats[i30].dryMass.toFixed(0));
  setText('d-demand35', gnds[i35].demand.toFixed(0));
  setText('d-supply35', gnds[i35].groundSupply.toFixed(0));

  // Market KPIs
  setText('kpi-peakPrem', Math.max(...gnds.map((g) => g.premium)).toFixed(1) + '×');
  setText('kpi-prem35', gnds[i35].premium.toFixed(1) + '×');
  setText('kpi-unmet35', (gnds[i35].unmetRatio * 100).toFixed(0) + '%');

  // Constraints KPIs
  setText('kpi-bwUtil', (fleets[i35].bwUtil * 100).toFixed(0) + '%');
  const totalPlat35 =
    fleets[i35].leoPlatforms +
    fleets[i35].meoPlatforms +
    fleets[i35].geoPlatforms +
    fleets[i35].cisPlatforms;
  const totalPlat50 =
    fleets[i50].leoPlatforms +
    fleets[i50].meoPlatforms +
    fleets[i50].geoPlatforms +
    fleets[i50].cisPlatforms;
  setText('kpi-plat35', (totalPlat35 / 1000).toFixed(0) + 'k');
  setText('kpi-plat50', (totalPlat50 / 1000).toFixed(0) + 'k');

  // Physics KPIs
  setText('kpi-leo', (sats[i35].powerKw / 1000).toFixed(1) + ' MW');
  setText('kpi-cis', (fleets[i35].cislunarPowerKw / 1000).toFixed(0) + ' MW');
  setText('kpi-mass', sats[i35].dryMass.toFixed(0) + ' kg');

  // Delivered compute KPIs
  setText('kpi-tokens35', formatDeliveredTokens(fleets[i35].deliveredTokensPerYear) + ' tok/yr');
  setText('kpi-tokens50', formatDeliveredTokens(fleets[i50].deliveredTokensPerYear) + ' tok/yr');

  // Fleet mass & Starship KPIs
  setText('kpi-fleetMass40', formatMass(fleets[i40].fleetMassKg));
  setText('kpi-starshipFlights40', Math.round(fleets[i40].starshipFlightsToDeploy).toLocaleString());
  setText('kpi-annualFlights40', Math.round(fleets[i40].annualStarshipFlights).toLocaleString());
  setText('kpi-leoCapacity40', `${(fleets[i40].leoPlatforms / 1000).toFixed(0)}k / ${(SHELLS.leo.capacity / 1000).toFixed(0)}k`);

  // State-based KPIs (if states exist)
  if (result.states && result.states.length > 0) {
    const state40 = result.states[i40];
    const lunar40 = result.lunarReadinessDetails?.[i40];

    // AI Acceleration KPIs
    setText('kpi-globalCompute40', state40.globalComputeExaflops.toFixed(0) + ' Exaflops');
    setText('kpi-rndStock40', state40.rndStock.toFixed(2));
    setText('kpi-launchLearnBoost', `+${((state40.effectiveLaunchLearnRate - params.launchLearn) * 100).toFixed(1)}%`);

    // Lunar Readiness KPIs
    if (lunar40) {
      setText('kpi-lunarReadiness', (lunar40.overallReadiness * 100).toFixed(0) + '%');
      setText('kpi-lunarStatus', lunar40.status);
      setText('kpi-lunarMassScore', (lunar40.massScore * 100).toFixed(0) + '%');
      setText('kpi-lunarComputeScore', (lunar40.computeScore * 100).toFixed(0) + '%');
    }

    // Lunar unlock year
    setText('kpi-lunarUnlock', result.lunarUnlockYear?.toString() ?? 'Not viable');
  }
}

/**
 * Format mass in human-readable units (kg, tonnes, kt, Mt)
 */
function formatMass(kg: number): string {
  if (kg >= 1e9) return (kg / 1e9).toFixed(1) + ' Mt';
  if (kg >= 1e6) return (kg / 1e6).toFixed(1) + ' kt';
  if (kg >= 1e3) return (kg / 1e3).toFixed(0) + ' t';
  return kg.toFixed(0) + ' kg';
}

export function updateToggleEffects(params: Params): void {
  const setActive = (id: string, active: boolean): void => {
    const el = document.getElementById(id);
    if (el) {
      el.className = 'toggle-effect' + (active ? ' active' : '');
    }
  };

  setActive('eff-thermal', true); // Always on
  setActive('eff-fission', params.fissionOn);
  setActive('eff-smr', params.smrOn);
  setActive('eff-fusion', params.fusionOn);
}

export function updateFuturesKPIs(
  agg: ScenarioResult,
  base: ScenarioResult,
  cons: ScenarioResult
): void {
  setText('kpi-crossAgg', agg.crossoverYear?.toString() ?? 'Never');
  setText('kpi-crossBase', base.crossoverYear?.toString() ?? 'Never');
  setText('kpi-crossCons', cons.crossoverYear?.toString() ?? 'Never');
}
