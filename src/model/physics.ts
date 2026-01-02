import { STEFAN_BOLTZMANN, SHELL_COST_MULT } from './constants';
import type { Params } from './types';
import { getDemandPressure } from './market';

/**
 * Physics calculations for orbital compute model.
 * All calculations are derived from first principles.
 */

/**
 * Calculate launch cost per kg for a given year and orbital shell.
 * Applies demand-coupled Wright's Law learning curve with floor constraint.
 * High demand accelerates cost reductions through increased production volume.
 */
export function getLaunchCost(year: number, params: Params, shell = 'leo'): number {
  let cost = params.launchCost;
  for (let y = 2026; y < year; y++) {
    const demandPressure = getDemandPressure(y, params);
    const orbitalLearningMult = Math.pow(demandPressure, 1.5); // 0.09x to 2.83x
    const effectiveLearn = params.launchLearn * orbitalLearningMult;
    cost *= (1 - effectiveLearn);
    cost = Math.max(params.launchFloor, cost);
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

  // Advanced thermal: ~20 kg/MW base
  const maturity = Math.min(1, (year - params.thermalYear) / 8);
  const advancedBase = 20 - maturity * 12;
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
  return params.bandwidth * Math.pow(1 + params.bwGrowth, year - 2026);
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

  if (hasFusion) {
    // Fusion: 100-500 MW LEO stations
    return 100000 + Math.min(1, (year - params.fusionYear) / 10) * 400000;
  }
  if (hasFission) {
    // Fission: 5-20 MW platforms
    return 5000 + Math.min(1, (year - params.fissionYear) / 10) * 15000;
  }
  if (hasThermal) {
    // Thermal breakthrough enables MW-class heat rejection
    const maturity = Math.min(1, (year - params.thermalYear) / 6);
    return 1500 + maturity * 3500;
  }
  // Conventional solar: limited by thermal rejection capacity
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
    // Mature thermal tech enables limited cislunar operations
    return Math.min(30000, 5000 + (year - params.thermalYear - 5) * 5000);
  }
  return 0;
}
