import { SHELLS, STARSHIP_PAYLOAD_KG } from './constants';
import type { Params, FleetResult } from './types';
import { getCislunarPower, getBandwidth, getEffectiveBwPerTflop, getTokensPerYear } from './physics';
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
// Track previous year's FLEET MASS BY SHELL for monotonic constraints
// This ensures that when satellites get bigger, fleet adjusts platform count appropriately
let prevLeoMassKg = 0;
let prevMeoMassKg = 0;
let prevGeoMassKg = 0;
let prevCisMassKg = 0;
let prevTotalPlatforms = 0;

/**
 * Get maximum heavy-lift launches per year.
 * Starship V3 enables 200t reusable payload with rapid turnaround.
 * Multiple pads (Starbase, LC-39A, SLC-37) + global competition.
 * Post-2040: Space industry matures to airline-like operations.
 * Post-2050: Orbital manufacturing reduces Earth-launch dependency.
 * Post-2060: Lunar resources + in-situ manufacturing accelerates cislunar.
 *
 * - 2026: 100 flights (early Starship, mostly test flights)
 * - 2028: 500 flights (operational Starship, 2 pads)
 * - 2030: 2,000 flights (3+ pads, rapid reuse proven)
 * - 2035: 10,000 flights (global infrastructure, multiple providers)
 * - 2040: 50,000 flights (airline-like ops, China/Europe/India join)
 * - 2050: 100,000 flights (orbital manufacturing hubs operational)
 * - 2060: 150,000 flights (lunar ISRU reduces mass from Earth)
 * - 2070: 200,000 flights (mature cislunar economy)
 */
function getMaxLaunchesPerYear(year: number, params: Params): number {
  // Before Starship: limited to ~100 flights/year (Falcon 9, etc.)
  if (!params.starshipOn || year < params.starshipYear) {
    return 100;
  }
  
  // Years since Starship became operational
  const yearsSinceStarship = year - params.starshipYear;
  
  // Starship ramp-up schedule (years since operational)
  if (yearsSinceStarship <= 0) return 100;  // Still ramping in first year
  if (yearsSinceStarship <= 2) {
    const t = yearsSinceStarship / 2;
    return Math.round(100 + t * 400); // 100 → 500
  }
  if (yearsSinceStarship <= 4) {
    const t = (yearsSinceStarship - 2) / 2;
    return Math.round(500 + t * 1500); // 500 → 2000
  }
  if (yearsSinceStarship <= 9) {
    const t = (yearsSinceStarship - 4) / 5;
    return Math.round(2000 + t * 8000); // 2000 → 10000
  }
  if (yearsSinceStarship <= 14) {
    const t = (yearsSinceStarship - 9) / 5;
    return Math.round(10000 + t * 40000); // 10000 → 50000
  }
  if (yearsSinceStarship <= 24) {
    const t = (yearsSinceStarship - 14) / 10;
    return Math.round(50000 + t * 50000); // 50000 → 100000
  }
  if (yearsSinceStarship <= 34) {
    const t = (yearsSinceStarship - 24) / 10;
    return Math.round(100000 + t * 50000); // 100000 → 150000
  }
  // 34+ years: 150000 → 200000 over 10 years
  const t = Math.min(1, (yearsSinceStarship - 34) / 10);
  return Math.round(150000 + t * 50000);
}

