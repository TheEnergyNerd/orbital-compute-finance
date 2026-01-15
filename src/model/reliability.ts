import type { Params } from './types';

/**
 * SLA and reliability calculations for orbital vs ground infrastructure.
 * 
 * Key insight: Training workloads are checkpoint-resilient. A 99% SLA with
 * 10-minute checkpoints loses ~7 minutes per day to restarts = 99.5% effective
 * utilization, barely worse than 99.9% SLA.
 * 
 * This enables:
 * 1. Lower-reliability infrastructure (cheaper)
 * 2. Interruptible power contracts
 * 3. Alternative geographies (Nordic wind, Gulf stranded gas)
 * 4. Orbital compute (different failure modes)
 */

/**
 * Get the target SLA for a given shell.
 * LEO/MEO/GEO use orbital SLA, cislunar may have different profile.
 */
export function getShellSLA(shell: string, params: Params): number {
  // All orbital shells use orbital SLA target
  // In future, could differentiate (e.g., GEO might be more reliable than LEO)
  return params.orbitalSLA;
}

/**
 * Calculate effective uptime accounting for checkpoint recovery.
 * 
 * For training workloads:
 * - Failures cause loss of work since last checkpoint
 * - Recovery time is small compared to checkpoint interval
 * - Effective uptime = raw uptime + recovered time
 * 
 * @param rawSLA - The infrastructure's raw uptime (e.g., 0.99 = 99%)
 * @param mtbfHours - Mean time between failures in hours
 * @param checkpointSec - Checkpoint interval in seconds
 * @param recoverySec - Time to recover from failure in seconds
 * @returns Effective uptime fraction (0-1)
 */
export function calculateEffectiveUptime(
  rawSLA: number,
  mtbfHours: number,
  checkpointSec: number,
  recoverySec: number
): number {
  // Hours per year
  const hoursPerYear = 8760;
  
  // Downtime from raw SLA
  const rawDowntimeHours = hoursPerYear * (1 - rawSLA);
  
  // Number of failures per year
  const failuresPerYear = hoursPerYear / mtbfHours;
  
  // Average work lost per failure = half the checkpoint interval
  // (on average, failure occurs halfway through checkpoint window)
  const avgWorkLostPerFailureSec = checkpointSec / 2;
  
  // Total work lost to checkpoint recovery per year
  const workLostToRecoveryHours = (failuresPerYear * (avgWorkLostPerFailureSec + recoverySec)) / 3600;
  
  // Effective downtime = raw downtime + recovery overhead
  const effectiveDowntimeHours = rawDowntimeHours + workLostToRecoveryHours;
  
  // Effective uptime
  const effectiveUptime = Math.max(0, 1 - (effectiveDowntimeHours / hoursPerYear));
  
  return effectiveUptime;
}

/**
 * Calculate checkpoint overhead (time spent checkpointing vs computing).
 * 
 * Frequent checkpointing costs compute time but reduces work lost on failure.
 * Optimal interval balances these tradeoffs.
 * 
 * @param checkpointSec - Checkpoint interval in seconds
 * @param checkpointDurationSec - Time to write checkpoint (typically 30-120s for large models)
 * @returns Fraction of time available for compute (0-1)
 */
export function calculateCheckpointEfficiency(
  checkpointSec: number,
  checkpointDurationSec: number = 60  // Default 60s to checkpoint
): number {
  // Time spent computing between checkpoints
  const computeTime = checkpointSec - checkpointDurationSec;
  
  // Efficiency = compute time / total time
  return Math.max(0.5, computeTime / checkpointSec);
}

/**
 * Calculate the SLA-adjusted LCOC.
 * 
 * Higher SLA = more expensive infrastructure (redundancy, premium power)
 * Lower SLA = cheaper but with checkpoint overhead
 * 
 * For training workloads, the optimal is often lower SLA with good checkpointing.
 * 
 * @param baseLCOC - Base levelized cost of compute ($/GPU-hr)
 * @param targetSLA - Target SLA (0-1)
 * @param mtbfHours - Mean time between failures
 * @param checkpointSec - Checkpoint interval
 * @param recoverySec - Recovery time
 * @returns SLA-adjusted LCOC ($/GPU-hr)
 */
export function getSLAAdjustedLCOC(
  baseLCOC: number,
  targetSLA: number,
  mtbfHours: number,
  checkpointSec: number,
  recoverySec: number
): number {
  // Calculate effective uptime with checkpoint recovery
  const effectiveUptime = calculateEffectiveUptime(
    targetSLA,
    mtbfHours,
    checkpointSec,
    recoverySec
  );
  
  // Calculate checkpoint overhead
  const checkpointEff = calculateCheckpointEfficiency(checkpointSec);
  
  // Combined efficiency = uptime × checkpoint efficiency
  const combinedEfficiency = effectiveUptime * checkpointEff;
  
  // Adjusted LCOC = base LCOC / combined efficiency
  // Lower efficiency = higher effective cost per useful compute hour
  return baseLCOC / combinedEfficiency;
}

