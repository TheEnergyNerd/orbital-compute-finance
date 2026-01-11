import { SLA, SOLAR_CONSTANT, STEFAN_BOLTZMANN } from './constants';
import type { Params, SatelliteResult, ConstraintLimits, ConstraintMargins } from './types';
import {
  getLEOPower,
  getCislunarPower,
  getLaunchCost,
  getRadiatorMassPerMW,
  getRadiatorPower,
  getOrbitalEfficiency,
  getEffectiveBwPerTflop,
  getRadiatorNetWPerM2,
  getEclipseFraction,
  getCommsTflopsLimit
} from './physics';
import { getShellRadiationEffects } from './orbital';
import { getCRF } from './finance';
import { getDemandPressure } from './market';

/**
 * Calculate satellite economics including LCOC (Levelized Cost of Compute).
 * This is the core calculation that determines orbital vs ground competitiveness.
 */
export function calcSatellite(
  year: number,
  params: Params,
  shell = 'leo'
): SatelliteResult {
  const t = year - 2026;
  const hasThermal = params.thermalOn && year >= params.thermalYear;
  const hasFission = params.fissionOn && year >= params.fissionYear;
  const hasFusion = params.fusionOn && year >= params.fusionYear;
  const hasThermoCompute = params.thermoOn && year >= params.thermoYear;
  const hasPhotonicCompute = params.photonicOn && year >= params.photonicYear;

  // Platform specifications - use correct power function based on shell
  const powerKw = (shell === 'cislunar')
    ? getCislunarPower(year, params)
    : getLEOPower(year, params);
  const solarEff = Math.min(0.5, params.solarEff + t * params.solarLearn);
  const radPower = getRadiatorPower(params);
  const gflopsW = getOrbitalEfficiency(year, params);
  const launchCost = getLaunchCost(year, params, shell);

  // =====================================================
  // GOLD-PLATED PAYLOAD FIX - SMOOTH COTS BLEND
  // =====================================================
  // When launch is cheap, we use COTS hardware with shielding instead of
  // expensive rad-hard hardware. Uses smooth interpolation to avoid kinks:
  // - cotsBlend = 0 at $500/kg (fully rad-hard)
  // - cotsBlend = 1 at $100/kg (fully COTS)
  // - Linear blend between
  const cotsBlend = Math.max(0, Math.min(1, (500 - launchCost) / 400));
  const isStarshipEra = cotsBlend > 0.5;  // For backward compatibility

  // Demand-coupled manufacturing learning (Wright's Law)
  let prodMult = params.prodMult;
  for (let y = 2026; y < year; y++) {
    const demandPressure = getDemandPressure(y, params);
    const orbitalLearningMult = Math.pow(demandPressure, 1.5); // 0.09x to 2.83x
    prodMult *= (1 - 0.32 * orbitalLearningMult);
  }
  prodMult = Math.max(0.25, prodMult);
  const radMassPerMW = getRadiatorMassPerMW(year, powerKw, params);

  // Radiation effects
  const radEffects = getShellRadiationEffects(shell, year, params);

  // Power source mass
  // Note: LEO satellites use fission even when fusion is available
  // (fusion reactors too large for LEO; fusion benefits cislunar only)
  let powerMass = 0;
  let battMass = 0;

  // Constants for LEO Orbit Physics
  const ECLIPSE_FRACTION = 0.40; // ~40% of orbit in shadow
  const SUNLIGHT_FRACTION = 1.0 - ECLIPSE_FRACTION;
  const BATTERY_HEADROOM = 1.2;  // Safety margin so we don't drain to 0%

  // Track fusion-specific waste heat for combined radiator sizing
  let fusionWasteKw = 0;

  if (hasFusion) {
    // Compact Magneto-Electrostatic Mirror Fusion
    // Engineering specs: 150 W/kg, 1.6m × 8m for 5 MWe
    // Uses SCO2 Brayton recompression cycle at 50% thermal efficiency
    // → 1 MWth waste heat per 1 MWe electrical
    const FUSION_W_PER_KG = 150; // Real engineering estimate (linear scaling 1-5 MWe)
    powerMass = (powerKw * 1000) / FUSION_W_PER_KG;
    // Fusion waste heat from SCO2 cycle (50% efficiency → equal thermal waste)
    fusionWasteKw = powerKw; // 1 MWth per 1 MWe
    // Fusion doesn't need batteries (continuous generation)
  } else if (hasFission) {
    // Fission: ~50 W/kg for advanced MegaPower designs
    // Formula: mass = power / specific_power = (kW × 1000) / (W/kg)
    // At 50 W/kg: 5 MW = 5000 kW × 1000 / 50 = 100,000 kg = 100 tons
    const FISSION_W_PER_KG = 50;
    powerMass = (powerKw * 1000) / FISSION_W_PER_KG;
    // Fission doesn't need batteries (continuous generation)
  } else {
    // Solar Sizing: Must generate enough excess power in sunlight to cover the eclipse period
    const generationDutyCycle = SUNLIGHT_FRACTION;
    const panelArea = (powerKw * 1000) / (solarEff * SOLAR_CONSTANT * generationDutyCycle);

    // Solar: area × areal density (2.0 kg/m² for thin-film, Starlink V2 Mini ~2.3 kg/m²)
    powerMass = panelArea * 2.0;

    // Battery Sizing: Must store enough energy to power the payload through eclipse
    // Eclipse duration is approx 35-40 mins (~0.6 hours)
    const battDens = Math.min(1000, params.battDens + t * 35);
    const eclipseHours = (90 / 60) * ECLIPSE_FRACTION; // ~0.6 hours
    const requiredStorageWh = (powerKw * 1000) * eclipseHours * BATTERY_HEADROOM;
    battMass = requiredStorageWh / battDens;
  }

  // =====================================================
  // THERMAL CONSTRAINT MODEL - FIXED-POINT MASS CLOSURE
  // =====================================================
  // Radiator sizing is mass-closed via fixed-point iteration:
  // - Total dry mass influences radiator budget
  // - Radiator capacity then clips compute
  // - Iterate until stable (<=1% change) or max 20 iterations
  //
  // SEPARATE THERMAL LOOPS FOR FUSION:
  // - Fusion SCO2 cycle needs 293K rejection (low temp for compressor inlet)
  // - GPUs can reject at 350K (params.radTempK)
  // - Model these as separate radiator systems so fusion waste heat
  //   doesn't eat the compute thermal budget

  // Get eclipse-aware net flux for radiative balance
  const eclipseFrac = getEclipseFraction(params, year, shell);

  // Compute radiators: operate at GPU temperature (350K default)
  const qNetSunCompute = getRadiatorNetWPerM2(params, year, false);
  const qNetEclCompute = getRadiatorNetWPerM2(params, year, true);
  const qNetAvgCompute = (1 - eclipseFrac) * qNetSunCompute + eclipseFrac * qNetEclCompute;

  // Fusion radiators: operate at 320K (optimized SCO2 cycle)
  // Lower temp = less Stefan-Boltzmann power = need more area
  // Note: 293K was too conservative. Modern SCO2 cycles with dry cooling
  // reject at 310-340K. Space radiators at 320K are practical.
  let qNetAvgFusion = qNetAvgCompute;
  if (hasFusion) {
    const fusionRadTemp = 320; // K, optimized SCO2 rejection temp
    const sigma = 5.670374419e-8;
    const eps = params.radEmissivity || 0.85;
    const sides = (params.radTwoSided !== false) ? 2 : 1;

    // Fusion radiator emission (lower temp = lower power)
    const qEmitFusion = sides * eps * sigma * Math.pow(fusionRadTemp, 4);

    // Absorbed heat (same as compute radiators)
    const qSolarAbs = (params.qSolarAbsWPerM2 || 200);
    const qAlbedoAbs = (params.qAlbedoAbsWPerM2 || 50);
    const qEarthIrAbs = (params.qEarthIrAbsWPerM2 || 150);

    // Eclipse-weighted average
    const qAbsSun = qSolarAbs + qAlbedoAbs + qEarthIrAbs;
    const qAbsEcl = qEarthIrAbs;
    const qNetSunFusion = Math.max(1, qEmitFusion - qAbsSun);
    const qNetEclFusion = Math.max(1, qEmitFusion - qAbsEcl);
    qNetAvgFusion = (1 - eclipseFrac) * qNetSunFusion + eclipseFrac * qNetEclFusion;
  }

  // Radiator areal density (kg/m²) - varies with tech
  const radKgPerM2 = params.radKgPerM2 || (hasThermal ? 1.0 : 3.0);

  // Radiator mass budget as fraction of dry mass
  // Fusion platforms need MUCH higher radiator budget (50% vs 15%) because:
  // - 50% thermal efficiency → waste heat equals electrical output
  // - Low rejection temp (320K) requires more radiator area
  // - Fusion economies of scale justify the extra radiator mass
  const radMassFrac = hasFusion ? 0.50 : (params.radMassFrac || 0.15);

  // Waste heat fraction - CONSTANT regardless of compute paradigm
  // Physics: 1 watt consumed → ~1 watt of heat (First Law of Thermodynamics)
  // Photonic/thermo efficiency gains are in GFLOPS/W, NOT in heat per watt
  // The benefit is: fewer watts needed for same compute, not less heat per watt
  const wasteHeatFrac = params.wasteHeatFrac || 0.90;

  // Calculate data rate early (needed for comms mass estimation)
  const effectiveBwPerTflop = getEffectiveBwPerTflop(year, params);

  // Fixed subsystem masses (independent of iteration)
  const avionicsMassBase = 50 + powerKw * 0.02;
  const propulsionMassBase = 30;
  const aocsMassBase = 15 + powerKw * 0.01;

  // =====================================================
  // FIXED-POINT ITERATION FOR MASS CLOSURE
  // =====================================================
  let computeKw = powerKw * params.computeFrac;
  let radMass = 50;  // Initial guess (compute radiators)
  let fusionRadMass = 0;  // Fusion radiator mass (separate loop)
  let radAreaM2 = 0;
  let totalDryMass = 0;
  let thermalLimited = false;
  let radCapacityKw = 0;
  let invalidReason: string | undefined;
  let compMass = 0;
  let commsMass = 0;

  // Calculate fusion radiator mass FIRST (fixed, not iterated)
  // Fusion radiators are sized to reject fusionWasteKw at 293K
  if (hasFusion && fusionWasteKw > 0) {
    const fusionRejectW = fusionWasteKw * 1000;
    const fusionRadArea = fusionRejectW / qNetAvgFusion;
    fusionRadMass = fusionRadArea * radKgPerM2;
  }

  const MAX_ITERATIONS = 20;
  const CONVERGENCE_THRESHOLD = 0.01;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const wasteKw = computeKw * wasteHeatFrac;

    // Compute mass scales with power
    compMass = Math.max(3, computeKw * 5);

    // Estimate TFLOPS for comms sizing (rough, refined after convergence)
    const estTflops = computeKw * gflopsW;
    const estDataRateGbps = estTflops * effectiveBwPerTflop;
    commsMass = 20 + estDataRateGbps * 0.5;

    // Propulsion scales with payload
    const propulsionMass = propulsionMassBase + (powerMass + battMass + compMass) * 0.03;
    const otherMass = avionicsMassBase + propulsionMass + commsMass + aocsMassBase;

    // Total radiator mass = compute radiators + fusion radiators (separate loops)
    const totalRadMass = radMass + fusionRadMass;

    // Estimate dry mass with current radiator mass
    const baseMass = powerMass + battMass + compMass + totalRadMass + otherMass;
    const shieldMass = shell === 'leo' ? baseMass * 0.02 : baseMass * 0.15;
    const structMass = (baseMass + shieldMass) * 0.1;
    const estDryMass = baseMass + shieldMass + structMass;

    // Compute radiator budget - FUSION RADIATORS ARE EXCLUDED
    // Fusion radiators are part of the power system (like reactor shielding),
    // not competing with compute thermal budget. The radMassFrac applies
    // ONLY to compute radiators. This prevents fusion's massive 293K radiators
    // from eating the compute thermal budget.
    const computeRadBudget = Math.max(50, radMassFrac * estDryMass);

    // Derive max rejection from budget using areal density
    const maxArea = computeRadBudget / radKgPerM2;
    const maxRejectW = qNetAvgCompute * maxArea;
    const maxRejectKw = maxRejectW / 1000;

    // Compute thermal budget is SEPARATE from fusion (no longer shared)
    const thermalBudgetForCompute = maxRejectKw;

    // Thermal limit on compute
    const thermalLimitKw = thermalBudgetForCompute / wasteHeatFrac;
    const powerLimitKw = powerKw * params.computeFrac;
    const newComputeKw = Math.min(powerLimitKw, thermalLimitKw);

    // Update compute radiator sizing based on required rejection
    const reqRejectW = newComputeKw * wasteHeatFrac * 1000;
    const reqArea = reqRejectW / qNetAvgCompute;
    radAreaM2 = Math.min(reqArea, maxArea);
    const newRadMass = radAreaM2 * radKgPerM2;

    // Track radiator capacity (compute only - fusion is fixed)
    radCapacityKw = (qNetAvgCompute * radAreaM2) / 1000;

    // Check convergence
    const computeChange = Math.abs(newComputeKw - computeKw) / Math.max(1, computeKw);
    const massChange = Math.abs(newRadMass - radMass) / Math.max(1, radMass);

    computeKw = newComputeKw;
    radMass = newRadMass;
    totalDryMass = estDryMass;
    thermalLimited = computeKw < powerLimitKw * 0.99;

    if (computeChange < CONVERGENCE_THRESHOLD && massChange < CONVERGENCE_THRESHOLD) {
      break;
    }
  }

  // Check if design is valid
  if (thermalLimited && computeKw < 1) {
    invalidReason = 'Thermal limit too restrictive: cannot achieve minimum compute';
  }

  // Calculate total waste heat (compute + fusion, but from separate radiators)
  const actualGpuWasteKw = computeKw * wasteHeatFrac;
  const totalWasteKw = actualGpuWasteKw + (hasFusion ? fusionWasteKw : 0);

  // Total radiator mass includes both loops
  radMass = radMass + fusionRadMass;

  // Now calculate compute output from constrained compute power
  // TFLOPS = computeKw × gflopsW (since kW × GFLOPS/W = GFLOPS = TFLOPS for our units)
  const rawTflops = computeKw * gflopsW;

  // Apply radiation penalty as DIRECT efficiency loss
  // radPen = 0.30 means 30% of compute goes to ECC, TMR, redundancy, etc.
  // This is SEPARATE from SEU-driven availability (which is shell-dependent)
  // Higher radPen = more radiation hardening overhead = less usable compute
  const radDirectPenalty = 1 - params.radPen;  // e.g., 0.70 for radPen=0.30

  const tflops = rawTflops * radEffects.availabilityFactor * radDirectPenalty;
  const gpuEq = tflops / 1979; // H100 equivalents

  // Final data rate calculation
  const dataRateGbps = tflops * effectiveBwPerTflop;

  // Final mass breakdown (using values from iteration)
  const avionicsMass = avionicsMassBase;
  const propulsionMass = propulsionMassBase + (powerMass + battMass + compMass) * 0.03;
  const aocsMass = aocsMassBase;
  const otherSystemsMass = avionicsMass + propulsionMass + commsMass + aocsMass;
  const baseMass = powerMass + battMass + compMass + radMass + otherSystemsMass;

  // Radiation shielding mass
  // In Starship era, we add massive COTS shielding (water/polyethylene)
  // This is where cheap launch pays off - trading expensive rad-hardening for cheap mass
  let shieldMass = 0;
  let cotsShieldMass = 0;

  if (isStarshipEra) {
    // COTS approach: 3-5 tons of water/polyethylene shielding to protect cheap hardware
    // Scales with compute power (more compute = more shielding needed)
    const baseCotsShield = 3000; // 3 tons baseline
    const powerScale = Math.min(2, computeKw / 500); // Up to 2x for high power
    cotsShieldMass = baseCotsShield * (1 + powerScale * 0.67); // 3-5 tons
  }

  if (shell === 'leo') {
    // LEO: Minimal additional shielding (mostly thermal/micrometeoroid)
    shieldMass = baseMass * 0.02 + cotsShieldMass;
  } else {
    // MEO/Cislunar: Van Allen belts require heavy shielding even for rad-hard
    const structureArea = Math.pow(baseMass / 100, 0.66) * 6;
    shieldMass = structureArea * 50 + cotsShieldMass;
  }

  // Final dry mass
  const subsystems = baseMass + shieldMass;
  const structMass = subsystems * 0.1;
  const dryMass = subsystems + structMass;

  // Specific power
  const specPower = (powerKw * 1000) / dryMass;

  const solarArea =
    hasFission || hasFusion
      ? 0
      : (powerKw * 1000) / (solarEff * SOLAR_CONSTANT);

  // =====================================================
  // AUDIT: Constraint limits and margins
  // =====================================================
  const powerKwLimit = powerKw * params.computeFrac;
  const thermalKwLimit = radCapacityKw / wasteHeatFrac;
  const commsTflopsLimit = getCommsTflopsLimit(params, year);

  const limits: ConstraintLimits = {
    powerKwLimit,
    thermalKwLimit,
    commsTflopsLimit
  };

  // Determine binding constraint
  let binding: 'power' | 'thermal' | 'comms';
  if (thermalLimited) {
    binding = 'thermal';
  } else if (tflops >= commsTflopsLimit * 0.99) {
    binding = 'comms';
  } else {
    binding = 'power';
  }

  const margins: ConstraintMargins = {
    power: powerKwLimit > 0 ? computeKw / powerKwLimit : 0,
    thermal: thermalKwLimit > 0 ? computeKw / thermalKwLimit : 0,
    comms: commsTflopsLimit > 0 ? tflops / commsTflopsLimit : 0
  };

  // =====================================================
  // LCOC (Levelized Cost of Compute) - REALISTIC COSTING
  // =====================================================
  // Reference: 15 kW GEO comsat = $200-500M
  // A 240 kW LEO compute platform should be $500M-1B+ in 2026

  // POWER SYSTEM COSTS ($/W basis with learning curves)
  // Each technology has its own learning trajectory

  // SOLAR: Mature technology, slow learning (10%/yr), floor at $100/W
  // 2026: $500/W → 2040: ~$100/W
  const solarLearnRate = 0.10;
  const solarCostPerW = Math.max(100, 500 * Math.pow(1 - solarLearnRate, t));

  // FISSION: Industrial nuclear, moderate learning (12%/yr), floor at $15/W
  // First units $50/W, mature at $15/W (similar to ground SMRs at scale)
  const fissionMaturity = hasFission ? Math.min(1, (year - params.fissionYear) / 12) : 0;
  const fissionCostPerW = Math.max(15, 50 * (1 - fissionMaturity * 0.7));

  // FUSION: Revolutionary tech with RAPID learning (reaches floor in 5 years)
  // Compact magneto-electrostatic mirror is industrial equipment, not semiconductor
  // Key advantages over fission:
  // - No fuel rod fabrication/handling → simpler supply chain
  // - No spent fuel → no storage/disposal costs
  // - No criticality concerns → simpler safety systems
  // - Mass production of identical units → Wright's Law kicks in fast
  // First units $80/W, drops to $5/W floor (cheaper than fission at scale)
  const fusionMaturity = hasFusion ? Math.min(1, (year - params.fusionYear) / 5) : 0;
  const fusionCostPerW = Math.max(5, 80 * (1 - fusionMaturity * 0.94));

  const POWER_COST_PER_W = {
    solar: solarCostPerW,
    fission: fissionCostPerW,
    fusion: fusionCostPerW,
  };

  // OTHER COMPONENT COSTS ($/kg basis)
  // Gold-Plated Payload Fix: In Starship era, use COTS + shielding instead of rad-hard
  // Rad-hard: $50k/kg (radiation-hardened chips, space-qualified everything)
  // COTS+shielding: $8k/kg (commodity servers in shielded enclosures)
  // Component costs with SMOOTH COTS blend (no discontinuities)
  // Uses cotsBlend to interpolate between rad-hard ($500/kg) and COTS ($100/kg)
  const COMPONENT_COSTS_PER_KG = {
    battery: 500,     // $/kg - space-rated Li-ion (not commodity!)
    compute: 50000 - cotsBlend * 42000,     // 50k→8k smoothly
    radiator: 5000,   // $/kg - deployable radiator systems
    shield: 1000 - cotsBlend * 800,         // 1k→200 smoothly
    structure: 3000,  // $/kg - composite bus structure
    avionics: 100000 - cotsBlend * 80000,   // 100k→20k smoothly
    propulsion: 8000, // $/kg - electric propulsion + propellant
    aocs: 15000 - cotsBlend * 10000,        // 15k→5k smoothly
  };

  // OPTICAL COMMUNICATION TERMINALS
  // High-bandwidth laser links: $5-20M per terminal in 2026, improving with volume
  // Physical constraint: A platform can only have so many terminals (pointing angles, mass, power)
  // Modern optical terminals: 100+ Gbps each (TBIRD demonstrated 200 Gbps)
  // Maximum ~50 terminals per platform (physical/operational limit)
  const opticalTerminalCost = 8e6 * prodMult; // $8M baseline, scales with learning
  const opticalTerminalCapacityGbps = 100; // Advanced laser links
  const maxTerminals = 50; // Physical limit per platform
  const terminalsNeeded = Math.ceil(dataRateGbps / opticalTerminalCapacityGbps);
  const numOpticalTerminals = Math.max(2, Math.min(maxTerminals, terminalsNeeded));
  const opticalCommsCost = numOpticalTerminals * opticalTerminalCost;

  // =====================================================
  // ECONOMIES OF SCALE
  // =====================================================
  // Larger platforms have lower $/kW due to multiple effects:
  //
  // 1. POWER SYSTEM: cost ~ P^0.7 (typical for power generation)
  //    - Shared control systems, sensors, actuators
  //    - Fixed engineering costs amortized over more capacity
  //    - Balance-of-plant scales sub-linearly
  const powerScaleExponent = 0.7;
  const referencePowerKw = 1000; // 1 MW reference
  const powerScaleFactor = Math.pow(powerKw / referencePowerKw, powerScaleExponent - 1);

  // 2. AVIONICS: Mostly FIXED COST (same GNC system for 1 MW or 50 MW)
  //    - One flight computer, same sensors, same control algorithms
  //    - A 50 MW platform has same avionics as 1 MW → huge $/kW advantage
  const avionicsFixedCost = 15e6; // $15M for rad-hard flight systems

  // 3. RADIATORS: cost ~ Area^0.85 (larger panels simpler, mass production)
  //    - Small radiators: complex deployment, high $/m²
  //    - Large radiators: simple panels, lower $/m²
  const radAreaScaleFactor = Math.pow(radAreaM2 / 100, 0.85 - 1); // vs 100 m² reference

  // 4. INTEGRATION: cost ~ hardware^0.8 (fixed test facilities, teams)
  //    - Same clean room, same engineers, same test campaigns
  //    - Larger platform amortizes these fixed costs

  // Calculate hardware costs with scale economies
  let mfgCostPower: number;
  if (hasFusion) {
    mfgCostPower = (powerKw * 1000) * POWER_COST_PER_W.fusion * prodMult * powerScaleFactor;
  } else if (hasFission) {
    mfgCostPower = (powerKw * 1000) * POWER_COST_PER_W.fission * prodMult * powerScaleFactor;
  } else {
    mfgCostPower = (powerKw * 1000) * POWER_COST_PER_W.solar * prodMult * powerScaleFactor;
  }
  const mfgCostBatt = battMass * COMPONENT_COSTS_PER_KG.battery * prodMult;
  const mfgCostCompute = compMass * COMPONENT_COSTS_PER_KG.compute * prodMult;
  // Radiator cost with area scaling
  const mfgCostRadiator = radMass * COMPONENT_COSTS_PER_KG.radiator * prodMult * radAreaScaleFactor;
  const mfgCostShield = shieldMass * COMPONENT_COSTS_PER_KG.shield * prodMult;
  const mfgCostStruct = structMass * COMPONENT_COSTS_PER_KG.structure * prodMult;
  // Avionics: FIXED cost, not per-kg (economies of scale)
  const mfgCostAvionics = avionicsFixedCost * prodMult;
  const mfgCostPropulsion = propulsionMass * COMPONENT_COSTS_PER_KG.propulsion * prodMult;
  const mfgCostAocs = aocsMass * COMPONENT_COSTS_PER_KG.aocs * prodMult;

  const hardwareCost = mfgCostPower + mfgCostBatt + mfgCostCompute +
                       mfgCostRadiator + mfgCostShield + mfgCostStruct +
                       mfgCostAvionics + mfgCostPropulsion + mfgCostAocs + opticalCommsCost;

  // INTEGRATION & TEST: Sub-linear scaling with hardware cost
  // Industry standard is ~60% for small satellites
  // But larger platforms amortize fixed costs (test facilities, engineering)
  // Scale factor: cost ~ hardware^0.8
  const integrationScaleExponent = 0.8;
  const referenceHardwareCost = 100e6; // $100M reference
  const integrationScaleFactor = Math.pow(hardwareCost / referenceHardwareCost, integrationScaleExponent - 1);
  const integrationCost = hardwareCost * 0.60 * Math.min(1, integrationScaleFactor);

  // LAUNCH COST
  const launchCostTotal = dryMass * launchCost;

  // INSURANCE: 12% of (hardware + launch) for launch + first year on-orbit
  const insuranceCost = (hardwareCost + integrationCost + launchCostTotal) * 0.12;

  // GROUND SEGMENT: Mission ops center, ground stations, customer infrastructure
  // Base $20M + sub-linear scaling with data rate (shared infrastructure, economy of scale)
  // A 50 MW platform doesn't need 50x the ground segment of a 1 MW platform
  // Ground stations are shared across customer base; ops center is largely fixed
  const groundSegmentLearn = Math.max(0.4, Math.pow(0.90, t)); // 10% annual improvement, floor at 40%
  const groundSegmentBase = 20e6;
  const groundSegmentVariable = Math.sqrt(dataRateGbps) * 0.5e6; // Sub-linear with sqrt
  const groundSegmentCost = (groundSegmentBase + groundSegmentVariable) * groundSegmentLearn;

  // INTEREST DURING CONSTRUCTION (IDC)
  // Longer build times = more carrying cost on capital before revenue starts
  // IDC = CAPEX * WACC * (build_time / 2) - assuming linear spending over build period
  const buildMonths = params.satBuildDelay || 24; // default 24 months if not specified
  const buildYears = buildMonths / 12;
  const baseCapex = hardwareCost + integrationCost + launchCostTotal + insuranceCost + groundSegmentCost;
  const idc = baseCapex * params.waccOrbital * (buildYears / 2);

  // Total CAPEX = base costs + interest during construction
  const capex = baseCapex + idc;
  const crf = getCRF(params.waccOrbital, radEffects.effectiveLife);
  const annualCapex = capex * crf;
  const annualMaint = capex * params.maintCost;
  // Bandwidth cost: decreases over time with ground station tech, laser links, spectrum efficiency
  // ~15% annual improvement, floor at 10% of initial cost
  const bwCostLearn = Math.max(0.1, Math.pow(0.85, t));
  // Note: This calculates LEO satellite LCOC - LEO uses fission, NOT fusion
  // Fission provides bandwidth advantages (2x cheaper) from higher power budgets for comms
  const fissionBwDiscount = hasFission ? 0.5 : 1.0;
  const annualBwCost = dataRateGbps * params.bwCost * 1000 * bwCostLearn * fissionBwDiscount;
  const annual = annualCapex + annualMaint + annualBwCost;
  const gpuHrs = gpuEq * 8760 * SLA;
  // LCOC (Levelized Cost of Compute): production cost per GPU-hr assuming 100% sellability
  // This is the marginal production cost. For delivered cost accounting for unsold capacity
  // (demand/bandwidth/slot constraints), see fleet.lcocEffective which divides by sellableUtil
  const lcoc = gpuHrs > 0 ? annual / gpuHrs : Infinity;

  // Carbon intensity
  const carbonKg = dryMass * 95; // embodied carbon
  const carbonPerTflop =
    (carbonKg * 1000) /
    Math.max(1, tflops * 8760 * radEffects.effectiveLife * 0.88);

  // EROL: Energy Return on Launch
  const erol =
    (powerKw * 1000 * 8760 * 3600 * radEffects.effectiveLife * 0.88) /
    (dryMass * 400e6);

  return {
    year,
    powerKw,
    dryMass,
    tflops,
    gpuEq,
    capex,
    lcoc,
    erol,
    carbonPerTflop,
    gflopsW,
    radPower,
    specPower,
    solarArea,
    dataRateGbps,
    shell,
    mass: {
      power: powerMass,
      batt: battMass,
      comp: compMass,
      rad: radMass,
      shield: shieldMass,
      struct: structMass,
      other: otherSystemsMass  // avionics + propulsion + comms + aocs
    },
    hasThermal,
    hasFission,
    hasFusion,
    hasThermoCompute,
    hasPhotonicCompute,
    radMassPerMW,
    radEffects,
    // Thermal constraint tracking
    thermalLimited,
    radCapacityKw,
    computeKw,
    thermalMargin: radCapacityKw > 0 ? totalWasteKw / radCapacityKw : 1,
    // Audit: binding constraint + margins
    limits,
    binding,
    margins,
    invalidReason
  };
}
