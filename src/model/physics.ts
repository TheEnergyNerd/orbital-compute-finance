import { STEFAN_BOLTZMANN, SHELL_COST_MULT } from './constants';
import type { Params } from './types';
import { getDemandPressure } from './market';

/**
 * Physics calculations for orbital compute model.
 * All calculations are derived from first principles.
 */

// =====================================================
// THERMAL: First-principles radiative balance
// =====================================================

/**
 * Calculate net radiator heat rejection (W/m²) using Stefan-Boltzmann.
 * q_net = q_emit - q_abs
 *
 * @param params - Model parameters
 * @param year - Current year
 * @param inEclipse - Whether satellite is in Earth's shadow
 * @returns Net heat rejection in W/m² (clamped to minimum 1 W/m²)
 */
export function getRadiatorNetWPerM2(params: Params, year: number, inEclipse: boolean): number {
  const sigma = 5.670374419e-8;  // Stefan-Boltzmann constant
  const T = params.radTempK || 350;
  const eps = params.radEmissivity || 0.85;
  const sides = (params.radTwoSided !== false) ? 2 : 1;

  // Emitted power: ε × σ × T⁴ × sides
  const q_emit = sides * eps * sigma * Math.pow(T, 4);

  // Absorbed heat depends on eclipse state
  // During eclipse, solar + albedo → 0, Earth IR remains
  const q_solar = inEclipse ? 0 : (params.qSolarAbsWPerM2 || 200);
  const q_albedo = inEclipse ? 0 : (params.qAlbedoAbsWPerM2 || 50);
  const q_earthIR = params.qEarthIrAbsWPerM2 || 150;

  const q_abs = q_solar + q_albedo + q_earthIR;
  const q_net = q_emit - q_abs;

  // Guardrail: prevent negative/zero rejection (invalid design)
  return Math.max(1, q_net);
}

/**
 * Get eclipse fraction for a given orbital shell.
 * Simple model: constant per shell, user-overridable.
 *
 * @param params - Model parameters
 * @param year - Current year (for future time-varying effects)
 * @param shell - Orbital shell name
 * @returns Fraction of orbit in eclipse (0-1)
 */
export function getEclipseFraction(params: Params, year: number, shell = 'leo'): number {
  // If user has set a global override, use it
  if (params.eclipseFrac !== undefined && params.eclipseFrac > 0) {
    return params.eclipseFrac;
  }

  // Default eclipse fractions by shell
  const eclipseFractions: Record<string, number> = {
    leo: 0.35,       // ~35% for 550km orbit
    meo: 0.10,       // Much less eclipse at higher altitude
    geo: 0.01,       // Rare eclipses at GEO
    cislunar: 0.02   // Minimal eclipse in cislunar space
  };

  return eclipseFractions[shell] || 0.35;
}

/**
 * Calculate launch cost per kg for a given year and orbital shell.
 * Applies demand-coupled Wright's Law learning curve with floor constraint.
 * High demand accelerates cost reductions through increased production volume.
 */
export function getLaunchCost(year: number, params: Params, shell = 'leo'): number {
  // Launch floor depends on Starship availability
  // Starship: $15/kg (propellant + amortization + ops)
  // Conventional (Falcon 9, etc.): ~$300/kg
  const launchFloor = params.starshipOn ? 15 : 300;

  let cost = params.launchCost;
  for (let y = 2026; y < year; y++) {
    const demandPressure = getDemandPressure(y, params);
    const orbitalLearningMult = Math.pow(demandPressure, 1.5); // 0.09x to 2.83x
    const effectiveLearn = params.launchLearn * orbitalLearningMult;
    cost *= (1 - effectiveLearn);
    cost = Math.max(launchFloor, cost);
  }
  return cost * (SHELL_COST_MULT[shell] || 1.0);
}

