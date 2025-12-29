import type { Params } from '../model/types';

/**
 * Default parameters - every slider maps to one of these
 * If you don't believe these numbers, tweak them. That's the whole point.
 *
 * These are my best guesses after reading way too many papers.
 * Fight me (or just adjust the sliders).
 * - PM
 */
export const defaults: Params = {
  // Breakthroughs - these are the bets
  dropletOn: true,
  dropletYear: 2030, // droplet radiators solve the thermal problem
  fissionOn: true,
  fissionYear: 2035, // space nuclear unlocks cislunar
  fusionOn: false,
  fusionYear: 2045, // moonshot (literally)
  smrOn: true,
  smrYear: 2032, // ground nukes - separate from space policy

  // Thermal - the biggest engineering challenge
  emissivity: 0.85, // how good your radiator surface is
  opTemp: 365, // hotter = more radiation = less mass (modern chips handle this)

  // Power - you're drowning in it up there
  solarEff: 0.35, // panel efficiency (multi-junction hitting 35%+ in production)
  basePower: 300, // platform power before breakthroughs (kW)
  computeFrac: 0.68, // what % goes to GPUs
  battDens: 280, // Wh/kg - matters for eclipse survival

  // Compute
  satLife: 8, // years before TID kills you
  radPen: 0.30, // radiation efficiency penalty (better ECC, chiplet designs)
  aiLearn: 0.2, // the learning curve

  // Launch economics
  launchCost: 1500, // today's $/kg
  launchLearn: 0.33, // 33% cost reduction per doubling (SpaceX track record)
  launchFloor: 10, // can't go below propellant + minimal refurb
  prodMult: 2.5, // manufacturing scales with launch volume

  maintCost: 0.15, // 15% of capex annually

  // Bandwidth - the real bottleneck
  bandwidth: 50, // Tbps total capacity in 2025
  bwGrowth: 0.35, // 35%/yr growth
  gbpsPerTflop: 0.0001, // 0.1 Mbps/TFLOP

  // Market
  orbitalEligibleShare: 0.35, // 35% latency-tolerant

  // Cost of capital
  waccOrbital: 0.12, // 12% - space is risky
  waccGround: 0.08, // 8% - hyperscalers have cheap capital

  // Ground constraints
  groundPue: 1.3, // power overhead
  energyCost: 0.065, // $/kWh
  energyEscal: 0.03, // 3%/yr
  interconnect: 36, // 3 year queue

  // Demand
  demand2025: 65, // GW
  demandGrowth: 0.45, // 45%/yr
  supply2025: 480, // current ground capacity
  supplyGrowth: 0.15 // new ground coming online
};
