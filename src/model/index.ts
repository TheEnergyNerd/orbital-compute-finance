/**
 * Model index - exports all model functions for use by both main and finance pages
 */

// Constants
export {
  STEFAN_BOLTZMANN,
  SOLAR_CONSTANT,
  YEARS,
  SLA,
  SHELLS,
  STARSHIP_PAYLOAD_KG,
  SHELL_COST_MULT,
  SCENARIOS
} from './constants';

// Types
export type {
  Params,
  Shell,
  RadiationEffects,
  MassBreakdown,
  SatelliteResult,
  GroundResult,
  FleetResult,
  ScenarioResult,
  Scenario,
  SimulationState,
  RnDBoost,
  LunarReadinessDetails
} from './types';

// Physics functions
export {
  getLaunchCost,
  getRadiatorMassPerMW,
  getRadiatorPower,
  getGroundEfficiency,
  getOrbitalEfficiency,
  getBandwidth,
  getLEOPower,
  getCislunarPower
} from './physics';

// Financial functions
export { getCRF } from './finance';

// Market functions
export {
  getDemand,
  getBtmShare,
  getGroundSupply,
  getDemandPressure
} from './market';

// Orbital functions
export {
  getShellRadiationEffects,
  getAllShellReliability
} from './orbital';

// Core calculation functions
export { calcSatellite } from './satellite';
export { calcGround } from './ground';
export { calcFleet, resetFleetTracker } from './fleet';

// Scenario runner
export {
  getScenarioParams,
  runScenario,
  computeAll
} from './computeAll';

// Learning & AI acceleration
export {
  updateRnDStock,
  applyRnDBoost,
  updateLaunchLearning,
  initSimulationState
} from './learning';

// Lunar readiness
export {
  MASS_DRIVER_COST_PER_KG,
  getLunarReadiness,
  getLunarUnlockYear,
  getCislunarLaunchCost
} from './lunar';
