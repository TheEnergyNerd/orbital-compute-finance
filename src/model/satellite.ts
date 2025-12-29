import { SLA, SOLAR_CONSTANT } from './constants';
import type { Params, SatelliteResult } from './types';
import {
  getLEOPower,
  getLaunchCost,
  getRadiatorMassPerMW,
  getRadiatorPower,
  getOrbitalEfficiency
} from './physics';
import { getShellRadiationEffects } from './orbital';
import { getCRF } from './finance';

/**
 * SATELLITE ECONOMICS
 * This is the LCOC calculation - the whole point of the model
 *
 * I stayed up way too late building this. Worth it.
 * - PM
 */
export function calcSatellite(
  year: number,
  params: Params,
  shell = 'leo'
): SatelliteResult {
  const t = year - 2026;
  const hasDroplet = params.dropletOn && year >= params.dropletYear;
  const hasFission = params.fissionOn && year >= params.fissionYear;
  const hasFusion = params.fusionOn && year >= params.fusionYear;

  // Platform specs - these all compound
  const powerKw = getLEOPower(year, params);
  const solarEff = Math.min(0.5, params.solarEff + t * 0.008);
  const radPower = getRadiatorPower(params);
  const gflopsW = getOrbitalEfficiency(year, params);
  const launchCost = getLaunchCost(year, params, shell);
  const prodMult = Math.max(0.25, params.prodMult * Math.pow(0.68, t));
  const radMassPerMW = getRadiatorMassPerMW(year, powerKw, params);

  // Radiation effects
  const radEffects = getShellRadiationEffects(shell, year, params);

  // Power source mass
  let powerMass = 0;
  let battMass = 0;

  if (hasFusion) {
    powerMass = powerKw * 0.004; // 250 W/kg
  } else if (hasFission) {
    powerMass = powerKw * 0.01; // 100 W/kg - Kilopower-class
  } else {
    // Solar: area * areal density
    const panelArea = (powerKw * 1000) / (solarEff * SOLAR_CONSTANT);
    powerMass = panelArea * 1.2;
    // Batteries for eclipse
    const battDens = Math.min(1000, params.battDens + t * 35);
    battMass = (powerKw * 0.05 * 1.5 * 1000) / battDens;
  }

  // Compute - apply SEU reliability overhead
  const computeKw = powerKw * params.computeFrac;
  const rawTflops = (computeKw * gflopsW) / 1000;
  const tflops = rawTflops * radEffects.availabilityFactor;
  const gpuEq = tflops / 1979; // H100 equivalents
  // Compute hardware mass scales with power input, not TFLOPS output
  // Better efficiency means lighter hardware per TFLOP, not heavier
  const compMass = Math.max(3, computeKw * 0.005); // ~5 kg per kW of compute power

  // Thermal - THE constraint pre-droplet
  // This is what everyone gets wrong. You can't just slap GPUs in space.
  // Heat rejection is the whole game until droplet radiators work.
  const wasteKw = computeKw * 0.65;
  const radMass = (wasteKw / 1000) * radMassPerMW;

  // Total mass
  const subsystems = powerMass + battMass + compMass + radMass + 25;
  const dryMass = subsystems * 1.1; // 10% structural margin

  // Specific power
  const specPower = (powerKw * 1000) / dryMass;

  const solarArea =
    hasFission || hasFusion
      ? 0
      : (powerKw * 1000) / (solarEff * SOLAR_CONSTANT);
  const dataRateGbps = tflops * params.gbpsPerTflop;

  /*
  LCOC calculation - here's the punchline

  Naive metrics: $/GPU-hour at a moment
  LCOC: $/delivered-GPU-hour over the asset's life, accounting for:
    - Time value of money (WACC)
    - Capital recovery (CRF amortization)
    - Maintenance and ops
    - Actual utilization (SLA)
  */
  const capex =
    dryMass * launchCost + dryMass * 350 * prodMult + 15000 * prodMult;
  const crf = getCRF(params.waccOrbital, radEffects.effectiveLife);
  const annualCapex = capex * crf;
  const annualMaint = capex * params.maintCost;
  const annual = annualCapex + annualMaint;
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
      struct: subsystems * 0.1
    },
    hasDroplet,
    hasFission,
    hasFusion,
    radMassPerMW,
    radEffects
  };
}