export function getRadiatorMassPerMW(year: number, powerKw: number, params: Params): number {
  // Higher temp = more radiation = less area = less mass
  // Higher emissivity = more radiation = less mass
  const tempFactor = Math.pow(350 / params.opTemp, 4);
  const emissivityFactor = 0.85 / params.emissivity;

  if (!params.thermalOn || year < params.thermalYear) {
    // Conventional: base ~4500 kg/MW at reference conditions
    const baseMass = Math.max(800, (4500 * tempFactor * emissivityFactor) - (year - 2026) * params.radLearn);
    const powerPenalty = 1 + (powerKw / 200) * 0.3;
    return baseMass * powerPenalty;
  }

  // Advanced thermal (droplet radiators):
  // Stefan-Boltzmann: at 350K, 723 W/m². At 0.3-0.5 kg/m²: 415-690 kg/MW
  // At higher temps (500K): ~100 kg/MW achievable
  // Model: 50-100 kg/MW mature (aggressive but within physics bounds)
  const maturity = Math.min(1, (year - params.thermalYear) / 8);
  const advancedBase = 100 - maturity * 50; // 100 kg/MW → 50 kg/MW over 8 years
  return advancedBase * tempFactor * emissivityFactor;
}

/**
 * Calculate radiator power per unit area using Stefan-Boltzmann law.
 * P = εσT⁴
 */
export function getRadiatorPower(params: Params): number {
  return params.emissivity * STEFAN_BOLTZMANN * Math.pow(params.opTemp, 4);
}

/**
 * Calculate ground compute efficiency (GFLOPS/W) for a given year.
 * Applies demand-coupled Wright's Law learning and workload-weighted
 * multipliers for photonic (deterministic) and thermodynamic (probabilistic) computing.
 */
export function getGroundEfficiency(year: number, params: Params): number {
  let baseEff = 2800; // H100 baseline: 2800 GFLOPS/W
  for (let y = 2026; y < year; y++) {
    const demandPressure = getDemandPressure(y, params);
    const groundLearningMult = 0.7 + 0.3 * demandPressure; // 0.76x to 1.3x
    const baseLearn = Math.max(0.03, params.aiLearn - (y - 2026) * 0.007);
    baseEff *= (1 + baseLearn * groundLearningMult);
  }

  const hasThermoCompute = params.thermoOn && year >= params.thermoYear;
  const hasPhotonic = params.photonicOn && year >= params.photonicYear;

  // Workload-weighted efficiency for advanced computing paradigms
  if (hasThermoCompute || hasPhotonic) {
    const deterministicFrac = 1 - params.workloadProbabilistic;
    const probFrac = params.workloadProbabilistic;
    const photonicMult = hasPhotonic ? params.photonicGroundMult : 1;
    const thermoMult = hasThermoCompute ? params.thermoGroundMult : 1;
    return baseEff * (photonicMult * deterministicFrac + thermoMult * probFrac);
  }

  return baseEff;
}

/**
 * Calculate orbital compute efficiency (GFLOPS/W) for a given year.
 * Applies radiation penalty and workload-weighted multipliers.
 * Space benefits from vacuum optics (photonic) and passive cryo cooling (thermodynamic).
 */
export function getOrbitalEfficiency(year: number, params: Params): number {
  // Get base efficiency with demand-coupled learning (without paradigm multipliers)
  let baseEff = 2800;
  for (let y = 2026; y < year; y++) {
    const demandPressure = getDemandPressure(y, params);
    const groundLearningMult = 0.7 + 0.3 * demandPressure; // 0.76x to 1.3x
    const baseLearn = Math.max(0.03, params.aiLearn - (y - 2026) * 0.007);
    baseEff *= (1 + baseLearn * groundLearningMult);
  }

  // Apply radiation penalty to base silicon efficiency
  const penalty = params.radPen * Math.pow(0.82, year - 2026);
  baseEff *= (1 - Math.max(0.02, penalty));

  const hasThermoCompute = params.thermoOn && year >= params.thermoYear;
  const hasPhotonic = params.photonicOn && year >= params.photonicYear;

  // Workload-weighted efficiency with space-specific multipliers
  if (hasThermoCompute || hasPhotonic) {
    const deterministicFrac = 1 - params.workloadProbabilistic;
    const probFrac = params.workloadProbabilistic;
    const photonicMult = hasPhotonic ? params.photonicSpaceMult : 1;  // vacuum optics
    const thermoMult = hasThermoCompute ? params.thermoSpaceMult : 1; // passive cryo
    return baseEff * (photonicMult * deterministicFrac + thermoMult * probFrac);
  }

  return baseEff;
}

