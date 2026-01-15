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
  // Launch floor depends on Starship availability and year
  // Before starshipYear: conventional ~$300/kg (Falcon 9, etc.)
  // After starshipYear (if starshipOn): params.launchFloor (default $15/kg)

  let cost = params.launchCost;
  for (let y = 2026; y < year; y++) {
    const demandPressure = getDemandPressure(y, params);
    const orbitalLearningMult = Math.pow(demandPressure, 1.5); // 0.09x to 2.83x
    const effectiveLearn = params.launchLearn * orbitalLearningMult;
    cost *= (1 - effectiveLearn);
    
    // Floor changes when Starship becomes operational
    const floorForYear = (params.starshipOn && y >= params.starshipYear) ? params.launchFloor : 300;
    cost = Math.max(floorForYear, cost);
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
 * 
 * PHYSICAL LIMITS:
 * - Silicon: ~100,000 GFLOPS/W theoretical max (Landauer limit + real losses)
 * - Current H100: 2,800 GFLOPS/W (2023)
 * - Learning rate slows as we approach limits
 */
export function getGroundEfficiency(year: number, params: Params): number {
  // Physical ceiling for silicon-based compute (GFLOPS/W)
  // Beyond this requires fundamentally new physics (photonic, quantum, etc.)
  const SILICON_EFFICIENCY_CEILING = 100000;
  
  let baseEff = 2800; // H100 baseline: 2800 GFLOPS/W
  for (let y = 2026; y < year; y++) {
    const demandPressure = getDemandPressure(y, params);
    const groundLearningMult = 0.7 + 0.3 * demandPressure; // 0.76x to 1.3x
    
    // Learning rate decays as we approach ceiling (S-curve)
    // At 50% of ceiling, learning is halved; at 90%, learning is 10%
    const ceilingProximity = baseEff / SILICON_EFFICIENCY_CEILING;
    const ceilingPenalty = Math.max(0.05, 1 - ceilingProximity);
    
    const baseLearn = Math.max(0.03, params.aiLearn - (y - 2026) * 0.007);
    baseEff *= (1 + baseLearn * groundLearningMult * ceilingPenalty);
    
    // Hard cap at ceiling
    baseEff = Math.min(baseEff, SILICON_EFFICIENCY_CEILING);
  }

  // SMR/Fusion efficiency boost: abundant cheap power enables
  // - More aggressive liquid cooling
  // - Higher power density without thermal throttling
  // - Always-on operation (no demand response throttling)
  let energyEffBoost = 1.0;
  if (params.smrOn && year >= params.smrYear) {
    const smrMaturity = Math.min(1, (year - params.smrYear) / 8);
    energyEffBoost *= 1 + 0.15 * smrMaturity;  // Up to 15% efficiency boost
  }
  if (params.fusionOn && year >= params.fusionYear) {
    const fusionMaturity = Math.min(1, (year - params.fusionYear) / 10);
    energyEffBoost *= 1 + 0.25 * fusionMaturity;  // Up to 25% efficiency boost
  }
  baseEff *= energyEffBoost;

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
 * 
 * PHYSICAL LIMITS: Same silicon ceiling as ground (~100k GFLOPS/W)
 */
export function getOrbitalEfficiency(year: number, params: Params): number {
  // Physical ceiling for silicon-based compute
  const SILICON_EFFICIENCY_CEILING = 100000;
  
  // Get base efficiency with demand-coupled learning (without paradigm multipliers)
  let baseEff = 2800;
  for (let y = 2026; y < year; y++) {
    const demandPressure = getDemandPressure(y, params);
    const groundLearningMult = 0.7 + 0.3 * demandPressure; // 0.76x to 1.3x
    
    // Learning rate decays as we approach ceiling (S-curve)
    const ceilingProximity = baseEff / SILICON_EFFICIENCY_CEILING;
    const ceilingPenalty = Math.max(0.05, 1 - ceilingProximity);
    
    const baseLearn = Math.max(0.03, params.aiLearn - (y - 2026) * 0.007);
    baseEff *= (1 + baseLearn * groundLearningMult * ceilingPenalty);
    
    // Hard cap at ceiling
    baseEff = Math.min(baseEff, SILICON_EFFICIENCY_CEILING);
  }

  // NOTE: Radiation penalty is now applied in satellite.ts via radDirectPenalty
  // The penalty used to decay over time here, but now it's a direct constant penalty
  // to make the radPen slider behave more predictably for users

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

  // AI LEARNING CORRELATION: Faster AI progress → better compression, smarter protocols
  // If compute efficiency improves X%/year, bandwidth efficiency improves similarly
  // This ensures scenarios maintain consistent relative advantage
  const aiLearnRatio = params.aiLearn / 0.20;  // Relative to baseline (0.20 is default aiLearn)
  const effectiveBwGrowth = params.bwGrowth * (0.5 + 0.5 * aiLearnRatio);  // Scale growth rate

  let bw = params.bandwidth * Math.pow(1 + effectiveBwGrowth, year - 2026);

  // STARSHIP ERA: Bandwidth infrastructure scales with cheap launch
  // - More relay satellite constellations
  // - Denser ground station networks
  // - Free-space optical links between compute platforms
  // Conservative 3× multiplier (not 10×) - bandwidth infrastructure
  // takes longer to build than satellites, ground stations are the bottleneck
  const launchCost = getLaunchCost(year, params);
  if (launchCost < 200) {
    const starshipMaturity = Math.min(1, (200 - launchCost) / 185); // 0→1 as cost drops
    const starshipBwMult = 1 + starshipMaturity * 2; // 1x → 3x (conservative)
    bw *= starshipBwMult;
  }

  // Thermo/photonic breakthroughs drive bandwidth infrastructure investment
  // (laser links, more ground stations, better spectrum utilization)
  // Conservative 2× multiplier over time - these techs reduce compute I/O needs
  // but don't directly scale bandwidth infrastructure
  if (hasThermoCompute || hasPhotonic) {
    const techYear = Math.min(
      hasThermoCompute ? params.thermoYear : Infinity,
      hasPhotonic ? params.photonicYear : Infinity
    );
    const yearsPost = year - techYear;
    // Smooth asymptotic growth: starts at 1x, grows to 2x over ~10 years
    const bwBoost = 1 + 1 * (1 - Math.exp(-yearsPost / 5));
    bw *= bwBoost;
  }

  return bw;
}

/**
 * Calculate effective bandwidth requirement per TFLOP.
 * Uses token-based model for realistic network I/O requirements.
 *
 * Derivation from first principles:
 * - Llama-70B: 140 GFLOPs per token
 * - Average response: 4 bytes per token (output)
 * - Average request: ~16 bytes per token (input context)
 * - Total I/O: ~20 bytes per token round-trip
 *
 * For 1 TFLOP (1e12 FLOPs):
 * - Tokens = 1e12 / 140e9 = 7.14 tokens
 * - Bytes = 7.14 × 20 = 143 bytes
 * - Gbps = 143 × 8 / 1e9 = 1.14e-6 Gbps/TFLOP
 *
 * The gbpsPerTflop slider scales this baseline value (default 1e-6 = 1x).
 */
export function getEffectiveBwPerTflop(year: number, params: Params): number {
  const hasThermoCompute = params.thermoOn && year >= params.thermoYear;
  const hasPhotonic = params.photonicOn && year >= params.photonicYear;

  // Token-based bandwidth calculation
  const flopsPerToken = params.flopsPerToken || 140e9;
  const bytesPerToken = params.bytesPerToken || 4;
  // Include input context (roughly 4× output tokens for typical inference)
  const totalBytesPerToken = bytesPerToken * 5;  // input + output

  // Gbps per TFLOP = (tokens/TFLOP) × (bytes/token) × 8 bits/byte / 1e9
  // tokens/TFLOP = 1e12 FLOPs / flopsPerToken
  const tokensPerTflop = 1e12 / flopsPerToken;
  let bwPerTflop = (tokensPerTflop * totalBytesPerToken * 8) / 1e9;

  // Apply gbpsPerTflop slider as a multiplier relative to baseline (~1e-6)
  // Default gbpsPerTflop = 1e-6 = 1x multiplier
  // User can adjust to model different workload profiles (real-time vs batch)
  const baselineBwPerTflop = 1e-6;  // ~1 kbps/TFLOP from token-based physics
  const userMultiplier = (params.gbpsPerTflop || baselineBwPerTflop) / baselineBwPerTflop;
  bwPerTflop *= userMultiplier;

  // AI LEARNING → SMARTER PROTOCOLS: Higher aiLearn means better compression
  // Smarter AI systems use more efficient data representations and protocols
  // This prevents high-efficiency scenarios from being artificially bandwidth-limited
  // The reduction compounds similarly to how efficiency gains compound
  const t = year - 2026;
  const baseAiLearn = 0.20;  // Baseline scenario aiLearn
  const aiLearnRatio = params.aiLearn / baseAiLearn;
  // Compression improves at ~10% of the efficiency improvement rate
  const compressionImprovement = Math.pow(1 + (params.aiLearn - baseAiLearn) * 0.3, t);
  bwPerTflop /= compressionImprovement;

  // Thermo/photonic computing reduces I/O (more computation per token)
  if (hasThermoCompute || hasPhotonic) {
    const techYear = Math.min(
      hasThermoCompute ? params.thermoYear : Infinity,
      hasPhotonic ? params.photonicYear : Infinity
    );
    const yearsPost = year - techYear;
    // Advanced paradigms reduce bandwidth needs by up to 20x
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
 * Power scales with technology breakthroughs AND launch cost.
 *
 * KEY INSIGHT: When launch is cheap (Starship), you build BIGGER satellites:
 * - More mass → more solar panels → more power → more compute
 * - At $15/kg, a 100-ton satellite is economically viable
 * - At $1500/kg, you optimize for mass → 20-ton satellites
 * 
 * PHYSICAL LIMITS:
 * - Structural: ~50 MW max for deployable solar arrays (ISS-derived)
 * - Orbital mechanics: massive platforms have drag/debris concerns
 * - Manufacturing: Even SpaceX-scale production has limits
 */
export function getLEOPower(year: number, params: Params): number {
  // Maximum LEO platform power (kW) - physical/practical limit
  const MAX_LEO_SOLAR_POWER = 20000;  // 20 MW - very aggressive but theoretically achievable
  
  const t = year - 2026;
  const hasThermal = params.thermalOn && year >= params.thermalYear;
  const hasFission = params.fissionOn && year >= params.fissionYear;
  const hasFusion = params.fusionOn && year >= params.fusionYear;

  // Get launch cost and compute smooth Starship blend
  const launchCost = getLaunchCost(year, params);
  const starshipBlend = Math.max(0, Math.min(1, (800 - launchCost) / 750));
  
  // Base power grows continuously regardless of tech
  // Higher baseline growth to reduce thermal's relative impact
  const basePower = 100 + t * 40; // 100 kW → 1.9 MW over 45 years
  
  // Starship multiplier: gradual increase as Starship matures
  const starshipMult = 1.0 + starshipBlend * 2.0; // 1x → 3x with full Starship
  
  // Thermal multiplier: MORE GRADUAL ramp over 20 years
  // Reduced from 10x to 5x to minimize path-dependency issues in fleet model
  // This ensures delaying thermal always reduces fleet power
  let thermalMult = 1.0;
  if (hasThermal) {
    const yearsSinceThermal = year - params.thermalYear;
    const thermalMaturity = Math.min(1, Math.max(0, yearsSinceThermal) / 20);
    thermalMult = 1.0 + thermalMaturity * 4.0; // 1x → 5x over 20 years
  }
  
  // Final solar power combines all multipliers smoothly, capped at physical limit
  let solarPower = Math.min(MAX_LEO_SOLAR_POWER, basePower * starshipMult * thermalMult);

  // FUSION POWER IN LEO
  let fusionPower = 0;
  if (hasFusion) {
    const fusionMaturity = Math.min(1, (year - params.fusionYear) / 8);
    fusionPower = 5000 + fusionMaturity * 45000; // 5 MW → 50 MW
  }

  // FISSION in LEO: Only if it beats solar (rarely true)
  let fissionPower = 0;
  if (hasFission && !hasThermal && starshipBlend < 0.5) {
    const fissionMaturity = Math.min(1, (year - params.fissionYear) / 10);
    fissionPower = 500 + fissionMaturity * 1500;
  }

  return Math.max(solarPower, fusionPower, fissionPower);
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
    // Fusion: 1 GW - 10 GW cislunar stations
    // No orbital debris concerns, unlimited space, can build truly massive platforms
    // Heat rejection easier in deep space (no Earth albedo/IR loading)
    const fusionMaturity = Math.min(1, (year - params.fusionYear) / 10);
    return 1000000 + fusionMaturity * 9000000; // 1 GW → 10 GW
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
