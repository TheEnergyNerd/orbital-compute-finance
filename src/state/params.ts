import type { Params } from '../model/types';

/**
 * Default parameters for the orbital compute model.
 * Each parameter maps to a UI slider or toggle.
 */
export const defaults: Params = {
  // Breakthroughs
  thermalOn: true,
  thermalYear: 2030,     // Thermal breakthrough enables MW-class heat rejection
  starshipYear: 2027,    // Year Starship becomes operational (if starshipOn)
  fissionOn: true,
  fissionYear: 2035,     // Space nuclear enables cislunar operations
  fusionOn: false,
  fusionYear: 2045,      // Fusion power for GW-class stations
  smrOn: true,
  smrYear: 2032,         // Ground SMR deployment
  thermoOn: false,
  thermoYear: 2030,      // Thermodynamic computing availability
  // Thermo ground: Extropic claims 10,000x, conservative 100x for probabilistic workloads
  // Uses thermal noise for Boltzmann sampling - Landauer limit is kT*ln(2) per bit
  thermoGroundMult: 100,
  // Thermo space: Free passive cooling to 3K vs 300K ground
  // - Landauer limit 100x lower (kT scales with temperature)
  // - Superconducting circuits: 80-100x more efficient at 4K (IEEE, imec research)
  // - No cooling overhead (radiate to cosmic background)
  // Conservative 4x space bonus (practical vs theoretical 100x)
  thermoSpaceMult: 400,
  photonicOn: false,
  photonicYear: 2034,    // Photonic computing availability (maturing from current demos)
  // Photonic ground: Lightmatter claims 10-100x lower energy per MAC, 1000x less heat
  // Conservative middle estimate for matrix multiplication workloads
  photonicGroundMult: 40,
  // Photonic space advantages (research-backed):
  // - Vacuum optics: no air absorption/scattering, perfect waveguides (~1.5x)
  // - Radiation immunity: photons unaffected by ionizing radiation (~1.3x)
  // - Thermal stability: no thermal expansion drift, stable alignment (~1.3x)
  // Combined: ~2.5x space bonus
  photonicSpaceMult: 100,
  workloadProbabilistic: 0.15, // Fraction of workloads that are sampling-heavy

  // Thermal - first principles radiative balance
  // NOTE: emissivity and opTemp are legacy aliases, model uses radEmissivity and radTempK
  emissivity: 0.85,      // Legacy alias for radEmissivity
  opTemp: 365,           // Legacy alias for radTempK (unused, kept for API compat)
  radLearn: 50,          // kg/MW/year improvement for conventional radiators
  radTempK: 350,         // Radiator operating temperature (K)
  radEmissivity: 0.85,   // Radiator surface emissivity (0-1)
  radTwoSided: true,     // Radiator emits from both sides
  radMassFrac: 0.15,     // Radiator mass as fraction of dry mass
  radKgPerM2: 3.0,       // Radiator areal density (kg/m²) - conventional
  wasteHeatFrac: 0.90,   // Fraction of compute power that becomes waste heat
  qSolarAbsWPerM2: 200,  // Absorbed solar flux (W/m²)
  qAlbedoAbsWPerM2: 50,  // Absorbed Earth albedo (W/m²)
  qEarthIrAbsWPerM2: 150, // Absorbed Earth IR (W/m²)
  eclipseFrac: 0.35,     // Fraction of orbit in eclipse (LEO default)

  // Power
  solarEff: 0.20,        // Silicon baseline (SpaceX/Starlink approach)
  solarLearn: 0.008,     // +0.8%/yr absolute improvement (reaches ~30% by 2038)
  computeFrac: 0.68,     // Fraction of power to compute (power determined by tech state)
  battDens: 280,         // Battery density (Wh/kg)

  // Compute
  satLife: 10,           // Satellite lifetime (years)
  radPen: 0.30,          // Radiation efficiency penalty
  aiLearn: 0.2,          // Annual compute efficiency improvement

  // Launch economics
  starshipOn: true,      // Starship available (true = $15/kg floor, false = $300/kg floor)
  launchCost: 1500,      // Current launch cost ($/kg)
  launchLearn: 0.18,     // Learning rate per doubling (18% - historical aerospace)
  launchFloor: 15,       // Physical floor with Starship (conventional is ~$300/kg)
  prodMult: 4.5,         // Manufacturing cost multiplier (higher = more expensive early satellites)

  maintCost: 0.015,      // Annual maintenance as fraction of capex (1.5%)

  // Bandwidth - goodput model
  bandwidth: 50,         // Total capacity in 2025 (Tbps)
  bwGrowth: 0.40,        // Annual bandwidth growth rate (aggressive with Starlink V3)
  bwCost: 50,            // Annual cost per Gbps ($k/Gbps/year) - ground station + spectrum
  gbpsPerTflop: 0.000001,  // Bandwidth per TFLOP (Gbps) - physics: ~1 kbps from token-based calc
  terminalGoodputGbps: 20,   // Baseline per-platform terminal capacity (Gbps)
  contactFraction: 0.25,     // Fraction of time in contact (0-1)
  protocolOverhead: 0.15,    // Protocol/FEC overhead (0-1)
  bytesPerFlop: 0.05,        // Bytes of IO per FLOP
  cislunarLocalRatio: 0.85,  // 85% of cislunar compute is local (no downlink needed)

  // Tokens - FLOPs-based model
  flopsPerToken: 140e9,      // FLOPs per token (Llama-70B class)
  bytesPerToken: 4,          // Bytes of output per token

  // Market
  orbitalEligibleShare: 0.35,  // Fraction of demand that is latency-tolerant

  // Cost of capital
  waccOrbital: 0.18,     // Orbital WACC (maturing industry, SpaceX routine access)
  waccGround: 0.13,      // Ground WACC (SemiAnalysis: 13% IRR for datacenter capital)

  // Ground constraints
  groundPue: 1.3,        // Power Usage Effectiveness
  energyCost: 0.065,     // Energy cost ($/kWh)
  energyEscal: 0.04,     // Annual energy cost escalation (4%/yr)
  interconnect: 48,      // Interconnection queue (months) - US grid queues now 4-5+ years

  // Demand
  demand2025: 65,        // 2025 demand (GW)
  demandGrowth: 0.55,    // Annual demand growth rate (AI compute ~4x/yr historically)
  supply2025: 60,        // 2025 ground supply (GW) - actual global AI-ready DC capacity
  supplyGrowth: 0.08,    // 8% annual growth (constrained by interconnect, chips, fabs)

  // Humanoid robot automation
  // Tesla Optimus, Figure, Boston Dynamics - datacenter operations automation
  // Reduces labor-dependent overhead (security, NOC, maintenance)
  // Does NOT reduce real estate costs (leases, property tax, insurance)
  robotsOn: false,       // Humanoid robots deployed in datacenters
  robotsYear: 2032,      // Year robot automation begins (conservative)
  robotsMaturityYears: 8, // Years to full maturity (gradual rollout)
  robotsMaxReduction: 0.70, // Max reduction in automatable overhead (70%)

  // Behind-the-meter generation
  // Behind-the-meter / stranded assets (Gulf gas, Nordic wind/hydro)
  // SemiAnalysis: These offer ~$1/GPU-hr but limited capacity and 99% SLA
  // Two types: (1) New BTM solar+storage, (2) Existing stranded power
  // Model blends toward stranded assets which have lower CAPEX premium
  btmShare: 0.15,        // 15% of new ground capacity is BTM in 2026
  btmShareGrowth: 0.02,  // Base growth rate per year
  btmDelay: 12,          // Months to deploy BTM (vs interconnect for grid)
  btmCapexMult: 1.15,    // 15% higher capex (stranded needs less infra than new BTM)
  btmEnergyCost: 0.025,  // $/kWh blended stranded (Gulf gas ~$0.02, Nordic ~$0.03)

  // Satellite manufacturing
  satBuildDelay: 24,      // Months to build a satellite (affects carrying costs via IDC)
  
  // SLA and reliability parameters
  // Ground: Hyperscaler standard is 99.9%, but training workloads can tolerate less
  // Orbital: Conservative 99% target - training is checkpoint-resilient
  groundSLA: 0.999,           // 99.9% uptime target for ground
  orbitalSLA: 0.99,           // 99% uptime target for orbital (training-focused)
  checkpointIntervalSec: 600, // 10 minutes between checkpoints (standard for large training)
  groundMTBFHours: 8760,      // ~1 failure per year for well-run ground DC
  orbitalMTBFHours: 2190,     // ~4 failures per year for orbital (radiation, thermal cycles)
  recoveryTimeSec: 300        // 5 minutes to recover from failure and resume training
};
