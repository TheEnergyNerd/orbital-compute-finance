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

  // Thermal - first principles radiative balance
  emissivity: number;
  opTemp: number;
  radLearn: number;
  radTempK: number;           // Radiator operating temperature (K)
  radEmissivity: number;      // Radiator surface emissivity (0-1)
  radTwoSided: boolean;       // Whether radiator emits from both sides
  radMassFrac: number;        // Radiator mass as fraction of dry mass
  radKgPerM2: number;         // Radiator areal density (kg/m²)
  wasteHeatFrac: number;      // Fraction of compute power that becomes waste heat
  qSolarAbsWPerM2: number;    // Absorbed solar flux (W/m²)
  qAlbedoAbsWPerM2: number;   // Absorbed Earth albedo (W/m²)
  qEarthIrAbsWPerM2: number;  // Absorbed Earth IR (W/m²)
  eclipseFrac: number;        // Fraction of orbit in eclipse (0-1)

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
  starshipOn: boolean;  // Starship available ($15/kg floor) vs conventional ($300/kg floor)
  launchCost: number;
  launchLearn: number;
  launchFloor: number;  // Base floor, overridden by starshipOn
  prodMult: number;
  maintCost: number;
  waccOrbital: number;
  waccGround: number;

  // Bandwidth - goodput model
  bandwidth: number;
  bwGrowth: number;
  bwCost: number;  // Annual cost per Gbps ($k/Gbps/year)
  gbpsPerTflop: number;  // DEPRECATED - kept for backwards compatibility
  terminalGoodputGbps: number;  // Baseline per-platform terminal capacity
  contactFraction: number;       // Fraction of time in contact (0-1)
  protocolOverhead: number;      // Protocol/FEC overhead (0-1)
  bytesPerFlop: number;          // Bytes of IO per FLOP
  orbitalEligibleShare: number;
  cislunarLocalRatio: number;  // Fraction of cislunar compute that doesn't need downlink (85%)

  // Tokens - FLOPs-based model
  flopsPerToken: number;         // FLOPs required per token (model-dependent)
  bytesPerToken: number;         // Bytes of IO per token

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

  // Satellite manufacturing
  satBuildDelay: number;  // months to build a satellite (affects carrying costs)
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
  shield: number;
  struct: number;
  other: number;  // avionics + propulsion + comms + aocs
}

// Constraint limits for audit output
export interface ConstraintLimits {
  powerKwLimit: number;         // Max compute from power budget
  thermalKwLimit: number;       // Max compute from thermal capacity
  commsTflopsLimit: number;     // Max TFLOPs from bandwidth
}

// Constraint margins for audit output
export interface ConstraintMargins {
  power: number;                // computeKw / powerKwLimit
  thermal: number;              // computeKw / thermalKwLimit
  comms: number;                // tflops / commsTflopsLimit
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
  // Thermal constraint tracking
  thermalLimited: boolean;      // True if compute was clipped by thermal capacity
  radCapacityKw: number;        // Radiator heat rejection capacity
  computeKw: number;            // Actual compute power (may be less than desired)
  thermalMargin: number;        // Fraction of thermal capacity used (0-1)
  // Audit: binding constraint + margins
  limits: ConstraintLimits;
  binding: 'power' | 'thermal' | 'comms';
  margins: ConstraintMargins;
  invalidReason?: string;       // If design is physically impossible
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
  fleetCapacityExaflops: number;  // Instantaneous orbital compute capacity (not delivered)
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