export function getBandwidth(year: number, params: Params): number {
  const hasThermoCompute = params.thermoOn && year >= params.thermoYear;
  const hasPhotonic = params.photonicOn && year >= params.photonicYear;

  let bw = params.bandwidth * Math.pow(1 + params.bwGrowth, year - 2026);

  // Thermo/photonic breakthroughs drive bandwidth infrastructure investment
  // (laser links, more ground stations, better spectrum utilization)
  // Smooth exponential growth to avoid oscillation with fleet scaling
  if (hasThermoCompute || hasPhotonic) {
    const techYear = Math.min(
      hasThermoCompute ? params.thermoYear : Infinity,
      hasPhotonic ? params.photonicYear : Infinity
    );
    const yearsPost = year - techYear;
    // Smooth asymptotic growth: starts at 1x, grows to 10x over ~15 years
    const bwBoost = 1 + 9 * (1 - Math.exp(-yearsPost / 5));
    bw *= bwBoost;
  }

  return bw;
}

/**
 * Calculate effective bandwidth requirement per TFLOP.
 * DEPRECATED: Use getCommsTflopsLimit for new code.
 * Kept for backwards compatibility.
 */
export function getEffectiveBwPerTflop(year: number, params: Params): number {
  const hasThermoCompute = params.thermoOn && year >= params.thermoYear;
  const hasPhotonic = params.photonicOn && year >= params.photonicYear;

  let bwPerTflop = params.gbpsPerTflop;

  if (hasThermoCompute || hasPhotonic) {
    const techYear = Math.min(
      hasThermoCompute ? params.thermoYear : Infinity,
      hasPhotonic ? params.photonicYear : Infinity
    );
    const yearsPost = year - techYear;
    // Smooth exponential decay: starts at 1x, asymptotes to 0.05x (20x reduction)
    // Half-life of ~5 years for gradual transition
    const reductionFactor = 0.05 + 0.95 * Math.exp(-yearsPost / 5);
    bwPerTflop *= reductionFactor;
  }

  return bwPerTflop;
}

// =====================================================
// BANDWIDTH: Goodput → bytes/FLOP → TFLOPs model
// =====================================================

/**
 * Calculate platform goodput (effective data rate after losses).
 * goodput = terminalGoodputGbps × contactFraction × (1 - protocolOverhead)
 *
 * @param params - Model parameters
 * @param year - Current year (for future tech scaling)
 * @returns Effective goodput in Gbps
 */
export function getPlatformGoodputGbps(params: Params, year: number): number {
  const terminalGoodput = params.terminalGoodputGbps || 20;  // 20 Gbps baseline
  const contactFrac = params.contactFraction || 0.25;        // 25% visibility
  const overhead = params.protocolOverhead || 0.15;          // 15% overhead

  let goodput = terminalGoodput * contactFrac * (1 - overhead);

  // Tech improvements over time (laser links, more ground stations)
  const t = year - 2026;
  const techMult = 1 + t * 0.05;  // 5% annual improvement
  goodput *= Math.min(10, techMult);  // Cap at 10x improvement

  return goodput;
}

/**
 * Calculate maximum TFLOPs deliverable given bandwidth constraint.
 * Uses bytes/FLOP to convert goodput to compute capacity.
 *
 * @param params - Model parameters
 * @param year - Current year
 * @returns Maximum TFLOPs limited by bandwidth
 */
export function getCommsTflopsLimit(params: Params, year: number): number {
  const goodputGbps = getPlatformGoodputGbps(params, year);
  const goodputBytesPerSec = (goodputGbps * 1e9) / 8;

  // bytes/FLOP determines how much compute per byte of IO
  const bytesPerFlop = params.bytesPerFlop || 0.05;  // 0.05 bytes/FLOP default

  // FLOPs/sec = (bytes/sec) / (bytes/FLOP)
  const flopsPerSec = goodputBytesPerSec / bytesPerFlop;

  // Convert to TFLOPs
  return flopsPerSec / 1e12;
}

// =====================================================
// TOKENS: FLOPs-based model
// =====================================================

/**
 * Calculate tokens per second from TFLOPs.
 * Uses flopsPerToken parameter instead of hardcoded constants.
 *
 * @param tflops - Compute capacity in TFLOPs
 * @param params - Model parameters
 * @returns Tokens per second
 */
