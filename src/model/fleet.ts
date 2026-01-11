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
// Track previous year's platforms BY SHELL for monotonic constraints
let prevLeoPlatforms = 0;
let prevMeoPlatforms = 0;
let prevGeoPlatforms = 0;
let prevCisPlatforms = 0;
let prevTotalPlatforms = 0;

/**
 * Get maximum heavy-lift launches per year.
 * Based on Elon Musk's projections: 10k flights/year is reasonable.
 * 8,000 flights for 500k Starlink v3 = high launch cadence.
 *
 * - 2026: 500 flights (early Starship ramp)
 * - 2028: 2,000 flights (operational Starship)
 * - 2030: 5,000 flights (multiple pads, rapid reuse)
 * - 2035: 10,000 flights (Elon's "reasonable" target)
 * - 2040+: 15,000 flights (mature global infrastructure)
 * - 2050+: 20,000 flights (multiple providers, orbital manufacturing)
 */
function getMaxLaunchesPerYear(year: number): number {
  if (year <= 2026) return 500;
  if (year <= 2028) {
    const t = (year - 2026) / 2;
    return Math.round(500 + t * 1500); // 500 → 2000
  }
  if (year <= 2030) {
    const t = (year - 2028) / 2;
    return Math.round(2000 + t * 3000); // 2000 → 5000
  }
  if (year <= 2035) {
    const t = (year - 2030) / 5;
    return Math.round(5000 + t * 5000); // 5000 → 10000
  }
  if (year <= 2040) {
    const t = (year - 2035) / 5;
    return Math.round(10000 + t * 5000); // 10000 → 15000
  }
  // 2040+: 15000 → 20000 over 10 years
  const t = Math.min(1, (year - 2040) / 10);
  return Math.round(15000 + t * 5000);
}

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
  // Apply radiation penalties: radPen direct penalty + shell-specific SEU availability
  const radDirectPenalty = 1 - params.radPen;  // e.g., 0.70 for radPen=0.30
  const geoRadEffects = getShellRadiationEffects('geo', year, params);
  const cisRadEffects = getShellRadiationEffects('cislunar', year, params);

  const geoTflopsPerPlatform =
    geoPowerKw * params.computeFrac * sat.gflopsW * geoRadEffects.availabilityFactor * radDirectPenalty;
  const cisTflopsPerPlatform =
    cislunarPowerKw * params.computeFrac * sat.gflopsW * cisRadEffects.availabilityFactor * radDirectPenalty;

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

  // STEP 3c: Monotonic fleet constraint + Launch capacity
  // CRITICAL: Fleet can only GROW per shell - you can't un-launch satellites
  // Exception: replacement losses (satellites fail at replacementRate per year)
  // Use per-shell replacement rates since radiation environment differs by shell
  const leoRadEffectsForCalc = getShellRadiationEffects('leo', year, params);
  const meoRadEffects = getShellRadiationEffects('meo', year, params);
  const geoRadEffectsForCalc = getShellRadiationEffects('geo', year, params);
  const cisRadEffectsForCalc = getShellRadiationEffects('cislunar', year, params);

  const leoSurvival = 1 - leoRadEffectsForCalc.replacementRate;
  const meoSurvival = 1 - meoRadEffects.replacementRate;
  const geoSurvival = 1 - geoRadEffectsForCalc.replacementRate;
  const cisSurvival = 1 - cisRadEffectsForCalc.replacementRate;

  // Minimum per-shell = previous minus natural attrition (per-shell rates)
  const minLeo = Math.floor(prevLeoPlatforms * leoSurvival);
  const minMeo = Math.floor(prevMeoPlatforms * meoSurvival);
  const minGeo = Math.floor(prevGeoPlatforms * geoSurvival);
  const minCis = Math.floor(prevCisPlatforms * cisSurvival);

  // Apply per-shell monotonic constraint: each shell can't shrink below minimum
  leoPlatforms = Math.max(leoPlatforms, minLeo);
  meoPlatforms = Math.max(meoPlatforms, minMeo);
  geoPlatforms = Math.max(geoPlatforms, minGeo);
  cisPlatforms = Math.max(cisPlatforms, minCis);

  let totalPlatformsPreLaunch = leoPlatforms + meoPlatforms + geoPlatforms + cisPlatforms;

  // Annual mass = new platforms + replacements (per-shell replacement rates)
  const newPlatformsPreLaunch = Math.max(0, totalPlatformsPreLaunch - prevTotalPlatforms);
  const leoReplacementMass = prevLeoPlatforms * leoRadEffectsForCalc.replacementRate * sat.dryMass;
  const meoReplacementMass = prevMeoPlatforms * meoRadEffects.replacementRate * sat.dryMass;
  const geoReplacementMass = prevGeoPlatforms * geoRadEffectsForCalc.replacementRate * sat.dryMass;
  const cisReplacementMass = prevCisPlatforms * cisRadEffectsForCalc.replacementRate * sat.dryMass;
  const replacementMassPreLaunch = leoReplacementMass + meoReplacementMass + geoReplacementMass + cisReplacementMass;
  const newDeploymentMassPreLaunch = newPlatformsPreLaunch * sat.dryMass;
  const annualMassPreLaunch = newDeploymentMassPreLaunch + replacementMassPreLaunch;
  const requiredFlights = annualMassPreLaunch / STARSHIP_PAYLOAD_KG;

  // Track if launch capacity is binding
  const maxLaunchesThisYear = getMaxLaunchesPerYear(year);
  const maxLaunchMassKg = maxLaunchesThisYear * STARSHIP_PAYLOAD_KG;
  let launchConstrained = false;

  if (requiredFlights > maxLaunchesThisYear) {
    launchConstrained = true;

    // KEY FIX: Account for partial replacement when launch capacity is insufficient
    // Surviving platforms = prev * survivalRate (these already exist, no launch needed)
    // We need to LAUNCH replacements for the ones that failed
    const survivingPlatforms = minLeo + minMeo + minGeo + minCis;  // = prev * survivalRate
    const failedPlatforms = prevTotalPlatforms - survivingPlatforms;
    const replacementMassNeeded = failedPlatforms * sat.dryMass;

    // How many replacements can we actually launch?
    const launchableReplacements = Math.min(
      failedPlatforms,
      Math.floor(maxLaunchMassKg / sat.dryMass)
    );
    const massUsedForReplacements = launchableReplacements * sat.dryMass;

    // Remaining launch capacity for NEW growth (beyond maintaining current fleet)
    const remainingMassForNew = Math.max(0, maxLaunchMassKg - replacementMassNeeded);
    const maxNewPlatforms = Math.floor(remainingMassForNew / sat.dryMass);
    const totalNew = Math.min(newPlatformsPreLaunch, maxNewPlatforms);

    // CORRECT totalTarget: surviving + launched replacements + new growth
    // If we can't launch all replacements, fleet SHRINKS (this was the bug!)
    const totalTarget = survivingPlatforms + launchableReplacements + totalNew;

    // Distribute across shells proportionally to their unconstrained targets
    // But NEVER scale below the monotonic minimum (can't un-launch satellites!)
    const totalUnconstrained = leoPlatforms + meoPlatforms + geoPlatforms + cisPlatforms;
    if (totalUnconstrained > 0 && totalTarget < totalUnconstrained) {
      const scaleFactor = totalTarget / totalUnconstrained;
      leoPlatforms = Math.max(minLeo, Math.round(leoPlatforms * scaleFactor));
      meoPlatforms = Math.max(minMeo, Math.round(meoPlatforms * scaleFactor));
      geoPlatforms = Math.max(minGeo, Math.round(geoPlatforms * scaleFactor));
      cisPlatforms = Math.max(minCis, Math.round(cisPlatforms * scaleFactor));
    }
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

  // Effective LCOC (delivered cost): production cost inflated by unsold capacity
  // If only 50% of compute can be sold (due to bandwidth/demand constraints),
  // the effective cost per delivered GPU-hr doubles. See satellite.lcoc for production cost.
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

  // 1. Thermal constraint - only when satellite is actually thermal-limited
  // thermalLimited means compute power is capped by thermal rejection capacity
  // thermalMargin = waste/capacity - high margin means near thermal limit
  const thermalHeadroom = Math.max(0.01, 1 - sat.thermalMargin);

  // Before breakthroughs, thermal is typically the binding constraint
  // After breakthroughs (droplet radiators, fission), thermal headroom increases
  if (!hasThermal && !hasFission && !hasFusion) {
    // Pre-breakthrough: thermal is VERY limiting (small radiator budget)
    // Force thermal to be tight constraint
    constraints.push({ name: 'thermal', ratio: Math.min(0.2, thermalHeadroom) });
  } else if (sat.thermalLimited) {
    // Post-breakthrough but compute is ACTUALLY limited by thermal capacity
    constraints.push({ name: 'thermal', ratio: thermalHeadroom });
  }

  // 2. Launch capacity - ratio based on how much we were constrained
  if (launchConstrained) {
    // Calculate the actual constraint ratio
    const launchRatio = requiredFlights > 0 ? maxLaunchesThisYear / requiredFlights : 1;
    constraints.push({ name: 'launch_capacity', ratio: launchRatio });
  }

  // 3. Bandwidth constraint - use bwSell which reflects actual fleet needs vs capacity
  // bwSell < 1 means we can't monetize all compute due to bandwidth limits
  // IMPORTANT: Bandwidth directly limits delivered tokens (revenue), while launch
  // limits fleet growth (capacity). When both are binding, bandwidth matters more
  // for the user since it affects what they can actually sell.
  if (bwSell < 1) {
    // Make bandwidth priority higher by using a lower ratio
    // bwSell = 0.84 → ratio = 0.50 (makes it show as bottleneck)
    const bwConstraintRatio = bwSell * bwSell; // Square it to make it show earlier
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

  // OVERRIDE: If bandwidth is significantly limiting revenue (bwSell < 0.95),
  // show it as the bottleneck since users care most about delivered tokens
  if (bwSell < 0.95 && bottleneck !== 'bandwidth') {
    bottleneck = 'bandwidth';
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

  // Update previous platforms for next iteration (per-shell for monotonic constraint)
  prevLeoPlatforms = leoPlatforms;
  prevMeoPlatforms = meoPlatforms;
  prevGeoPlatforms = geoPlatforms;
  prevCisPlatforms = cisPlatforms;
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
  prevLeoPlatforms = 0;
  prevMeoPlatforms = 0;
  prevGeoPlatforms = 0;
  prevCisPlatforms = 0;
  prevTotalPlatforms = 0;
}
