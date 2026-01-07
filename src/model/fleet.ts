import { SHELLS, STARSHIP_PAYLOAD_KG } from './constants';
import type { Params, FleetResult } from './types';
import { getLEOPower, getCislunarPower, getBandwidth } from './physics';
import { getDemand } from './market';
import { getShellRadiationEffects } from './orbital';
import { calcSatellite } from './satellite';

/**
 * FLEET CALCULATION - MULTI-SHELL
 * Fleet scales DOWN to match available bandwidth (bandwidth-constrained scaling)
 */
// Track previous year's platforms for annual mass calculation
let prevTotalPlatforms = 0;

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

  // STEP 1: Calculate UNCONSTRAINED platform counts (capacity-limited only)
  let leoUnconstrained = 0;
  let meoUnconstrained = 0;
  let geoUnconstrained = 0;
  let cisUnconstrained = 0;

  if (!crossoverYear || year < crossoverYear) {
    // Pre-crossover: minimal early adopters
    leoUnconstrained = Math.min(500, 50 + t * 20);
  } else {
    const yearsPost = year - crossoverYear;

    // LEO fills first and fastest - doubles every 1.2 years
    leoUnconstrained = Math.min(
      SHELLS.leo.capacity,
      Math.round(500 * Math.pow(2, yearsPost / 1.2))
    );

    // MEO: High radiation, slower growth - starts year 2
    if (yearsPost >= 2) {
      meoUnconstrained = Math.min(
        SHELLS.meo.capacity,
        Math.round(100 * Math.pow(1.8, (yearsPost - 2) / 1.5))
      );
    }

    // GEO: Limited slots, premium location - starts year 3
    if (yearsPost >= 3) {
      geoUnconstrained = Math.min(
        SHELLS.geo.capacity,
        Math.round(50 * Math.pow(1.5, (yearsPost - 3) / 2))
      );
    }

    // Cislunar: Requires fission/fusion - starts year 2
    if (cislunarPowerKw > 0 && yearsPost >= 2) {
      cisUnconstrained = Math.min(
        SHELLS.cislunar.capacity,
        Math.round(50 * Math.pow(2, (yearsPost - 2) / 2))
      );
    }
  }

  // STEP 2: Calculate bandwidth per platform
  const bwAvailTbps = getBandwidth(year, params);
  const bwAvailGbps = bwAvailTbps * 1000;

  const geoPowerKw = hasFission
    ? sat.powerKw * 20
    : hasThermal
      ? sat.powerKw * 10
      : sat.powerKw * 5;

  const geoTflopsPerPlatform =
    (geoPowerKw * params.computeFrac * sat.gflopsW) / 1000;
  const cisTflopsPerPlatform =
    (cislunarPowerKw * params.computeFrac * sat.gflopsW) / 1000;

  // Bandwidth per platform - cislunar gets local processing exemption
  const leoBwPerPlatform = sat.tflops * params.gbpsPerTflop;
  const meoBwPerPlatform = sat.tflops * 0.8 * params.gbpsPerTflop;
  const geoBwPerPlatform = geoTflopsPerPlatform * params.gbpsPerTflop;
  const cisBwPerPlatform = cisTflopsPerPlatform * params.gbpsPerTflop * (1 - params.cislunarLocalRatio);

  // STEP 3: Scale fleet to match bandwidth
  const totalUnconstrainedBw =
    leoUnconstrained * leoBwPerPlatform +
    meoUnconstrained * meoBwPerPlatform +
    geoUnconstrained * geoBwPerPlatform +
    cisUnconstrained * cisBwPerPlatform;

  let leoPlatforms = leoUnconstrained;
  let meoPlatforms = meoUnconstrained;
  let geoPlatforms = geoUnconstrained;
  let cisPlatforms = cisUnconstrained;

  if (totalUnconstrainedBw > bwAvailGbps && totalUnconstrainedBw > 0) {
    const bwScaleFactor = bwAvailGbps / totalUnconstrainedBw;
    leoPlatforms = Math.round(leoUnconstrained * bwScaleFactor);
    meoPlatforms = Math.round(meoUnconstrained * bwScaleFactor);
    geoPlatforms = Math.round(geoUnconstrained * bwScaleFactor);
    cisPlatforms = Math.round(cisUnconstrained * bwScaleFactor);
  }

  // === Power by shell ===
  const leoPowerTw = (leoPlatforms * sat.powerKw) / 1e9;
  const meoPowerTw = (meoPlatforms * sat.powerKw * 0.8) / 1e9; // MEO Van Allen penalty
  const geoPowerTw = (geoPlatforms * geoPowerKw) / 1e9;
  const cisPowerTw = (cisPlatforms * cislunarPowerKw) / 1e9;
  const totalPowerTw = leoPowerTw + meoPowerTw + geoPowerTw + cisPowerTw;

  // === Recalculate fleet TFLOPS with scaled platform counts ===
  const fleetTflops =
    leoPlatforms * sat.tflops +
    meoPlatforms * sat.tflops * 0.8 +
    geoPlatforms * geoTflopsPerPlatform +
    cisPlatforms * cisTflopsPerPlatform;

  const bwNeededGbps = fleetTflops * params.gbpsPerTflop;

  // bwSell: fraction of compute you can monetize (should be ~100% with bandwidth scaling)
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

  // Shell utilization (against unconstrained targets, not capacity)
  const leoUtil = leoPlatforms / SHELLS.leo.capacity;
  const meoUtil = meoPlatforms / SHELLS.meo.capacity;
  const geoUtil = geoPlatforms / SHELLS.geo.capacity;
  const cisUtil = cisPlatforms / SHELLS.cislunar.capacity;

  // Bandwidth constraint ratio for bottleneck detection
  const bwConstraintRatio = totalUnconstrainedBw > 0 ? bwAvailGbps / totalUnconstrainedBw : 1;

  // Bottleneck detection
  let bottleneck = 'thermal';
  if (!crossoverYear || year < crossoverYear) {
    bottleneck = 'thermal';
  } else {
    if (bwConstraintRatio < 0.9 && bwConstraintRatio < demandSell) bottleneck = 'bandwidth';
    else if (demandSell < 0.9) bottleneck = 'demand';
    else if (leoUtil > 0.9 || geoUtil > 0.9) bottleneck = 'slots';
    else if (!hasThermal && !hasFission) bottleneck = 'thermal';
    else bottleneck = 'power';
  }

  const leoRadEffects = getShellRadiationEffects('leo', year, params);
  const replacementRate = leoRadEffects.replacementRate;

  // Calculate delivered compute metric (Llama-70B tokens/year)
  // Llama-70B: ~0.05 tokens/sec per TFLOP (rough estimate)
  const tokensPerTflopSec = 0.05;
  const secondsPerYear = 8760 * 3600;
  const deliveredTflops = fleetTflops * bwSell;  // Only count sellable compute
  const deliveredTokensPerYear = deliveredTflops * tokensPerTflopSec * secondsPerYear;

  // === Fleet mass & Starship equivalency ===
  const totalPlatforms = leoPlatforms + meoPlatforms + geoPlatforms + cisPlatforms;

  // Average platform mass varies by shell and tech level
  // LEO satellites are lighter, GEO/Cislunar heavier
  const avgPlatformMassKg = sat.dryMass;  // Use current sat mass as baseline

  const fleetMassKg = totalPlatforms * avgPlatformMassKg;
  const starshipFlightsToDeploy = fleetMassKg / STARSHIP_PAYLOAD_KG;

  // Annual deployment: new platforms + replacements
  const newPlatformsThisYear = Math.max(0, totalPlatforms - prevTotalPlatforms);
  const replacementMassKg = totalPlatforms * replacementRate * avgPlatformMassKg;
  const newDeploymentMassKg = newPlatformsThisYear * avgPlatformMassKg;
  const annualMassKg = newDeploymentMassKg + replacementMassKg;
  const annualStarshipFlights = annualMassKg / STARSHIP_PAYLOAD_KG;

  // Update previous platforms for next iteration
  prevTotalPlatforms = totalPlatforms;

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
    replacementRate,
    deliveredTokensPerYear,
    // Fleet mass & Starship metrics
    totalPlatforms,
    avgPlatformMassKg,
    fleetMassKg,
    starshipFlightsToDeploy,
    annualMassKg,
    annualStarshipFlights
  };
}

// Reset previous platforms tracker (call at start of new scenario)
export function resetFleetTracker(): void {
  prevTotalPlatforms = 0;
}