export function getTokensPerSecond(tflops: number, params: Params): number {
  // flopsPerToken: typical values:
  //   - Llama-7B: ~14 GFLOPs/token
  //   - Llama-70B: ~140 GFLOPs/token
  //   - GPT-4 class: ~1800 GFLOPs/token (estimated)
  const flopsPerToken = params.flopsPerToken || 140e9;  // Default: Llama-70B

  const flopsPerSec = tflops * 1e12;
  return flopsPerSec / flopsPerToken;
}

/**
 * Calculate tokens per year from TFLOPs.
 *
 * @param tflops - Compute capacity in TFLOPs
 * @param params - Model parameters
 * @param availability - Fraction of time available (0-1)
 * @returns Tokens per year
 */
export function getTokensPerYear(tflops: number, params: Params, availability = 0.99): number {
  const tokensPerSec = getTokensPerSecond(tflops, params);
  const secondsPerYear = 8760 * 3600;
  return tokensPerSec * secondsPerYear * availability;
}

/**
 * Calculate LEO platform power capacity (kW) for a given year.
 * Power scales with technology breakthroughs.
 */
export function getLEOPower(year: number, params: Params): number {
  const t = year - 2026;
  const hasThermal = params.thermalOn && year >= params.thermalYear;
  const hasFission = params.fissionOn && year >= params.fissionYear;
  const hasFusion = params.fusionOn && year >= params.fusionYear;

  // Compact fusion enables 5-50 MWe in LEO
  // Nuclear has strong economies of scale - a 50 MW plant has much better $/W than 5 MW
  // This also makes thermal a binding constraint, so radiator sliders work
  if (hasFusion) {
    // Fusion: 5-50 MWe platforms, scaling with maturity
    // Start at 5 MWe, grow to 50 MWe over 10 years as tech matures
    const maturity = Math.min(1, (year - params.fusionYear) / 10);
    return 5000 + maturity * 45000; // 5 MW → 50 MW
  }
  if (hasFission) {
    // Fission: 5-20 MW platforms (optimal for LEO latency-sensitive workloads)
    return 5000 + Math.min(1, (year - params.fissionYear) / 10) * 15000;
  }
  if (hasThermal) {
    // Thermal breakthrough (droplet radiators) removes heat rejection as bottleneck
    // BUT still limited by practical solar array size:
    // - 1 MW needs ~2,500 m² of panels (half a football field)
    // - ISS has 2,500 m² for just 120 kW
    // - Practical limit ~500 kW - 1 MW even with perfect heat rejection
    const maturity = Math.min(1, (year - params.thermalYear) / 6);
    return 500 + maturity * 500; // 500 kW → 1 MW (array-limited, not thermal-limited)
  }
  // Conventional solar: limited by thermal rejection capacity
  // Can't dump waste heat fast enough, even if you had more panels
  return Math.min(250, params.basePower * 0.8 + t * 5);
}

/**
 * Calculate cislunar platform power capacity (kW) for a given year.
 * Requires advanced power systems for viable operations.
 */
export function getCislunarPower(year: number, params: Params): number {
  const hasFission = params.fissionOn && year >= params.fissionYear;
  const hasFusion = params.fusionOn && year >= params.fusionYear;
  const hasThermal = params.thermalOn && year >= params.thermalYear;

  if (hasFusion) {
    // Fusion: 500 MW - 2 GW stations
    return 500000 + Math.min(1, (year - params.fusionYear) / 10) * 1500000;
  }
  if (hasFission) {
    // Fission: 50-150 MW platforms
    return 50000 + Math.min(1, (year - params.fissionYear) / 10) * 100000;
  }
  if (hasThermal && (year - params.thermalYear) >= 5) {
    // Thermal-only cislunar is barely viable - massive solar arrays needed
    // Same array limitations as LEO, but logistics are harder
    // Practical limit: 1-2 MW max for early cislunar with just solar
    const maturity = Math.min(1, (year - params.thermalYear - 5) / 5);
    return 1000 + maturity * 1000; // 1 MW → 2 MW (array-limited)
  }
  return 0; // Cislunar not viable without thermal breakthrough at minimum
}
