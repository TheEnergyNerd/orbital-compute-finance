import type { ScenarioResult, GroundResult, FleetResult, SatelliteResult } from '../model/types';
import type { Params } from '../model/types';
import { STEFAN_BOLTZMANN } from '../model/constants';
import { getLaunchCost } from '../model/physics';

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
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
}

export function updateToggleEffects(params: Params): void {
  const setActive = (id: string, active: boolean): void => {
    const el = document.getElementById(id);
    if (el) {
      el.className = 'toggle-effect' + (active ? ' active' : '');
    }
  };

  setActive('eff-droplet', true); // Always on
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