/**
 * Calculate fleet deployment and economics for a given year.
 * 
 * Fleet scales DOWN to match constraints:
 * - Bandwidth capacity (goodput model)
 * - Market demand (eligible share × total demand)
 * - Launch capacity (Starship flights/year)
 * - Orbital slot limits (LEO mass, GEO ITU slots)
 * 
 * Returns instantaneous fleet capacity and delivered compute metrics.
 * Key outputs:
 * - totalPowerTw: Instantaneous power capacity
 * - fleetTflops: Instantaneous compute capacity
 * - deliveredTokensPerYear: Actual sellable output (capacity × bwSell × availability)
 * - lcocEffective: Delivered cost = production_lcoc / sellableUtil
 * 
 * @param year - Simulation year
 * @param crossoverYear - Year when orbital beats ground (null if never)
 * @param params - Model parameters
 * @returns Fleet deployment metrics and economics
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

  // === SHELL-SPECIFIC SATELLITE MASSES ===
  // Each shell has different power levels and thus different platform masses
  const leoSatMassKg = sat.dryMass;

  // GEO power multiplier (must match the one used later for TFLOPS calc)
  const geoPowerKw = hasFusion
    ? sat.powerKw * 50
    : hasFission
      ? sat.powerKw * 20
      : hasThermal
        ? sat.powerKw * 10
        : sat.powerKw * 5;

  const geoSatMassKg = sat.dryMass * (geoPowerKw / Math.max(1, sat.powerKw));
  const cisSatMassKg = sat.dryMass * (cislunarPowerKw / Math.max(1, sat.powerKw));

  // LEO mass-based capacity: how many platforms fit in 500 Tkg?
  const maxLeoByMass = Math.floor(SHELLS.leo.massCapacityKg / leoSatMassKg);

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

    // LEO fills FIRST - doubles every 1.5 years (Starship enables rapid deployment)
    // This reflects manufacturing ramp, supply chain, workforce scaling
    const leoGrowth = Math.round(500 * Math.pow(2, yearsPost / 1.5));
    leoUnconstrained = Math.min(maxLeoByMass, leoGrowth);

    // MEO: NOT viable for compute (Van Allen radiation belts)
    // capacity is 0, so this will always be 0
    meoUnconstrained = 0;

    // GEO: Starts after LEO industry matures (~8 years post-crossover)
    // GEO has unique advantages: 24/7 ground station visibility, simpler ops
    // Limited slots (1800 ITU-allocated positions), but valuable for latency-tolerant workloads
    // Note: Launch constraints limit actual LEO deployment, so we can't wait for LEO to "fill"
    const geoStartYears = 8;  // GEO deployment begins 8 years after crossover
    if (yearsPost >= geoStartYears) {
      const yearsPostGeoStart = yearsPost - geoStartYears;
      geoUnconstrained = Math.min(
        SHELLS.geo.capacity,
        Math.round(20 * Math.pow(1.8, yearsPostGeoStart / 1.5))  // Start small (20), grow to fill slots
      );
    }

    // Cislunar: For batch processing (high latency OK), requires fission/fusion
    // Grows aggressively once fusion is available - unlimited capacity, vast solar resources
    // Post-2055: Lunar ISRU and orbital manufacturing accelerate deployment
    if (cislunarPowerKw > 0 && yearsPost >= 2) {
      // Cislunar growth depends heavily on space infrastructure maturity
      // Thermal breakthrough is critical for: power systems, thermal management, 
      // manufacturing quality, and operational support from LEO infrastructure
      const hasLunarIsruForGrowth = year >= 2055;
      
      // Infrastructure maturity factor based on thermal tech
      // Key insight: Cislunar requires ESTABLISHED thermal infrastructure, not just availability
      // - Years 0-5 after thermal: still building capabilities (0.3-0.5x)
      // - Years 5-15: maturing infrastructure (0.5-0.9x)  
      // - Years 15+: full capability (1.0x)
      // Without thermal: severely limited (0.15x) - can only do small-scale demos
      const yearsSinceThermal = hasThermal ? year - params.thermalYear : 0;
      let thermalMaturityFactor: number;
      if (!hasThermal) {
        thermalMaturityFactor = 0.15;  // Very limited without thermal
      } else if (yearsSinceThermal < 5) {
        thermalMaturityFactor = 0.3 + 0.04 * yearsSinceThermal;  // 0.3 → 0.5 over 5 years
      } else if (yearsSinceThermal < 15) {
        thermalMaturityFactor = 0.5 + 0.04 * (yearsSinceThermal - 5);  // 0.5 → 0.9 over 10 years
      } else {
        thermalMaturityFactor = 0.9 + 0.02 * Math.min(5, yearsSinceThermal - 15);  // 0.9 → 1.0 over 5 years
      }

      // Base exponential growth (moderate)
      const baseGrowth = Math.round(100 * Math.pow(2, (yearsPost - 2) / 2.0));

      // Lunar ISRU boost scales with infrastructure maturity
      // Early thermal = mature infrastructure at ISRU = bigger boost
      const lunarBoostFactor = hasLunarIsruForGrowth 
        ? 1.0 + 1.0 * thermalMaturityFactor  // 1.15x to 2.0x based on maturity
        : 1.0;
      const unconstrainedTarget = Math.round(baseGrowth * lunarBoostFactor * thermalMaturityFactor);

      // Growth rate cap also depends on infrastructure
      // Without mature thermal: can only grow 15-20%/year
      // With mature thermal: can grow 35-55%/year
      const baseMaxGrowth = 0.15 + 0.25 * thermalMaturityFactor;  // 0.15 → 0.40
      const isruBoost = hasLunarIsruForGrowth ? 0.15 * thermalMaturityFactor : 0;  // 0 → 0.15
      const maxGrowthRate = baseMaxGrowth + isruBoost;
      const prevCisPlatformsForGrowth = cisSatMassKg > 0 ? Math.floor(prevCisMassKg / cisSatMassKg) : 0;
      const maxThisYear = Math.round(Math.max(100, prevCisPlatformsForGrowth) * (1 + maxGrowthRate));

      cisUnconstrained = Math.min(
        SHELLS.cislunar.capacity,
        unconstrainedTarget,
        maxThisYear  // Growth rate cap
      );
    }
  }

  // STEP 2: Calculate bandwidth per platform
  const bwAvailTbps = getBandwidth(year, params);
  const bwAvailGbps = bwAvailTbps * 1000;

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
  const _meoPowerPerPlatform = sat.powerKw * 0.8 / 1e6; // MEO not viable (Van Allen)
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

  // Minimum per-shell = previous MASS minus natural attrition, converted to platform count
  // This ensures that when satellites get bigger, we have proportionally fewer platforms
  const minLeoMassKg = prevLeoMassKg * leoSurvival;
  const minMeoMassKg = prevMeoMassKg * meoSurvival;
  const minGeoMassKg = prevGeoMassKg * geoSurvival;
  const minCisMassKg = prevCisMassKg * cisSurvival;
  
  const minLeo = leoSatMassKg > 0 ? Math.floor(minLeoMassKg / leoSatMassKg) : 0;
  const minMeo = leoSatMassKg > 0 ? Math.floor(minMeoMassKg / leoSatMassKg) : 0;  // MEO uses same sat design
  const minGeo = geoSatMassKg > 0 ? Math.floor(minGeoMassKg / geoSatMassKg) : 0;
  const minCis = cisSatMassKg > 0 ? Math.floor(minCisMassKg / cisSatMassKg) : 0;
  
  // Target per-shell: maintain previous year's MASS (converted to count) plus any growth
  const prevLeoPlatforms = leoSatMassKg > 0 ? Math.floor(prevLeoMassKg / leoSatMassKg) : 0;
  const prevMeoPlatforms = leoSatMassKg > 0 ? Math.floor(prevMeoMassKg / leoSatMassKg) : 0;
  const prevGeoPlatforms = geoSatMassKg > 0 ? Math.floor(prevGeoMassKg / geoSatMassKg) : 0;
  const prevCisPlatforms = cisSatMassKg > 0 ? Math.floor(prevCisMassKg / cisSatMassKg) : 0;
  
  const leoTarget = Math.max(leoPlatforms, prevLeoPlatforms);
  const meoTarget = Math.max(meoPlatforms, prevMeoPlatforms);
  const geoTarget = Math.max(geoPlatforms, prevGeoPlatforms);

  // LUNAR ISRU: After 2055, cislunar grows to manufacturing capacity, not demand-limited
  const lunarIsruYear = 2055;
  const hasLunarIsru = year >= lunarIsruYear;
  const cisTarget = hasLunarIsru
    ? Math.max(cisUnconstrained, prevCisPlatforms)  // ISRU: grow to manufacturing capacity
    : Math.max(cisPlatforms, prevCisPlatforms);     // Pre-ISRU: limited by Earth constraints

  // Apply per-shell monotonic constraint: each shell can't shrink below minimum
  leoPlatforms = Math.max(leoPlatforms, minLeo);
  meoPlatforms = Math.max(meoPlatforms, minMeo);
  geoPlatforms = Math.max(geoPlatforms, minGeo);
  cisPlatforms = Math.max(cisPlatforms, minCis);

  const totalPlatformsPreLaunch = leoPlatforms + meoPlatforms + geoPlatforms + cisPlatforms;

  // Annual mass = new platforms + replacements (per-shell replacement rates)
  const newPlatformsPreLaunch = Math.max(0, totalPlatformsPreLaunch - prevTotalPlatforms);
  const leoReplacementMass = prevLeoPlatforms * leoRadEffectsForCalc.replacementRate * leoSatMassKg;
  const meoReplacementMass = prevMeoPlatforms * meoRadEffects.replacementRate * leoSatMassKg;
  const geoReplacementMass = prevGeoPlatforms * geoRadEffectsForCalc.replacementRate * geoSatMassKg;
  const cisReplacementMass = prevCisPlatforms * cisRadEffectsForCalc.replacementRate * cisSatMassKg;
  const replacementMassPreLaunch = leoReplacementMass + meoReplacementMass + geoReplacementMass + cisReplacementMass;
  const newDeploymentMassPreLaunch = newPlatformsPreLaunch * sat.dryMass;
  const annualMassPreLaunch = newDeploymentMassPreLaunch + replacementMassPreLaunch;
  // Total flights (for documentation; earthRequiredFlights used for constraint)
  const _requiredFlights = annualMassPreLaunch / STARSHIP_PAYLOAD_KG;

  // Track if launch capacity is binding
  const maxLaunchesThisYear = getMaxLaunchesPerYear(year, params);
  const maxLaunchMassKg = maxLaunchesThisYear * STARSHIP_PAYLOAD_KG;
  let launchConstrained = false;

  // Calculate mass that requires Earth launch (excludes cislunar after ISRU)
  // Note: cisSatMassKg calculated later, use approximation here
  const cisSatMassApprox = sat.dryMass * (cislunarPowerKw / Math.max(1, sat.powerKw));
  const cisNewMassForIsru = hasLunarIsru ? 0 : Math.max(0, cisPlatforms - prevCisPlatforms) * cisSatMassApprox;
  const cisReplaceMassForIsru = hasLunarIsru ? 0 : (prevCisPlatforms - minCis) * cisSatMassApprox;
  
  // Mass requiring Earth launch
  const earthLaunchMass = annualMassPreLaunch - cisNewMassForIsru - cisReplaceMassForIsru;
  const earthRequiredFlights = earthLaunchMass / STARSHIP_PAYLOAD_KG;

  if (earthRequiredFlights > maxLaunchesThisYear) {
    launchConstrained = true;

    // KEY FIX: Account for partial replacement when launch capacity is insufficient
    // Surviving platforms = prev * survivalRate (these already exist, no launch needed)
    // We need to LAUNCH replacements for the ones that failed
    const survivingPlatforms = minLeo + minMeo + minGeo + minCis;  // = prev * survivalRate
    // Total failed = prev - surviving (for documentation)
    const _failedPlatforms = prevTotalPlatforms - survivingPlatforms;
    
    // Mass needed to MAINTAIN each shell at previous year's level
    const leoFailedPlatforms = prevLeoPlatforms - minLeo;
    const meoFailedPlatforms = prevMeoPlatforms - minMeo;
    const geoFailedPlatforms = prevGeoPlatforms - minGeo;
    const cisFailedPlatforms = prevCisPlatforms - minCis;
    
    // Priority 1: Replace LEO failures (LEO is critical infrastructure)
    // Priority 2: Replace other Earth-dependent shell failures (MEO/GEO)
    // Priority 3: New growth for Earth-dependent shells
    // Note: Cislunar handled separately after lunar ISRU
    
    let remainingMass = maxLaunchMassKg;
    
    // LEO replacements first
    const _leoReplaceMassNeeded = leoFailedPlatforms * sat.dryMass;
    const leoReplacementsLaunched = Math.min(leoFailedPlatforms, Math.floor(remainingMass / sat.dryMass));
    remainingMass -= leoReplacementsLaunched * sat.dryMass;
    
    // MEO/GEO replacements (cislunar excluded if lunar ISRU active)
    const earthFailedPlatforms = meoFailedPlatforms + geoFailedPlatforms + (hasLunarIsru ? 0 : cisFailedPlatforms);
    const earthReplacementsLaunched = Math.min(earthFailedPlatforms, Math.floor(remainingMass / sat.dryMass));
    remainingMass -= earthReplacementsLaunched * sat.dryMass;
    
    // Now allocate: LEO gets its survivors + replacements launched
    leoPlatforms = minLeo + leoReplacementsLaunched;
    
    // Other Earth-dependent shells share their replacement allocation proportionally
    if (earthFailedPlatforms > 0) {
      const earthReplaceFactor = earthReplacementsLaunched / earthFailedPlatforms;
      meoPlatforms = minMeo + Math.round(meoFailedPlatforms * earthReplaceFactor);
      geoPlatforms = minGeo + Math.round(geoFailedPlatforms * earthReplaceFactor);
      if (!hasLunarIsru) {
        cisPlatforms = minCis + Math.round(cisFailedPlatforms * earthReplaceFactor);
      }
      // If lunar ISRU active, cislunar grows independently (handled below)
    } else {
      meoPlatforms = minMeo;
      geoPlatforms = minGeo;
      if (!hasLunarIsru) {
        cisPlatforms = minCis;
      }
    }
    
    // Remaining capacity for NEW growth (beyond maintaining current fleet)
    const maxNewPlatforms = Math.floor(remainingMass / sat.dryMass);
    
    // Calculate growth targets (unconstrained - previous)
    // leoPlatforms here is after replacement allocation
    const leoGrowthWanted = Math.max(0, leoTarget - leoPlatforms);
    const meoGrowthWanted = Math.max(0, meoTarget - meoPlatforms);
    const geoGrowthWanted = Math.max(0, geoTarget - geoPlatforms);
    // Cislunar growth NOT limited by Earth launches after ISRU
    const cisGrowthWanted = hasLunarIsru ? 0 : Math.max(0, cisTarget - cisPlatforms);
    const totalGrowthWanted = leoGrowthWanted + meoGrowthWanted + geoGrowthWanted + cisGrowthWanted;
    
    if (totalGrowthWanted > 0 && maxNewPlatforms > 0) {
      const growthScaleFactor = Math.min(1, maxNewPlatforms / totalGrowthWanted);
      leoPlatforms += Math.round(leoGrowthWanted * growthScaleFactor);
      meoPlatforms += Math.round(meoGrowthWanted * growthScaleFactor);
      geoPlatforms += Math.round(geoGrowthWanted * growthScaleFactor);
      if (!hasLunarIsru) {
        cisPlatforms += Math.round(cisGrowthWanted * growthScaleFactor);
      }
    }
    
    // If lunar ISRU active, cislunar grows to its unconstrained target
    if (hasLunarIsru) {
      cisPlatforms = cisTarget;
    }
  }

  // ISRU growth applies even when NOT launch-constrained
  if (hasLunarIsru) {
    cisPlatforms = cisTarget;
  }

  // === Power by shell ===
  let leoPowerTw = (leoPlatforms * sat.powerKw) / 1e9;
  let meoPowerTw = (meoPlatforms * sat.powerKw * 0.8) / 1e9; // MEO Van Allen penalty
  let geoPowerTw = (geoPlatforms * geoPowerKw) / 1e9;
  let cisPowerTw = (cisPlatforms * cislunarPowerKw) / 1e9;
  let totalPowerTw = leoPowerTw + meoPowerTw + geoPowerTw + cisPowerTw;

  // Cap platforms at capacity (monotonic constraint could have pushed above)
  leoPlatforms = Math.min(leoPlatforms, maxLeoByMass);
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

  // Shell utilization - mass-based for LEO/cislunar, slot-based for GEO
  // LEO and cislunar are fundamentally mass-limited (debris, coordination)
  // GEO is slot-limited (ITU regulation, orbital positions)
  const leoMassKg = leoPlatforms * leoSatMassKg;
  const cisMassKg = cisPlatforms * cisSatMassKg;
  
  const leoUtil = SHELLS.leo.massCapacityKg > 0 ? leoMassKg / SHELLS.leo.massCapacityKg : 0;
  const meoUtil = SHELLS.meo.capacity > 0 ? meoPlatforms / SHELLS.meo.capacity : 0;
  const geoUtil = geoPlatforms / SHELLS.geo.capacity;  // GEO is slot-limited
  const cisUtil = SHELLS.cislunar.massCapacityKg > 0 ? cisMassKg / SHELLS.cislunar.massCapacityKg : 0;

  // Bandwidth constraint ratio for documentation (bwSell used for actual constraint)
  const _bwConstraintRatio = totalUnconstrainedBw > 0 ? bwAvailGbps / totalUnconstrainedBw : 1;

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
  // Note: After lunar ISRU (2055), cislunar is self-sustaining so only Earth shells matter
  if (launchConstrained) {
    // Calculate the actual constraint ratio using Earth-dependent flights only
    const launchRatio = earthRequiredFlights > 0 ? maxLaunchesThisYear / earthRequiredFlights : 1;
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

  // Fleet mass using shell-specific satellite masses
  const fleetMassKg =
    leoPlatforms * leoSatMassKg +
    meoPlatforms * leoSatMassKg +
    geoPlatforms * geoSatMassKg +
    cisPlatforms * cisSatMassKg;

  const avgPlatformMassKg = totalPlatforms > 0 ? fleetMassKg / totalPlatforms : leoSatMassKg;
  const starshipFlightsToDeploy = fleetMassKg / STARSHIP_PAYLOAD_KG;

  // Annual deployment: new platforms + replacements (shell-weighted)
  const newPlatformsThisYear = Math.max(0, totalPlatforms - prevTotalPlatforms);
  const leoReplaceMassKgFinal = leoPlatforms * replacementRate * leoSatMassKg;
  const meoReplaceMassKgFinal = meoPlatforms * replacementRate * leoSatMassKg;
  const geoReplaceMassKgFinal = geoPlatforms * replacementRate * geoSatMassKg;
  const cisReplaceMassKgFinal = cisPlatforms * replacementRate * cisSatMassKg;
  const replacementMassKg = leoReplaceMassKgFinal + meoReplaceMassKgFinal + geoReplaceMassKgFinal + cisReplaceMassKgFinal;
  const newDeploymentMassKg = newPlatformsThisYear * avgPlatformMassKg;
  const annualMassKg = newDeploymentMassKg + replacementMassKg;
  const annualStarshipFlights = annualMassKg / STARSHIP_PAYLOAD_KG;

  // Update previous MASS for next iteration (mass-based monotonic constraint)
  prevLeoMassKg = leoPlatforms * leoSatMassKg;
  prevMeoMassKg = meoPlatforms * leoSatMassKg;  // MEO uses same sat design
  prevGeoMassKg = geoPlatforms * geoSatMassKg;
  prevCisMassKg = cisPlatforms * cisSatMassKg;
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
  prevLeoMassKg = 0;
  prevMeoMassKg = 0;
  prevGeoMassKg = 0;
  prevCisMassKg = 0;
  prevTotalPlatforms = 0;
}
