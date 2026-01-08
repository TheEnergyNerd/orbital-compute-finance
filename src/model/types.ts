// Core parameter types for the orbital compute model

export interface Params {
  // Breakthroughs
  thermalOn: boolean;
  thermalYear: number;
  fissionOn: boolean;
  fissionYear: number;
  fusionOn: boolean;
  fusionYear: number;
  smrOn: boolean;
  smrYear: number;
  thermoOn: boolean;
  thermoYear: number;
  thermoGroundMult: number;
  thermoSpaceMult: number;
  photonicOn: boolean;
  photonicYear: number;
  photonicGroundMult: number;
  photonicSpaceMult: number;
  workloadProbabilistic: number;

  // Thermal
  emissivity: number;
  opTemp: number;
  radLearn: number;

  // Power
  solarEff: number;
  solarLearn: number;
  basePower: number;
  computeFrac: number;
  battDens: number;

  // Compute
  satLife: number;
  radPen: number;
  aiLearn: number;

  // Economics
  launchCost: number;
  launchLearn: number;
  launchFloor: number;
  prodMult: number;
  maintCost: number;
  waccOrbital: number;
  waccGround: number;

  // Bandwidth
  bandwidth: number;
  bwGrowth: number;
  bwCost: number;  // Annual cost per Gbps ($k/Gbps/year)
  gbpsPerTflop: number;
  orbitalEligibleShare: number;
  cislunarLocalRatio: number;  // Fraction of cislunar compute that doesn't need downlink (85%)

  // Ground
  groundPue: number;
  energyCost: number;
  energyEscal: number;
  interconnect: number;

  // Market
  demand2025: number;
  demandGrowth: number;
  supply2025: number;
  supplyGrowth: number;

  // Behind-the-meter
  btmShare: number;
  btmShareGrowth: number;
  btmDelay: number;
  btmCapexMult: number;
  btmEnergyCost: number;
}

export interface Shell {
  alt: number;
  latency: number;
  tidMult: number;
  seuMult: number;
  capacity: number;
}

export interface RadiationEffects {
  tidFactor: number;
  effectiveLife: number;
  seuPenalty: number;
  availabilityFactor: number;
  replacementRate: number;
}

export interface MassBreakdown {
  power: number;
  batt: number;
  comp: number;
  rad: number;
  struct: number;
}

export interface SatelliteResult {
  year: number;
  powerKw: number;
  dryMass: number;
  tflops: number;
  gpuEq: number;
  capex: number;
  lcoc: number;
  erol: number;
  carbonPerTflop: number;
  gflopsW: number;
  radPower: number;
  specPower: number;
  solarArea: number;
  dataRateGbps: number;
  shell: string;
  mass: MassBreakdown;
  hasThermal: boolean;
  hasFission: boolean;
  hasFusion: boolean;
  hasThermoCompute: boolean;
  hasPhotonicCompute: boolean;
  radMassPerMW: number;
  radEffects: RadiationEffects;
}

export interface GroundResult {
  year: number;
  base: number;
  market: number;
  premium: number;
  carbonPerTflop: number;
  gflopsW: number;
  demand: number;
  groundSupply: number;
  totalSupply: number;
  unmetRatio: number;
}

export interface FleetResult {
  year: number;
  leoPlatforms: number;
  meoPlatforms: number;
  geoPlatforms: number;
  cisPlatforms: number;
  leoPowerTw: number;
  meoPowerTw: number;
  geoPowerTw: number;
  cisPowerTw: number;
  totalPowerTw: number;
  lcocEffective: number;
  bwUtil: number;
  bwAvailGbps: number;
  bwNeededGbps: number;
  bwSell: number;
  demandUtil: number;
  demandSell: number;
  eligibleDemandGW: number;
  dynamicEligibleShare: number;
  fleetTflops: number;
  sellableUtil: number;
  satPowerKw: number;
  cislunarPowerKw: number;
  leoUtil: number;
  meoUtil: number;
  geoUtil: number;
  cisUtil: number;
  bottleneck: string;
  replacementRate: number;
  deliveredTokensPerYear: number;  // Llama-70B equivalent tokens/year
  // Fleet mass & Starship metrics
  totalPlatforms: number;
  avgPlatformMassKg: number;
  fleetMassKg: number;
  starshipFlightsToDeploy: number;
  annualMassKg: number;
  annualStarshipFlights: number;
}

export interface ScenarioResult {
  sats: SatelliteResult[];
  fleets: FleetResult[];
  gnds: GroundResult[];
  crossoverYear: number | null;
  // Simulation state tracking
  states: SimulationState[];
  lunarUnlockYear: number | null;
  lunarReadinessDetails: LunarReadinessDetails[];
}

export interface Scenario {
  learnMult: number;
  techYearOffset: number;
  demandMult: number;
  launchLearnMult: number;
}

// Simulation state tracking for feedback loops
export interface SimulationState {
  year: number;
  // Cumulative metrics (for learning curves & lunar readiness)
  cumulativeMassToOrbitKg: number;
  cumulativeOrbitalFlights: number;
  cumulativeSatellitesBuilt: number;
  // Current metrics
  orbitalPowerTW: number;
  deliveredComputeExaflops: number;
  globalComputeExaflops: number;  // ground + orbital
  // Derived/computed
  rndStock: number;               // K, for AI acceleration
  lunarReadiness: number;         // 0-1 index
  effectiveLaunchLearnRate: number;
  // Costs
  launchCostPerKg: number;
}

// R&D acceleration boost results
export interface RnDBoost {
  chipEfficiencyMult: number;
  solarEfficiencyMult: number;
  manufacturingCostMult: number;
  launchLearnBoost: number;
}

// Lunar readiness component scores
export interface LunarReadinessDetails {
  massScore: number;
  computeScore: number;
  powerScore: number;
  timeScore: number;
  techBonus: number;
  efficiencyPenalty: number;
  overallReadiness: number;
  status: string;
}
