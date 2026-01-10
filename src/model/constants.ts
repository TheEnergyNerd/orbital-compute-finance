import type { Shell, Scenario } from './types';

/**
 * Physical and orbital constants for the compute model.
 */

// Stefan-Boltzmann constant (W/m²·K⁴)
export const STEFAN_BOLTZMANN = 5.67e-8;

// Solar irradiance at 1 AU (W/m²)
export const SOLAR_CONSTANT = 1361;

// Simulation years: 2026-2070 (extended to show lunar development timelines)
export const YEARS = Array.from({ length: 45 }, (_, i) => 2026 + i);

// Service Level Agreement target (99.9% uptime)
export const SLA = 0.999;

/**
 * Orbital shell definitions.
 * - tidMult: Total Ionizing Dose multiplier relative to LEO
 * - seuMult: Single Event Upset multiplier relative to LEO
 * - capacity: Maximum platform count before orbital congestion issues
 */
export const SHELLS: Record<string, Shell> = {
  leo:      { alt: 550,    latency: 3.7,   tidMult: 1.0,  seuMult: 1.0,  capacity: 2000000 },  // Low Earth Orbit - 200-2000km shell supports millions
  meo:      { alt: 10000,  latency: 67,    tidMult: 50.0, seuMult: 20.0, capacity: 0      },   // Van Allen belts - NOT viable for compute (GPS works but simple payloads)
  geo:      { alt: 35786,  latency: 120,   tidMult: 0.6,  seuMult: 0.8,  capacity: 1800   },   // Geostationary orbit (ITU slot-limited)
  cislunar: { alt: 384400, latency: 1300,  tidMult: 0.4,  seuMult: 1.2,  capacity: 1e8    }    // Earth-Moon space (~10^18 km³, effectively unlimited)
};

// Starship payload capacity (kg to LEO)
export const STARSHIP_PAYLOAD_KG = 150000;

// Launch cost multipliers by orbital shell
export const SHELL_COST_MULT: Record<string, number> = {
  leo: 1.0,
  meo: 1.3,
  geo: 1.6,
  cislunar: 2.5
};

// Scenario definitions for sensitivity analysis
// Wider bands to capture true uncertainty in multi-decade projections
export const SCENARIOS: Record<string, Scenario> = {
  aggressive:   { learnMult: 2.0, techYearOffset: -5, demandMult: 1.5, launchLearnMult: 1.5 },  // Optimistic: faster tech, higher demand, better economics
  baseline:     { learnMult: 1.0, techYearOffset: 0,  demandMult: 1.0, launchLearnMult: 1.0 },  // Reference case
  conservative: { learnMult: 0.4, techYearOffset: 8,  demandMult: 0.5, launchLearnMult: 0.5 }   // Pessimistic: slower tech, lower demand, worse economics
};
