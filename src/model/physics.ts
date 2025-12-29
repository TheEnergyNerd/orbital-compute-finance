import { STEFAN_BOLTZMANN, SHELL_COST_MULT } from './constants';
import type { Params } from './types';

/**
 * THE PHYSICS MODULE
 * Everything here is first-principles. No hand-waving.
 * If you don't like the numbers, tweak the sliders.
 */

// SpaceX basically owns this curve now
export function getLaunchCost(year: number, params: Params, shell = 'leo'): number {
  const baseCost = Math.max(
    params.launchFloor,
    params.launchCost * Math.pow(1 - params.launchLearn, year - 2026)
  );
  return baseCost * (SHELL_COST_MULT[shell] || 1.0);
}

export function getRadiatorMassPerMW(year: number, powerKw: number, params: Params): number {
  // Higher temp = more radiation = less area = less mass
  // Higher emissivity = more radiation = less mass
  const tempFactor = Math.pow(350 / params.opTemp, 4);
  const emissivityFactor = 0.85 / params.emissivity;

  if (!params.dropletOn || year < params.dropletYear) {
    // Conventional: base ~4500 kg/MW at reference conditions
    const baseMass = Math.max(1000, (4500 * tempFactor * emissivityFactor) - (year - 2026) * 30);
    const powerPenalty = 1 + (powerKw / 200) * 0.3;
    return baseMass * powerPenalty;
  }

  // Droplet: ~20 kg/MW base
  const maturity = Math.min(1, (year - params.dropletYear) / 8);
  const dropletBase = 20 - maturity * 12;
  return dropletBase * tempFactor * emissivityFactor;
}

// εσT⁴ - the most beautiful equation in thermal engineering
// Ludwig Boltzmann knew what was up
export function getRadiatorPower(params: Params): number {
  return params.emissivity * STEFAN_BOLTZMANN * Math.pow(params.opTemp, 4);
}

export function getGroundEfficiency(year: number, params: Params): number {
  let eff = 2800; // H100 baseline: 2800 GFLOPS/W
  for (let y = 2026; y < year; y++) {
    eff *= (1 + Math.max(0.03, params.aiLearn - (y - 2026) * 0.007));
  }
  return eff;
}

export function getOrbitalEfficiency(year: number, params: Params): number {
  const ground = getGroundEfficiency(year, params);
  const penalty = params.radPen * Math.pow(0.82, year - 2026);
  return ground * (1 - Math.max(0.02, penalty));
}

export function getBandwidth(year: number, params: Params): number {
  return params.bandwidth * Math.pow(1 + params.bwGrowth, year - 2026);
}

// This function tells the story of orbital compute
// Conventional panels = cute. Droplet = serious. Fission = game over for ground.
export function getLEOPower(year: number, params: Params): number {
  const t = year - 2026;
  const hasDroplet = params.dropletOn && year >= params.dropletYear;
  const hasFission = params.fissionOn && year >= params.fissionYear;
  const hasFusion = params.fusionOn && year >= params.fusionYear;

  if (hasFusion) {
    // Fusion: 100-500 MW LEO stations - still sci-fi but fun to model
    return 100000 + Math.min(1, (year - params.fusionYear) / 10) * 400000;
  }
  if (hasFission) {
    // Fission: 5-20 MW - NASA actually has Kilopower working
    return 5000 + Math.min(1, (year - params.fissionYear) / 10) * 15000;
  }
  if (hasDroplet) {
    // Droplet enables MW-class: this is the real unlock
    const maturity = Math.min(1, (year - params.dropletYear) / 6);
    return 1500 + maturity * 3500;
  }
  // Conventional: capped hard by thermal. ISS is only 84kW for a reason.
  return Math.min(250, params.basePower * 0.8 + t * 5);
}

export function getCislunarPower(year: number, params: Params): number {
  const hasFission = params.fissionOn && year >= params.fissionYear;
  const hasFusion = params.fusionOn && year >= params.fusionYear;
  const hasDroplet = params.dropletOn && year >= params.dropletYear;

  if (hasFusion) {
    // Fusion: 500 MW - 2 GW stations
    return 500000 + Math.min(1, (year - params.fusionYear) / 10) * 1500000;
  }
  if (hasFission) {
    // Fission enables cislunar: 50-150 MW
    return 50000 + Math.min(1, (year - params.fissionYear) / 10) * 100000;
  }
  if (hasDroplet && (year - params.dropletYear) >= 5) {
    // Mature droplet can do cislunar at lower power
    return Math.min(30000, 5000 + (year - params.dropletYear - 5) * 5000);
  }
  return 0;
}