/**
 * Calculate SLA premium - the cost multiplier for higher reliability.
 * 
 * Based on industry data:
 * - 99% → 99.9%: ~1.3x cost (N+1 redundancy, better power)
 * - 99.9% → 99.99%: ~1.5x cost (geographic redundancy, hot failover)
 * - 99.99% → 99.999%: ~2x cost (multiple datacenters, real-time sync)
 * 
 * @param targetSLA - Target SLA (0-1)
 * @returns Cost multiplier for achieving this SLA
 */
export function getSLACostMultiplier(targetSLA: number): number {
  // Convert to "nines" for easier calculation
  // 99% = 2 nines, 99.9% = 3 nines, etc.
  const nines = -Math.log10(1 - targetSLA);
  
  // Cost scales roughly 1.3x per nine above 2 nines
  // 2 nines (99%): 1.0x baseline
  // 3 nines (99.9%): 1.3x
  // 4 nines (99.99%): 1.7x
  // 5 nines (99.999%): 2.2x
  if (nines <= 2) return 1.0;
  return Math.pow(1.3, nines - 2);
}

/**
 * Determine which workloads can be served at a given SLA level.
 * 
 * @param infrastructureSLA - The SLA the infrastructure provides
 * @returns Object with workload types and whether they can be served
 */
export function getServableWorkloads(infrastructureSLA: number): {
  realTimeInference: boolean;
  enterpriseInference: boolean;
  modelTraining: boolean;
  batchProcessing: boolean;
  research: boolean;
} {
  return {
    realTimeInference: infrastructureSLA >= 0.9999,    // Needs 99.99%
    enterpriseInference: infrastructureSLA >= 0.999,   // Needs 99.9%
    modelTraining: infrastructureSLA >= 0.99,          // Only needs 99%
    batchProcessing: infrastructureSLA >= 0.95,        // Only needs 95%
    research: infrastructureSLA >= 0.90                // Only needs 90%
  };
}

/**
 * Calculate the addressable market fraction for a given SLA level.
 * 
 * Based on workload mix estimates:
 * - Real-time inference: 15% of compute demand
 * - Enterprise inference: 25% of compute demand
 * - Model training: 40% of compute demand
 * - Batch processing: 15% of compute demand
 * - Research: 5% of compute demand
 * 
 * @param infrastructureSLA - The SLA the infrastructure provides
 * @returns Fraction of total compute market addressable (0-1)
 */
export function getAddressableMarketFraction(infrastructureSLA: number): number {
  const workloadMix = {
    realTimeInference: 0.15,
    enterpriseInference: 0.25,
    modelTraining: 0.40,
    batchProcessing: 0.15,
    research: 0.05
  };
  
  const servable = getServableWorkloads(infrastructureSLA);
  
  let addressable = 0;
  if (servable.realTimeInference) addressable += workloadMix.realTimeInference;
  if (servable.enterpriseInference) addressable += workloadMix.enterpriseInference;
  if (servable.modelTraining) addressable += workloadMix.modelTraining;
  if (servable.batchProcessing) addressable += workloadMix.batchProcessing;
  if (servable.research) addressable += workloadMix.research;
  
  return addressable;
}

/**
 * Calculate orbital-specific reliability factors.
 * 
 * Orbital has different failure modes than ground:
 * - Radiation-induced SEUs (Single Event Upsets)
 * - Thermal cycling stress
 * - Communications outages
 * - Eclipse transitions
 * 
 * These improve over time with:
 * - Better rad-hardening
 * - More ground stations
 * - Laser inter-satellite links
 * - Improved thermal management
 * 
 * @param year - Simulation year
 * @param shell - Orbital shell
 * @param params - Model parameters
 * @returns Adjusted MTBF in hours
 */
export function getOrbitalMTBF(
  year: number,
  shell: string,
  params: Params
): number {
  const t = year - 2026;
  
  // Base MTBF from params
  let mtbf = params.orbitalMTBFHours;
  
  // Improvement over time (learning curve for reliability)
  // ~10% improvement per year as operations mature
  const reliabilityImprovement = Math.pow(1.10, t);
  mtbf *= reliabilityImprovement;
  
  // Shell-specific adjustments
  // GEO: More stable environment, less thermal cycling
  // LEO: More radiation but better ground contact
  // Cislunar: Highest radiation, longest communications delays
  const shellMultipliers: Record<string, number> = {
    leo: 1.0,      // Baseline
    meo: 0.5,      // Van Allen belts - harsh
    geo: 1.2,      // More stable
    cislunar: 0.8  // Communications challenges
  };
  
  mtbf *= shellMultipliers[shell] || 1.0;
  
  // Thermal breakthrough improves reliability
  if (params.thermalOn && year >= params.thermalYear) {
    mtbf *= 1.3;  // 30% improvement from better thermal management
  }
  
  // Cap at reasonable maximum (can't be more reliable than ground)
  return Math.min(mtbf, params.groundMTBFHours * 1.5);
}
