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

// Legacy SLA constant (99.9% uptime) - kept for backward compatibility
export const SLA = 0.999;

/**
 * SLA DEFINITIONS BY INFRASTRUCTURE TYPE
 * 
 * Key insight from SemiAnalysis: Workload SLA requirements determine
 * which infrastructure options are viable. Training workloads with
 * checkpointing can tolerate 99% SLA, opening up cheaper alternatives.
 * 
 * Downtime per year:
 * - 99.99%: 52.6 minutes
 * - 99.9%:  8.76 hours
 * - 99%:    3.65 days
 * - 95%:    18.25 days
 */
export const SLA_BY_INFRASTRUCTURE = {
  // Hyperscaler ground (Tier III/IV DC, multi-AZ, redundant power)
  hyperscalerGround: 0.9999,
  // Neocloud ground (Tier II/III DC, single AZ)
  neocloudGround: 0.999,
  // BTM/stranded assets (interruptible power, Nordic wind, Gulf gas)
  strandedGround: 0.99,
  // LEO orbital (eclipse cycles, radiation events, link availability)
  leoOrbital: 0.99,
  // GEO orbital (stable position, but link-limited)
  geoOrbital: 0.995,
  // Cislunar (high latency, batch-only, local processing)
  cislunarOrbital: 0.98
} as const;

/**
 * SLA REQUIREMENTS BY WORKLOAD TYPE
 * 
 * Not all workloads need hyperscaler reliability.
 * Training with 10-min checkpoints loses ~10 min per failure.
 * At 99% SLA (3.65 days downtime/year), that's ~7 min/day restart overhead
 * = 99.5% effective utilization from checkpointing.
 */
export const SLA_BY_WORKLOAD = {
  // Real-time inference (ChatGPT, API endpoints)
  realTimeInference: 0.9999,
  // Enterprise inference (internal tools, batch-able)
  enterpriseInference: 0.999,
  // Model training (checkpointing handles failures)
  modelTraining: 0.99,
  // Batch processing (can resume from any point)
  batchProcessing: 0.95,
  // Research/experimentation (cheap > reliable)
  research: 0.90
} as const;

/**
 * WORKLOAD MIX - Fraction of global compute demand by type
 * This determines addressable market for each SLA tier
 */
export const WORKLOAD_MIX = {
  realTimeInference: 0.15,    // 15% - user-facing inference
  enterpriseInference: 0.20,  // 20% - business apps
  modelTraining: 0.40,        // 40% - the big opportunity for orbital
  batchProcessing: 0.15,      // 15% - data pipelines
  research: 0.10              // 10% - experimentation
} as const;

/**
 * CHECKPOINT PARAMETERS
 * Used to calculate effective utilization loss from failures
 */
export const CHECKPOINT_DEFAULTS = {
  intervalSeconds: 600,       // 10 minutes between checkpoints
  overheadFraction: 0.02,     // 2% throughput loss from checkpointing
  recoverySeconds: 120        // 2 minutes to restore from checkpoint
} as const;

/**
 * Orbital shell definitions.
 * - tidMult: Total Ionizing Dose multiplier relative to LEO
 * - seuMult: Single Event Upset multiplier relative to LEO
 * - capacity: Maximum platform count before orbital congestion issues
 */
export const SHELLS: Record<string, Shell> = {
  leo:      { alt: 550,    latency: 3.7,   tidMult: 1.0,  seuMult: 1.05, capacity: 2000000, massCapacityKg: 500e9  },  // LEO: 500 Tkg mass capacity with debris mgmt
  meo:      { alt: 10000,  latency: 67,    tidMult: 50.0, seuMult: 20.0, capacity: 0,       massCapacityKg: 0      },   // Van Allen belts - NOT viable
  geo:      { alt: 35786,  latency: 120,   tidMult: 0.6,  seuMult: 1.03, capacity: 1800,    massCapacityKg: 1e15   },   // GEO: slot-limited (ITU), mass not the constraint
  cislunar: { alt: 384400, latency: 1300,  tidMult: 0.4,  seuMult: 1.2,  capacity: 1e8,     massCapacityKg: 1e18   }    // Cislunar: effectively unlimited
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
