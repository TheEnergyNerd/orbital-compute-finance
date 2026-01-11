import { SHELLS, STARSHIP_PAYLOAD_KG } from './constants';
import type { Params, FleetResult } from './types';
import { getLEOPower, getCislunarPower, getBandwidth, getEffectiveBwPerTflop, getTokensPerYear } from './physics';
import { getDemand } from './market';
import { getShellRadiationEffects } from './orbital';
import { calcSatellite } from './satellite';

/**
 * FLEET CALCULATION - MULTI-SHELL
 * Fleet scales DOWN to match constraints:
 * - Bandwidth capacity
 * - Market demand
 * - Launch capacity (Starship flights/year)
 */
// Track previous year's platforms for annual mass calculation
let prevTotalPlatforms = 0;

// Maximum Starship launches per year (aggressive but plausible)
// SpaceX targets ~100 flights/year by 2026, scaling to ~1000+ by 2030s
// 2000/year represents mature operations with multiple launch sites
const MAX_LAUNCHES_PER_YEAR = 2000;

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

  // Dynamic eligible share: cheaper orbital compute expands addressable market
  // As LCOC drops, more workloads justify the latency tradeoff
  // Base: params.orbitalEligibleShare (35%)
  // Fusion/advanced tech can push this to 60%+ as cost savings outweigh latency concerns
  const baseEligible = params.orbitalEligibleShare;
  // Reference LCOC ~$0.10/GPU-hr; at $0.02/GPU-hr, eligible share doubles
  const lcocReference = 0.10;
  const lcocBoost = Math.min(2.0, lcocReference / Math.max(0.01, sat.lcoc));
  const dynamicEligibleShare = Math.min(0.70, baseEligible * lcocBoost);

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

    // LEO fills FIRST - doubles every 2.5 years (was 1.2, unrealistic)
    // This reflects manufacturing ramp, supply chain, workforce scaling
    const leoGrowth = Math.round(500 * Math.pow(2, yearsPost / 2.5));
    leoUnconstrained = Math.min(SHELLS.leo.capacity, leoGrowth);
    const leoFull = leoUnconstrained >= SHELLS.leo.capacity * 0.95;

    // MEO: NOT viable for compute (Van Allen radiation belts)
    // capacity is 0, so this will always be 0
    meoUnconstrained = 0;

    // GEO: Only expands significantly AFTER LEO is nearly full
    // Limited slots (1800 ITU-allocated positions)
    if (leoFull && yearsPost >= 2) {
      const yearsPostLeoFull = Math.max(0, yearsPost - Math.log2(SHELLS.leo.capacity / 500) * 1.2);
      geoUnconstrained = Math.min(
        SHELLS.geo.capacity,
        Math.round(50 * Math.pow(1.5, yearsPostLeoFull / 1.5))
      );
    }

    // Cislunar: For batch processing (high latency OK), requires fission/fusion
    // Grows independently since it serves different workloads (latency-tolerant batch)
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

  // TFLOPS = powerKw * 1000 (W) * gflopsW (GFLOPS/W) / 1000 (GFLOPS→TFLOPS) = powerKw * gflopsW
  const geoTflopsPerPlatform =
    geoPowerKw * params.computeFrac * sat.gflopsW;
  const cisTflopsPerPlatform =
    cislunarPowerKw * params.computeFrac * sat.gflopsW;

  // Bandwidth per platform - scales with effective BW/TFLOP (lower with thermo/photonic)
  // Larger power budgets enable better comms (high-gain antennas, laser links, edge processing)
  const effectiveBwPerTflop = getEffectiveBwPerTflop(year, params);
  // LEO/MEO/GEO use fission (2x efficiency); Cislunar uses fusion (5x efficiency)
  const fissionBwEfficiency = hasFission ? 0.5 : 1.0;
  const cislunarBwEfficiency = hasFusion ? 0.2 : fissionBwEfficiency;
  const leoBwPerPlatform = sat.tflops * effectiveBwPerTflop * fissionBwEfficiency;
  const meoBwPerPlatform = sat.tflops * 0.8 * effectiveBwPerTflop * fissionBwEfficiency;
  const geoBwPerPlatform = geoTflopsPerPlatform * effectiveBwPerTflop * fissionBwEfficiency;
  const cisBwPerPlatform = cisTflopsPerPlatform * effectiveBwPerTflop * (1 - params.cislunarLocalRatio) * cislunarBwEfficiency;

  // STEP 3: Scale fleet to match bandwidth
  const totalUnconstrainedBw =
    leoUnconstrained * leoBwPerPlatform +
    meoUnconstrained * meoBwPerPlatform +
    geoUnconstrained * geoBwPerPlatform +
    cisUnconstrained * cisBwPerPlatform;

  // LEO is PROTECTED - serves latency-sensitive workloads with priority
  // Only scale down GEO/cislunar if bandwidth/demand constrained
  let leoPlatforms = leoUnconstrained;
  let meoPlatforms = meoUnconstrained;
  let geoPlatforms = geoUnconstrained;
  let cisPlatforms = cisUnconstrained;

  // Calculate power per platform
  const leoPowerPerPlatform = sat.powerKw / 1e6; // GW
  const meoPowerPerPlatform = sat.powerKw * 0.8 / 1e6;
  const geoPowerPerPlatformGW = geoPowerKw / 1e6;
  const cisPowerPerPlatformGW = cislunarPowerKw / 1e6;

  // Bandwidth constraint - LEO protected, scale GEO/cislunar first
  const leoBwNeed = leoUnconstrained * leoBwPerPlatform;
  const geoCisBwNeed = geoUnconstrained * geoBwPerPlatform + cisUnconstrained * cisBwPerPlatform;

  if (leoBwNeed <= bwAvailGbps) {
    // LEO fits - allocate remaining BW to GEO/cislunar
    const remainingBw = bwAvailGbps - leoBwNeed;
    if (geoCisBwNeed > remainingBw && geoCisBwNeed > 0) {
      const geoCisScaleFactor = remainingBw / geoCisBwNeed;
      geoPlatforms = Math.round(geoUnconstrained * geoCisScaleFactor);
      cisPlatforms = Math.round(cisUnconstrained * geoCisScaleFactor);
    }
  } else {
    // Even LEO alone exceeds bandwidth - scale LEO too
    leoPlatforms = Math.round(bwAvailGbps / leoBwPerPlatform);
    geoPlatforms = 0;
    cisPlatforms = 0;
  }

  // STEP 3b: Demand constraint - LEO protected, scale GEO/cislunar first
  const totalDemandGW = getDemand(year, params);
  const eligibleDemandGW = totalDemandGW * dynamicEligibleShare;
  const maxFleetPowerGW = eligibleDemandGW * 0.95;

  const leoPowerGW = leoPlatforms * leoPowerPerPlatform;
  const geoCisPowerGW = geoPlatforms * geoPowerPerPlatformGW + cisPlatforms * cisPowerPerPlatformGW;

  if (leoPowerGW <= maxFleetPowerGW) {
    // LEO fits within demand - allocate remaining to GEO/cislunar
    const remainingDemandGW = maxFleetPowerGW - leoPowerGW;
    if (geoCisPowerGW > remainingDemandGW && geoCisPowerGW > 0) {
      const geoCisScaleFactor = remainingDemandGW / geoCisPowerGW;
      geoPlatforms = Math.round(geoPlatforms * geoCisScaleFactor);
      cisPlatforms = Math.round(cisPlatforms * geoCisScaleFactor);
    }
  } else {
    // Even LEO alone exceeds demand - scale LEO too
    leoPlatforms = Math.round(maxFleetPowerGW / leoPowerPerPlatform);
    geoPlatforms = 0;
    cisPlatforms = 0;
  }

  // STEP 3c: Launch capacity constraint
  // Calculate annual mass needed and check against Starship capacity
  const totalPlatformsPreLaunch = leoPlatforms + meoPlatforms + geoPlatforms + cisPlatforms;
  const leoRadEffectsForCalc = getShellRadiationEffects('leo', year, params);
  const replacementRateForCalc = leoRadEffectsForCalc.replacementRate;

  // Annual mass = new platforms + replacements
  const newPlatformsPreLaunch = Math.max(0, totalPlatformsPreLaunch - prevTotalPlatforms);
  const replacementMassPreLaunch = totalPlatformsPreLaunch * replacementRateForCalc * sat.dryMass;
  const newDeploymentMassPreLaunch = newPlatformsPreLaunch * sat.dryMass;
  const annualMassPreLaunch = newDeploymentMassPreLaunch + replacementMassPreLaunch;
  const requiredFlights = annualMassPreLaunch / STARSHIP_PAYLOAD_KG;

  // Track if launch capacity is binding
  let launchConstrained = false;
  if (requiredFlights > MAX_LAUNCHES_PER_YEAR) {
    launchConstrained = true;
    // Scale down ALL shells proportionally to fit launch capacity
    const launchScaleFactor = MAX_LAUNCHES_PER_YEAR / requiredFlights;
    leoPlatforms = Math.round(leoPlatforms * launchScaleFactor);
    meoPlatforms = Math.round(meoPlatforms * launchScaleFactor);
    geoPlatforms = Math.round(geoPlatforms * launchScaleFactor);
    cisPlatforms = Math.round(cisPlatforms * launchScaleFactor);
  }

  // === Power by shell ===
  let leoPowerTw = (leoPlatforms * sat.powerKw) / 1e9;
  let meoPowerTw = (meoPlatforms * sat.powerKw * 0.8) / 1e9; // MEO Van Allen penalty
  let geoPowerTw = (geoPlatforms * geoPowerKw) / 1e9;
  let cisPowerTw = (cisPlatforms * cislunarPowerKw) / 1e9;
  let totalPowerTw = leoPowerTw + meoPowerTw + geoPowerTw + cisPowerTw;

  // Cap platforms at capacity (monotonic constraint could have pushed above)
  leoPlatforms = Math.min(leoPlatforms, SHELLS.leo.capacity);
  meoPlatforms = Math.min(meoPlatforms, SHELLS.meo.capacity);
  geoPlatforms = Math.min(geoPlatforms, SHELLS.geo.capacity);
  // Cislunar has effectively unlimited capacity, no cap needed

  // Recalculate power after capping
  leoPowerTw = (leoPlatforms * sat.powerKw) / 1e9;
  meoPowerTw = (meoPlatforms * sat.powerKw * 0.8) / 1e9;
  geoPowerTw = (geoPlatforms * geoPowerKw) / 1e9;
  cisPowerTw = (cisPlatforms * cislunarPowerKw) / 1e9;
  totalPowerTw = leoPowerTw + meoPowerTw + geoPowerTw + cisPowerTw;

  // === Recalculate fleet TFLOPS with scaled platform counts ===
  const fleetTflops =
    leoPlatforms * sat.tflops +
    meoPlatforms * sat.tflops * 0.8 +
    geoPlatforms * geoTflopsPerPlatform +
    cisPlatforms * cisTflopsPerPlatform;

  const bwNeededGbps = fleetTflops * effectiveBwPerTflop;

  // bwSell: fraction of compute you can monetize (should be ~100% with bandwidth scaling)
  const bwSell =
    bwNeededGbps <= 0 ? 1 : Math.min(1, bwAvailGbps / bwNeededGbps);

  // === Demand constraint (reusing values from Step 3b) ===
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
  const meoUtil = SHELLS.meo.capacity > 0 ? meoPlatforms / SHELLS.meo.capacity : 0;
  const geoUtil = geoPlatforms / SHELLS.geo.capacity;
  const cisUtil = cisPlatforms / SHELLS.cislunar.capacity;

  // Bandwidth constraint ratio for bottleneck detection
  const bwConstraintRatio = totalUnconstrainedBw > 0 ? bwAvailGbps / totalUnconstrainedBw : 1;

  // Bottleneck detection - identify the tightest physical constraint
  // Each constraint ratio: <1 means constrained, lower = tighter
  const constraints: { name: string; ratio: number }[] = [];

  // 1. Thermal constraint - ALWAYS present, varies by headroom
  // thermalMargin = waste/capacity, so headroom = 1 - margin
  // Lower headroom = tighter constraint
  const thermalHeadroom = Math.max(0, 1 - sat.thermalMargin);

  // Before breakthroughs, thermal is extra-constrained
  // After breakthroughs, still constrained if near capacity
  if (!hasThermal && !hasFission && !hasFusion) {
    // Pre-breakthrough: thermal is VERY limiting (small radiator budget)
    // Force thermal to be tight constraint
    constraints.push({ name: 'thermal', ratio: Math.min(0.2, thermalHeadroom) });
  } else if (sat.thermalLimited || thermalHeadroom < 0.3) {
    // Post-breakthrough but still thermally constrained
    constraints.push({ name: 'thermal', ratio: thermalHeadroom });
  }

  // 2. Launch capacity
  if (launchConstrained) {
    constraints.push({ name: 'launch_capacity', ratio: 0.5 });
  }

  // 3. Bandwidth constraint
  if (bwConstraintRatio < 1) {
    constraints.push({ name: 'bandwidth', ratio: bwConstraintRatio });
  }

  // 4. Demand constraint
  if (demandSell < 1) {
    constraints.push({ name: 'demand', ratio: demandSell });
  }

  // 5. Orbital slot capacity
  const slotUtil = Math.max(leoUtil, geoUtil);
  if (slotUtil > 0.8) {
    constraints.push({ name: 'slots', ratio: 1 - slotUtil });
  }

  // Find the tightest constraint (lowest ratio)
  let bottleneck: string;
  if (constraints.length === 0) {
    // No constraints binding - power/manufacturing is the limit
    bottleneck = 'power';
  } else {
    constraints.sort((a, b) => a.ratio - b.ratio);
    bottleneck = constraints[0].name;
  }

  const leoRadEffects = getShellRadiationEffects('leo', year, params);
  const replacementRate = leoRadEffects.replacementRate;

  // Calculate delivered compute metric using FLOPs/token model
  const deliveredTflops = fleetTflops * bwSell;  // Only count sellable compute
  const availability = 0.99;  // 99% uptime target
  const deliveredTokensPerYear = getTokensPerYear(deliveredTflops, params, availability);

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
    dynamicEligibleShare,
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
