import { SHELLS } from './constants';
import type { Params, FleetResult } from './types';
import { getLEOPower, getCislunarPower, getBandwidth } from './physics';
import { getDemand } from './market';
import { getShellRadiationEffects } from './orbital';
import { calcSatellite } from './satellite';

/**
 * FLEET CALCULATION - MULTI-SHELL
 */
export function calcFleet(
  year: number,
  crossoverYear: number | null,
  params: Params
): FleetResult {
  const sat = calcSatellite(year, params);
  const cislunarPowerKw = getCislunarPower(year, params);
  const t = year - 2026;

  const hasFission = params.fissionOn && year >= params.fissionYear;
  const hasFusion = params.fusionOn && year >= params.fusionYear;
  const hasThermal = params.thermalOn && year >= params.thermalYear;

  let leoPlatforms = 0;
  let meoPlatforms = 0;
  let geoPlatforms = 0;
  let cisPlatforms = 0;

  if (!crossoverYear || year < crossoverYear) {
    // Pre-crossover: minimal early adopters
    leoPlatforms = Math.min(500, 50 + t * 20);
  } else {
    const yearsPost = year - crossoverYear;

    // LEO fills first and fastest - doubles every 1.2 years
    leoPlatforms = Math.min(
      SHELLS.leo.capacity,
      Math.round(500 * Math.pow(2, yearsPost / 1.2))
    );

    // MEO: High radiation, slower growth - starts year 2
    if (yearsPost >= 2) {
      meoPlatforms = Math.min(
        SHELLS.meo.capacity,
        Math.round(100 * Math.pow(1.8, (yearsPost - 2) / 1.5))
      );
    }

    // GEO: Limited slots, premium location - starts year 3
    if (yearsPost >= 3) {
      geoPlatforms = Math.min(
        SHELLS.geo.capacity,
        Math.round(50 * Math.pow(1.5, (yearsPost - 3) / 2))
      );
    }

    // Cislunar: Requires fission/fusion - starts year 2
    if (cislunarPowerKw > 0 && yearsPost >= 2) {
      cisPlatforms = Math.min(
        SHELLS.cislunar.capacity,
        Math.round(50 * Math.pow(2, (yearsPost - 2) / 2))
      );
    }
  }

  // === Power by shell ===
  const geoPowerKw = hasFission
    ? sat.powerKw * 20
    : hasThermal
      ? sat.powerKw * 10
      : sat.powerKw * 5;

  const leoPowerTw = (leoPlatforms * sat.powerKw) / 1e9;
  const meoPowerTw = (meoPlatforms * sat.powerKw * 0.8) / 1e9; // MEO Van Allen penalty
  const geoPowerTw = (geoPlatforms * geoPowerKw) / 1e9;
  const cisPowerTw = (cisPlatforms * cislunarPowerKw) / 1e9;
  const totalPowerTw = leoPowerTw + meoPowerTw + geoPowerTw + cisPowerTw;

  // === Bandwidth utilization ===
  const geoTflopsPerPlatform =
    (geoPowerKw * params.computeFrac * sat.gflopsW) / 1000;
  const cisTflopsPerPlatform =
    (cislunarPowerKw * params.computeFrac * sat.gflopsW) / 1000;

  const fleetTflops =
    leoPlatforms * sat.tflops +
    meoPlatforms * sat.tflops * 0.8 +
    geoPlatforms * geoTflopsPerPlatform +
    cisPlatforms * cisTflopsPerPlatform;

  const bwNeededGbps = fleetTflops * params.gbpsPerTflop;
  const bwAvailTbps = getBandwidth(year, params);
  const bwAvailGbps = bwAvailTbps * 1000;

  // bwSell: fraction of compute you can monetize
  const bwSell =
    bwNeededGbps <= 0 ? 1 : Math.min(1, bwAvailGbps / bwNeededGbps);

  // === Demand constraint ===
  const totalDemandGW = getDemand(year, params);
  const eligibleDemandGW = totalDemandGW * params.orbitalEligibleShare;
  const fleetPowerGW = totalPowerTw * 1000;

  // demandSell: fraction of fleet capacity the market can absorb
  const demandSell =
    fleetPowerGW <= 0 ? 1 : Math.min(1, eligibleDemandGW / fleetPowerGW);

  // Effective LCOC: inflated by whichever constraint binds
  const sellableUtil = Math.min(bwSell, demandSell);
  const lcocEffective = sat.lcoc / Math.max(0.01, sellableUtil);

  // For display
  const bwUtil =
    bwAvailGbps > 0 ? Math.min(1, bwNeededGbps / bwAvailGbps) : 1;
  const demandUtil =
    eligibleDemandGW > 0 ? Math.min(1, fleetPowerGW / eligibleDemandGW) : 0;

  // Shell utilization
  const leoUtil = leoPlatforms / SHELLS.leo.capacity;
  const meoUtil = meoPlatforms / SHELLS.meo.capacity;
  const geoUtil = geoPlatforms / SHELLS.geo.capacity;
  const cisUtil = cisPlatforms / SHELLS.cislunar.capacity;

  // Bottleneck detection
  let bottleneck = 'thermal';
  if (!crossoverYear || year < crossoverYear) {
    bottleneck = 'thermal';
  } else {
    if (bwSell < demandSell && bwSell < 0.9) bottleneck = 'bandwidth';
    else if (demandSell < 0.9) bottleneck = 'demand';
    else if (leoUtil > 0.9 || geoUtil > 0.9) bottleneck = 'slots';
    else if (!hasThermal && !hasFission) bottleneck = 'thermal';
    else bottleneck = 'power';
  }

  const leoRadEffects = getShellRadiationEffects('leo', year, params);
  const replacementRate = leoRadEffects.replacementRate;

  return {
    year,
    leoPlatforms,
    meoPlatforms,
    geoPlatforms,
    cisPlatforms,
    leoPowerTw,
    meoPowerTw,
    geoPowerTw,
    cisPowerTw,
    totalPowerTw,
    lcocEffective,
    bwUtil,
    bwAvailGbps,
    bwNeededGbps,
    bwSell,
    demandUtil,
    demandSell,
    eligibleDemandGW,
    fleetTflops,
    sellableUtil,
    satPowerKw: sat.powerKw,
    cislunarPowerKw,
    leoUtil,
    meoUtil,
    geoUtil,
    cisUtil,
    bottleneck,
    replacementRate
  };
}
