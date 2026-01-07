import type { Params } from '../model/types';

/**
 * Default parameters for the orbital compute model.
 * Each parameter maps to a UI slider or toggle.
 */
export const defaults: Params = {
  // Breakthroughs
  thermalOn: true,
  thermalYear: 2030,     // Thermal breakthrough enables MW-class heat rejection
  fissionOn: true,
  fissionYear: 2035,     // Space nuclear enables cislunar operations
  fusionOn: false,
  fusionYear: 2045,      // Fusion power for GW-class stations
  smrOn: true,
  smrYear: 2032,         // Ground SMR deployment
  thermoOn: false,
  thermoYear: 2029,      // Thermodynamic computing availability
  thermoGroundMult: 100,    // Room-temp TSU efficiency multiplier (Extropic claims orders of magnitude)
  thermoSpaceMult: 1000,    // Superconducting TSU efficiency multiplier (10x from passive cryo: 3K vs 300K)
  photonicOn: false,
  photonicYear: 2035,    // Photonic computing availability
  photonicGroundMult: 30,   // Ground photonic efficiency multiplier (Lightmatter/Luminous 10-100x for matrix ops)
  photonicSpaceMult: 150,   // Space photonic efficiency multiplier (5x: radiation immunity + vacuum optics + thermal stability)
  workloadProbabilistic: 0.15, // Fraction of workloads that are sampling-heavy

  // Thermal
  emissivity: 0.85,      // Radiator surface emissivity
  opTemp: 365,           // Operating temperature (K)
  radLearn: 50,          // kg/MW/year improvement for conventional radiators

  // Power
  solarEff: 0.20,        // Silicon baseline (SpaceX/Starlink approach)
  solarLearn: 0.008,     // +0.8%/yr absolute improvement (reaches ~30% by 2038)
  basePower: 300,        // Platform power before breakthroughs (kW)
  computeFrac: 0.68,     // Fraction of power to compute
  battDens: 280,         // Battery density (Wh/kg)

  // Compute
  satLife: 10,           // Satellite lifetime (years)
  radPen: 0.30,          // Radiation efficiency penalty
  aiLearn: 0.2,          // Annual compute efficiency improvement

  // Launch economics
  launchCost: 1500,      // Current launch cost ($/kg)
  launchLearn: 0.18,     // Learning rate per doubling (18% - historical aerospace)
  launchFloor: 10,       // Minimum achievable launch cost ($/kg)
  prodMult: 2.5,         // Manufacturing cost multiplier

  maintCost: 0.015,      // Annual maintenance as fraction of capex (1.5%)

  // Bandwidth
  bandwidth: 50,         // Total capacity in 2025 (Tbps)
  bwGrowth: 0.35,        // Annual bandwidth growth rate
  gbpsPerTflop: 0.0001,  // Bandwidth per TFLOP (Gbps)
  cislunarLocalRatio: 0.85,  // 85% of cislunar compute is local (no downlink needed)

  // Market
  orbitalEligibleShare: 0.35,  // Fraction of demand that is latency-tolerant

  // Cost of capital
  waccOrbital: 0.10,     // Orbital WACC (maturing industry, SpaceX routine access)
  waccGround: 0.08,      // Ground WACC

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

  // Behind-the-meter generation
  btmShare: 0.15,        // 15% of new ground capacity is BTM in 2026
  btmShareGrowth: 0.02,  // Base growth rate per year
  btmDelay: 12,          // Months to deploy BTM (vs interconnect for grid)
  btmCapexMult: 1.35,    // 35% higher capex for on-site generation
  btmEnergyCost: 0.04    // $/kWh LCOS for solar+storage
};
