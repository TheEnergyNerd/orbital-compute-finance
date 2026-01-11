import { SLA, SOLAR_CONSTANT, STEFAN_BOLTZMANN } from './constants';
import type { Params, SatelliteResult, ConstraintLimits, ConstraintMargins } from './types';
import {
  getLEOPower,
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

  // Platform specifications
  const powerKw = getLEOPower(year, params);
  const solarEff = Math.min(0.5, params.solarEff + t * params.solarLearn);
  const radPower = getRadiatorPower(params);
  const gflopsW = getOrbitalEfficiency(year, params);
  const launchCost = getLaunchCost(year, params, shell);

  // =====================================================
  // GOLD-PLATED PAYLOAD FIX
  // =====================================================
  // When launch is cheap (Starship era), we use COTS hardware with shielding
  // instead of expensive rad-hard hardware. This is economically coherent:
  // cheap mass → use cheap heavy hardware, not expensive lightweight hardware.
  const isStarshipEra = launchCost < 200;

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

  // Fusion radiators: operate at 293K (SCO2 cycle requirement)
  // Lower temp = less Stefan-Boltzmann power = need more area
  let qNetAvgFusion = qNetAvgCompute;
  if (hasFusion) {
    const fusionRadTemp = 293; // K, SCO2 cycle inlet temp
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
  const radMassFrac = params.radMassFrac || 0.15;  // 15% of dry mass default

  // Waste heat fraction
  const baseWasteHeatFrac = params.wasteHeatFrac || 0.90;

  // Thermo/photonic computing reduces waste heat per compute
  let wasteHeatFrac = baseWasteHeatFrac;
  if (hasThermoCompute || hasPhotonicCompute) {
    const deterministicFrac = 1 - params.workloadProbabilistic;
    const probFrac = params.workloadProbabilistic;
    const photonicMult = hasPhotonicCompute ? params.photonicSpaceMult : 1;
    const thermoMult = hasThermoCompute ? params.thermoSpaceMult : 1;
    const avgMult = photonicMult * deterministicFrac + thermoMult * probFrac;
    wasteHeatFrac = baseWasteHeatFrac / avgMult;
  }

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
  const tflops = rawTflops * radEffects.availabilityFactor;
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

  // FUSION: New tech, FAST learning (20%/yr from first deployment), floor at $10/W
  // Compact magneto-electrostatic mirror is industrial equipment, not semiconductor
  // First units $100/W, drops rapidly to $10-20/W as manufacturing scales
  const fusionMaturity = hasFusion ? Math.min(1, (year - params.fusionYear) / 8) : 0;
  const fusionCostPerW = Math.max(10, 100 * (1 - fusionMaturity * 0.9));

  const POWER_COST_PER_W = {
    solar: solarCostPerW,
    fission: fissionCostPerW,
    fusion: fusionCostPerW,
  };

  // OTHER COMPONENT COSTS ($/kg basis)
  // Gold-Plated Payload Fix: In Starship era, use COTS + shielding instead of rad-hard
  // Rad-hard: $50k/kg (radiation-hardened chips, space-qualified everything)
  // COTS+shielding: $8k/kg (commodity servers in shielded enclosures)
  const COMPONENT_COSTS_PER_KG = {
    battery: 500,     // $/kg - space-rated Li-ion (not commodity!)
    compute: isStarshipEra ? 8000 : 50000,  // COTS+shielding vs rad-hard
    radiator: 5000,   // $/kg - deployable radiator systems
    shield: isStarshipEra ? 200 : 1000,     // Water/poly is cheap vs aerospace shielding
    structure: 3000,  // $/kg - composite bus structure
    avionics: isStarshipEra ? 20000 : 100000, // COTS avionics vs rad-hard
    propulsion: 8000, // $/kg - electric propulsion + propellant
    aocs: isStarshipEra ? 5000 : 15000,     // COTS sensors vs space-qualified
  };

  // OPTICAL COMMUNICATION TERMINALS
  // High-bandwidth laser links are expensive: $5-20M per terminal in 2026
  // Cost decreases with volume production
  const opticalTerminalCost = 8e6 * prodMult; // $8M baseline, scales with learning
  const numOpticalTerminals = Math.max(2, Math.ceil(dataRateGbps / 10)); // ~10 Gbps per terminal
  const opticalCommsCost = numOpticalTerminals * opticalTerminalCost;

  // Calculate hardware costs
  let mfgCostPower: number;
  if (hasFusion) {
    mfgCostPower = (powerKw * 1000) * POWER_COST_PER_W.fusion * prodMult;
  } else if (hasFission) {
    mfgCostPower = (powerKw * 1000) * POWER_COST_PER_W.fission * prodMult;
  } else {
    mfgCostPower = (powerKw * 1000) * POWER_COST_PER_W.solar * prodMult;
  }
  const mfgCostBatt = battMass * COMPONENT_COSTS_PER_KG.battery * prodMult;
  const mfgCostCompute = compMass * COMPONENT_COSTS_PER_KG.compute * prodMult;
  const mfgCostRadiator = radMass * COMPONENT_COSTS_PER_KG.radiator * prodMult;
  const mfgCostShield = shieldMass * COMPONENT_COSTS_PER_KG.shield * prodMult;
  const mfgCostStruct = structMass * COMPONENT_COSTS_PER_KG.structure * prodMult;
  const mfgCostAvionics = avionicsMass * COMPONENT_COSTS_PER_KG.avionics * prodMult;
  const mfgCostPropulsion = propulsionMass * COMPONENT_COSTS_PER_KG.propulsion * prodMult;
  const mfgCostAocs = aocsMass * COMPONENT_COSTS_PER_KG.aocs * prodMult;

  const hardwareCost = mfgCostPower + mfgCostBatt + mfgCostCompute +
                       mfgCostRadiator + mfgCostShield + mfgCostStruct +
                       mfgCostAvionics + mfgCostPropulsion + mfgCostAocs + opticalCommsCost;

  // INTEGRATION & TEST: 60% of hardware cost (industry standard)
  const integrationCost = hardwareCost * 0.60;

  // LAUNCH COST
  const launchCostTotal = dryMass * launchCost;

  // INSURANCE: 12% of (hardware + launch) for launch + first year on-orbit
  const insuranceCost = (hardwareCost + integrationCost + launchCostTotal) * 0.12;

  // GROUND SEGMENT: Mission ops center, ground stations, customer infrastructure
  // Base $15M + scales with data rate (more ground stations needed)
  // Note: Ground segment doesn't scale with satellite prodMult, but does improve over time
  const groundSegmentLearn = Math.max(0.4, Math.pow(0.90, t)); // 10% annual improvement, floor at 40%
  const groundSegmentCost = (15e6 + dataRateGbps * 0.5e6) * groundSegmentLearn;

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
