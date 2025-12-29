import type { Shell, Scenario } from './types';

/**
 * ORBITAL COMPUTE CONSTANTS
 *
 * The physics doesn't care about your business model.
 * These numbers are what they are.
 */

// Stefan-Boltzmann constant - the only equation that matters in space cooling
// εσT⁴ - that's it. No convection, no water rights, just physics.
export const STEFAN_BOLTZMANN = 5.67e-8;

// 1361 W/m² of free power, no interconnection queue, no permitting
export const SOLAR_CONSTANT = 1361;

// Simulation years: 2026-2050
export const YEARS = Array.from({ length: 25 }, (_, i) => 2026 + i);

// 99.9% uptime = 8.76 hours downtime/year
// This is the SLA we're targeting. Anything less and you can't compete.
export const SLA = 0.999;

/*
Shell definitions - here's where it gets interesting.
- tidMult: Total Ionizing Dose - your hardware slowly fries
- seuMult: Single Event Upsets - random bit flips, can only fix with redundancy
- capacity: how many platforms can physically fit without Kessler syndrome
*/
export const SHELLS: Record<string, Shell> = {
  leo:      { alt: 550,    latency: 3.7,   tidMult: 1.0,  seuMult: 1.0,  capacity: 300000 },  // the goldilocks zone
  meo:      { alt: 10000,  latency: 67,    tidMult: 3.0,  seuMult: 2.5,  capacity: 50000  },  // Van Allen hell
  geo:      { alt: 35786,  latency: 120,   tidMult: 0.6,  seuMult: 0.8,  capacity: 1800   },  // premium real estate
  cislunar: { alt: 384400, latency: 1300,  tidMult: 0.4,  seuMult: 1.2,  capacity: 700000 }   // the frontier
};

// Shell cost multipliers for launch
export const SHELL_COST_MULT: Record<string, number> = {
  leo: 1.0,
  meo: 1.3,
  geo: 1.6,
  cislunar: 2.5
};

// Scenarios for stress-testing the model
export const SCENARIOS: Record<string, Scenario> = {
  aggressive:   { learnMult: 1.4, techYearOffset: -3, demandMult: 1.3, launchLearnMult: 1.3 },  // SpaceX executes perfectly
  baseline:     { learnMult: 1.0, techYearOffset: 0,  demandMult: 1.0, launchLearnMult: 1.0 },  // our best guess
  conservative: { learnMult: 0.6, techYearOffset: 5,  demandMult: 0.7, launchLearnMult: 0.7 }   // everything slips
};
