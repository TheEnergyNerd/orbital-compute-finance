import { SLA, SOLAR_CONSTANT, STEFAN_BOLTZMANN } from './constants';
import type { Params, SatelliteResult } from './types';
import {
  getLEOPower,
  getLaunchCost,
  getRadiatorMassPerMW,
  getRadiatorPower,
  getOrbitalEfficiency,
  getEffectiveBwPerTflop
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
  // THERMAL CONSTRAINT MODEL
  // =====================================================
  // Radiator capacity is a CONSTRAINT that limits compute power.
  // Instead of sizing radiators to match waste heat (infinite scaling),
  // we define a radiator budget and clip compute if it exceeds capacity.

  // Step 1: Define radiator mass budget based on platform class
  // Radiators are typically 10-25% of spacecraft dry mass
  // Larger platforms can afford more radiator mass
  let radMassBudget: number;
  let radTempK: number;
  let radKgPerM2: number;

  if (hasFusion) {
    // Fusion: SCO2 cycle requires low-temp rejection (293K)
    // Larger radiator budget due to combined GPU + SCO2 waste
    radMassBudget = powerMass * 0.40; // 40% of power system mass for radiators
    radTempK = 293; // 20°C for SCO2 compressor inlet
    const maturity = Math.min(1, (year - params.fusionYear) / 8);
    radKgPerM2 = 1.5 - maturity * 1.0; // 1.5 → 0.5 kg/m² over 8 years
  } else if (hasFission) {
    // Fission: can run at higher temps, more efficient radiators
    radMassBudget = powerMass * 0.25; // 25% of power system mass
    radTempK = params.opTemp; // Use operating temp parameter
    radKgPerM2 = hasThermal ? 0.8 : 2.5; // Droplet vs conventional
  } else {
    // Solar: limited mass budget, conventional radiators
    radMassBudget = (powerMass + battMass) * 0.20; // 20% of power+battery mass
    radTempK = params.opTemp;
    radKgPerM2 = hasThermal ? 1.0 : 3.0; // Droplet vs conventional
  }

  // Apply minimum radiator mass (can't go below structural minimum)
  radMassBudget = Math.max(50, radMassBudget);

  // Step 2: Calculate radiator heat rejection capacity (Stefan-Boltzmann)
  // P = εσT⁴ × Area, so Area = radMassBudget / radKgPerM2
  // Capacity = ε × σ × T⁴ × Area
  const radAreaM2 = radMassBudget / radKgPerM2;
  const radCapacityW = params.emissivity * STEFAN_BOLTZMANN * Math.pow(radTempK, 4) * radAreaM2;
  const radCapacityKw = radCapacityW / 1000;

  // Step 3: Calculate maximum compute power based on thermal capacity
  // GPU waste heat fraction (90% of compute power becomes heat)
  const GPU_WASTE_FRACTION = 0.90;

  // For fusion, must also account for SCO2 cycle waste heat
  let thermalBudgetForCompute: number;
  if (hasFusion) {
    // Fusion waste = electrical output (50% thermal efficiency)
    // Thermal budget for compute = total capacity - fusion waste
    thermalBudgetForCompute = Math.max(0, radCapacityKw - fusionWasteKw);
  } else {
    thermalBudgetForCompute = radCapacityKw;
  }

  // Thermo/photonic computing reduces waste heat per compute
  let wasteHeatMultiplier = GPU_WASTE_FRACTION;
  if (hasThermoCompute || hasPhotonicCompute) {
    const deterministicFrac = 1 - params.workloadProbabilistic;
    const probFrac = params.workloadProbabilistic;
    const photonicMult = hasPhotonicCompute ? params.photonicSpaceMult : 1;
    const thermoMult = hasThermoCompute ? params.thermoSpaceMult : 1;
    const avgMult = photonicMult * deterministicFrac + thermoMult * probFrac;
    wasteHeatMultiplier = GPU_WASTE_FRACTION / avgMult;
  }

  // Max compute before thermal limit: thermalBudget = computeKw × wasteHeatMultiplier
  const maxComputeKwThermal = thermalBudgetForCompute / wasteHeatMultiplier;

  // Step 4: Compute is limited by BOTH power availability AND thermal capacity
  const desiredComputeKw = powerKw * params.computeFrac;
  const computeKw = Math.min(desiredComputeKw, maxComputeKwThermal);
  const thermalLimited = computeKw < desiredComputeKw * 0.99; // Flag if thermally constrained

  // Step 5: Calculate actual waste heat and verify constraint
  const actualGpuWasteKw = computeKw * wasteHeatMultiplier;
  const totalWasteKw = actualGpuWasteKw + (hasFusion ? fusionWasteKw : 0);

  // Sanity check: waste heat must not exceed radiator capacity
  if (totalWasteKw > radCapacityKw * 1.01) {
    console.warn(`Thermal violation: ${totalWasteKw.toFixed(0)} kW waste > ${radCapacityKw.toFixed(0)} kW capacity`);
  }

  // Step 6: Calculate actual radiator mass used (may be less than budget if not needed)
  const actualRadAreaM2 = (totalWasteKw * 1000) / (params.emissivity * STEFAN_BOLTZMANN * Math.pow(radTempK, 4));
  const radMass = Math.min(radMassBudget, actualRadAreaM2 * radKgPerM2);

  // Now calculate compute output from constrained compute power
  // TFLOPS = computeKw × gflopsW (since kW × GFLOPS/W = GFLOPS, then /1000 for TFLOPS... but actually kW×1000×GFLOPS/W/1000 = kW×GFLOPS/W)
  const rawTflops = computeKw * gflopsW;
  const tflops = rawTflops * radEffects.availabilityFactor;
  const gpuEq = tflops / 1979; // H100 equivalents

  // Compute hardware mass scales with power input: ~5 kg per kW of compute power
  const compMass = Math.max(3, computeKw * 5);

  // Calculate data rate early (needed for comms mass estimation)
  const effectiveBwPerTflop = getEffectiveBwPerTflop(year, params);
  const dataRateGbps = tflops * effectiveBwPerTflop;

  // Fixed subsystems (from first principles):
  // - Avionics: flight computer, sensors, GNC - 50kg baseline, scales slightly with power
  // - Propulsion: thrusters, tanks, fuel - scales with platform mass
  // - Communications: antennas, transponders - scales with data rate
  // - AOCS: reaction wheels, magnetorquers - scales with platform size
  const avionicsMass = 50 + powerKw * 0.02; // 50kg base + 20g per kW
  const propulsionMass = 30 + (powerMass + battMass + compMass) * 0.03; // 30kg base + 3% of payload
  const commsMass = 20 + dataRateGbps * 0.5; // 20kg base + 0.5kg per Gbps
  const aocsMass = 15 + powerKw * 0.01; // 15kg base + 10g per kW
  const otherSystemsMass = avionicsMass + propulsionMass + commsMass + aocsMass;

  // Calculate temporary mass to estimate volume/surface area for shielding
  const baseMass = powerMass + battMass + compMass + radMass + otherSystemsMass;

  // Radiation shielding mass
  // Currently, radiation limits lifetime but adds zero mass cost. This fixes that.
  let shieldMass = 0;
  if (shell === 'leo') {
    // LEO: Minimal shielding (mostly thermal/micrometeoroid)
    shieldMass = baseMass * 0.02;
  } else {
    // MEO/Cislunar: Van Allen belts require heavy shielding for COTS silicon
    // Approximation: 50kg/m² (5g/cm²) shielding on the surface area
    // Estimate surface area assuming density of ~100kg/m³
    const structureArea = Math.pow(baseMass / 100, 0.66) * 6;
    const shieldThicknessKgM2 = 50;
    shieldMass = structureArea * shieldThicknessKgM2;
  }

  // Total mass (including shielding)
  const subsystems = baseMass + shieldMass;
  const structMass = subsystems * 0.1; // 10% structural margin
  const dryMass = subsystems + structMass;

  // Specific power
  const specPower = (powerKw * 1000) / dryMass;

  const solarArea =
    hasFission || hasFusion
      ? 0
      : (powerKw * 1000) / (solarEff * SOLAR_CONSTANT);

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
  const COMPONENT_COSTS_PER_KG = {
    battery: 500,     // $/kg - space-rated Li-ion (not commodity!)
    compute: 50000,   // $/kg - rad-hard compute (GPUs + boards + enclosures)
    radiator: 5000,   // $/kg - deployable radiator systems
    shield: 1000,     // $/kg - radiation shielding
    structure: 3000,  // $/kg - composite bus structure
    avionics: 100000, // $/kg - flight computers, sensors, GNC
    propulsion: 8000, // $/kg - electric propulsion + propellant
    aocs: 15000,      // $/kg - reaction wheels, star trackers
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
    thermalMargin: totalWasteKw / radCapacityKw
  };
}
