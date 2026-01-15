import { SLA, SLA_BY_INFRASTRUCTURE } from './constants';
import type { Params, GroundResult } from './types';
import { getGroundEfficiency } from './physics';
import { getDemand, getGroundSupply, getBtmShare } from './market';
import { getCRF } from './finance';
import { calculateEffectiveUptime, calculateCheckpointEfficiency } from './reliability';

export function calcGround(
  year: number,
  orbitalSupplyGW: number,
  params: Params
): GroundResult {
  const t = year - 2026;
  const gflopsW = getGroundEfficiency(year, params);

  // SMR synergy: DECOUPLED from space fission - independent ground policy
  // SMRs provide abundant, cheap, clean baseload power
  // Major impact: reduces energy costs significantly as fleet scales
  const hasSmr = params.smrOn && year >= params.smrYear;
  const smrMaturity = hasSmr ? Math.min(1, (year - params.smrYear) / 8) : 0;
  const smrDiscount = hasSmr
    ? 0.6 - 0.4 * smrMaturity  // 40% discount initially → 80% discount at maturity (8 years)
    : 1.0;

  // BTM share for this year
  const yearBtmShare = getBtmShare(year, params);

  // Ground SLA and reliability
  // Hyperscaler ground achieves 99.9%, stranded/BTM assets may have lower SLA
  // Blended SLA based on BTM share (BTM has lower reliability)
  const hyperscalerSLA = SLA_BY_INFRASTRUCTURE.hyperscalerGround;
  const strandedSLA = SLA_BY_INFRASTRUCTURE.strandedGround;
  const targetSLA = params.groundSLA ?? (hyperscalerSLA * (1 - yearBtmShare) + strandedSLA * yearBtmShare);
  
  // Calculate effective uptime with checkpoint recovery for training workloads
  const groundMTBF = params.groundMTBFHours ?? 8760;  // Default ~1 failure per year
  const effectiveUptime = calculateEffectiveUptime(
    targetSLA,
    groundMTBF,
    params.checkpointIntervalSec ?? 600,
    params.recoveryTimeSec ?? 300
  );

  // Hardware cost with WACC/CRF
  // GPU price declines ~16%/year (Moore's Law + competition)
  // BUT has a floor: wafer costs, packaging, testing, R&D amortization
  // Even commodity chips cost $50-100, high-perf compute has $500-2000 floor
  const GPU_PRICE_FLOOR = 1000;  // Minimum viable GPU-eq price
  const gpuPrice = Math.max(GPU_PRICE_FLOOR, 25000 * Math.pow(0.84, t));
  // Server overhead (chassis, power supplies) = 1.4x raw GPU cost
  const serverOverhead = gpuPrice * 1.4;
  // Networking (InfiniBand fabric, NDR switches, transceivers) = ~$3k/GPU in 2026
  // Declines with GPU price due to shared learning curves (NVLink/InfiniBand integration)
  // SemiAnalysis: InfiniBand is 15-20% of cluster CAPEX for 100k GPU systems
  const networkingPerGpu = 3000 * Math.pow(0.84, t);
  const hwCapex = (serverOverhead + networkingPerGpu) / (gflopsW / 2800);

  // Apply capex premium for BTM portion
  const btmCapexOverhead = yearBtmShare * (params.btmCapexMult - 1);
  const hwCapexAdjusted = hwCapex * (1 + btmCapexOverhead);

  const groundHwLife = 5;
  const crfGround = getCRF(params.waccGround, groundHwLife);
  const hwCost = hwCapexAdjusted * crfGround;

  // Blended energy costs (grid vs BTM)
  // Fusion: If fusion is available, it provides ultra-cheap baseload power
  // This benefits ground datacenters significantly (abundant clean power)
  // Even before full commercial fusion, R&D spillovers reduce energy tech costs
  const hasFusion = params.fusionOn && year >= params.fusionYear;
  const fusionMaturity = hasFusion ? Math.min(1, (year - params.fusionYear) / 8) : 0;
  const fusionDiscount = hasFusion ? (0.4 - 0.3 * fusionMaturity) : 1.0;  // 60% → 90% discount at maturity
  
  // Combined energy technology discount (SMRs + fusion both reduce energy costs)
  const energyTechDiscount = smrDiscount * fusionDiscount;
  
  const gridEnergy = params.energyCost * Math.pow(1 + params.energyEscal, t) * energyTechDiscount;
  const btmEnergy = params.btmEnergyCost * energyTechDiscount; // BTM also benefits from cheaper energy tech
  const blendedEnergy = gridEnergy * (1 - yearBtmShare) + btmEnergy * yearBtmShare;

  const pue = Math.max(1.08, params.groundPue - t * 0.01);
  
  // Energy scales with efficiency: more efficient chips need less power per GPU-equivalent
  // GPU_eq is defined as H100-equivalent throughput (1,979 TFLOPS)
  // As chips improve, fewer watts needed to deliver same throughput
  const baselinePowerW = 700;   // H100 TDP
  const baselineGflopsW = 2800; // H100 efficiency (GFLOPS/W)
  const equivPowerW = baselinePowerW * (baselineGflopsW / gflopsW);
  const enCost = (equivPowerW * 8760 * SLA * blendedEnergy * pue) / 1000;

  // Overhead: datacenter opex, staff, real estate, profit margin
  // Based on SemiAnalysis: hosting subtotal = $2,807/yr/GPU = ~$0.32/hr
  // Declines over time as AI compute becomes commoditized
  // 2026: $0.32/hr → 2050: $0.15/hr (commodity infrastructure)
  const overheadBase = 0.32 * Math.pow(0.96, t);  // 4% annual decline
  const overheadFloor = 0.15;  // Minimum overhead (physical limits)
  const overhead = Math.max(overheadFloor, overheadBase) * 8760 * SLA;

  // Utilization factor: datacenters don't run at 100% - typical 60-80%
  // SMR/fusion improve utilization by:
  // - No demand response curtailment
  // - Better cooling allows sustained high loads
  // - More locations = better load distribution
  let utilization = 0.70;
  if (hasSmr) {
    utilization += 0.10 * smrMaturity;  // +10% at maturity
  }
  if (hasFusion) {
    utilization += 0.12 * fusionMaturity;  // +12% at maturity
  }
  utilization = Math.min(0.95, utilization);  // Cap at 95%
  
  const base = (hwCost + enCost + overhead) / (8760 * SLA * utilization);

  // Market dynamics
  const demand = getDemand(year, params);
  const groundSupply = getGroundSupply(year, params);
  const totalSupply = groundSupply + orbitalSupplyGW;
  
  // Effective supply is boosted by better utilization
  // SMR/fusion allow existing capacity to serve more demand
  let effectiveSupplyMult = 1.0;
  if (hasSmr) {
    effectiveSupplyMult *= 1 + 0.20 * smrMaturity;  // 20% more effective at maturity
  }
  if (hasFusion) {
    effectiveSupplyMult *= 1 + 0.30 * fusionMaturity;  // 30% more effective at maturity
  }
  const effectiveSupply = totalSupply * effectiveSupplyMult;
  
  const unmetRatio = (demand - effectiveSupply) / effectiveSupply;

  // Revised scarcity premium with demand destruction and oversupply discount
  let premium: number;
  if (unmetRatio <= -0.3) {
    // Severe oversupply: price war (floor at 0.6x cost)
    premium = Math.max(0.6, 0.85 + unmetRatio);
  } else if (unmetRatio <= 0) {
    // Mild oversupply: slight discount
    premium = 1.0 + unmetRatio * 0.5;
  } else if (unmetRatio <= 0.3) {
    // Moderate scarcity: linear premium
    premium = 1 + unmetRatio * 4;
  } else if (unmetRatio <= 1.0) {
    // High scarcity: slower growth (demand destruction kicks in)
    premium = 2.2 + (unmetRatio - 0.3) * 2.5;
  } else {
    // Extreme scarcity: logarithmic growth (demand destruction slows price rise but doesn't stop it)
    // At 10x demand/supply: ~6x premium
    // At 100x demand/supply: ~10x premium
    // At 1000x demand/supply: ~14x premium
    premium = 4 + 2 * Math.log10(unmetRatio);
  }

  // Carbon intensity
  const gridCarbon = 380 * Math.pow(0.97, t);
  const carbonPerTflop = gridCarbon * (pue / gflopsW) + 5;

  return {
    year,
    base,
    market: base * premium,
    premium,
    carbonPerTflop,
    gflopsW,
    demand,
    groundSupply,
    totalSupply,
    unmetRatio,
    // SLA and reliability
    targetSLA,
    effectiveUptime
  };
}
