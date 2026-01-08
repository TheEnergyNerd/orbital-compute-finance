/**
 * Finance page entry point
 *
 * Imports shared model and exposes it for the finance page's inline JS.
 * The finance page keeps its own chart setup and UI logic for styling differences.
 */

import '../styles/finance.css';

// Import all model functions
import {
  // Constants
  STEFAN_BOLTZMANN,
  SOLAR_CONSTANT,
  YEARS,
  SLA,
  SHELLS,
  STARSHIP_PAYLOAD_KG,
  SHELL_COST_MULT,
  SCENARIOS,

  // Physics
  getLaunchCost,
  getRadiatorMassPerMW,
  getRadiatorPower,
  getGroundEfficiency,
  getOrbitalEfficiency,
  getBandwidth,
  getLEOPower,
  getCislunarPower,

  // Finance
  getCRF,

  // Market
  getDemand,
  getBtmShare,
  getGroundSupply,
  getDemandPressure,

  // Orbital
  getShellRadiationEffects,
  getAllShellReliability,

  // Core calculations
  calcSatellite,
  calcGround,
  calcFleet,
  resetFleetTracker,

  // Scenarios
  getScenarioParams,
  runScenario,

  // Learning
  updateRnDStock,
  updateLaunchLearning,
  initSimulationState,

  // Lunar
  getLunarReadiness,
  getLunarUnlockYear
} from '../model';

import { defaults } from '../state/params';

import type {
  Params,
  SatelliteResult,
  GroundResult,
  FleetResult,
  ScenarioResult,
  SimulationState,
  LunarReadinessDetails
} from '../model';

// Export to window for finance page inline JS
declare global {
  interface Window {
    OrbitalModel: typeof OrbitalModel;
  }
}

const OrbitalModel = {
  // Constants
  STEFAN_BOLTZMANN,
  SOLAR_CONSTANT,
  YEARS,
  SLA,
  SHELLS,
  STARSHIP_PAYLOAD_KG,
  SHELL_COST_MULT,
  SCENARIOS,

  // Default params
  defaults,

  // Physics
  getLaunchCost,
  getRadiatorMassPerMW,
  getRadiatorPower,
  getGroundEfficiency,
  getOrbitalEfficiency,
  getBandwidth,
  getLEOPower,
  getCislunarPower,

  // Finance
  getCRF,

  // Market
  getDemand,
  getBtmShare,
  getGroundSupply,
  getDemandPressure,

  // Orbital
  getShellRadiationEffects,
  getAllShellReliability,

  // Core calculations
  calcSatellite,
  calcGround,
  calcFleet,
  resetFleetTracker,

  // Scenarios
  getScenarioParams,
  runScenario,

  // Learning
  updateRnDStock,
  updateLaunchLearning,
  initSimulationState,

  // Lunar
  getLunarReadiness,
  getLunarUnlockYear
};

window.OrbitalModel = OrbitalModel;

// Log that model is loaded
console.log('OrbitalModel loaded - shared model functions available');
