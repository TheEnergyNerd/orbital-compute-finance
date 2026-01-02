import { describe, it, expect } from 'vitest';
import { getLaunchCost, getRadiatorMassPerMW, getGroundEfficiency, getOrbitalEfficiency } from '../src/model/physics';
import { getCRF } from '../src/model/finance';
import { getDemand, getGroundSupply } from '../src/model/market';
import { getShellRadiationEffects } from '../src/model/orbital';
import { calcSatellite } from '../src/model/satellite';
import { defaults } from '../src/state/params';

describe('Physics', () => {
  it('launch cost decreases over time', () => {
    expect(getLaunchCost(2035, defaults)).toBeLessThan(getLaunchCost(2026, defaults));
  });

  it('launch cost never below floor', () => {
    expect(getLaunchCost(2050, defaults)).toBeGreaterThanOrEqual(defaults.launchFloor);
  });

  it('radiator mass drops after thermal breakthrough', () => {
    const pre = getRadiatorMassPerMW(2028, 300, defaults);
    const post = getRadiatorMassPerMW(2035, 300, defaults);
    expect(post).toBeLessThan(pre * 0.1); // 50× lighter
  });

  it('ground efficiency improves over time', () => {
    expect(getGroundEfficiency(2035, defaults)).toBeGreaterThan(getGroundEfficiency(2026, defaults));
  });

  it('orbital efficiency improves over time', () => {
    expect(getOrbitalEfficiency(2035, defaults)).toBeGreaterThan(getOrbitalEfficiency(2026, defaults));
  });

  it('orbital efficiency is less than ground due to radiation', () => {
    expect(getOrbitalEfficiency(2030, defaults)).toBeLessThan(getGroundEfficiency(2030, defaults));
  });
});

describe('Finance', () => {
  it('CRF is positive', () => {
    expect(getCRF(0.12, 8)).toBeGreaterThan(0);
  });

  it('CRF accounts for time value', () => {
    // CRF should be higher than simple depreciation (1/n) due to time value of money
    expect(getCRF(0.12, 8)).toBeGreaterThan(1 / 8);
  });

  it('CRF decreases with longer asset life', () => {
    expect(getCRF(0.12, 15)).toBeLessThan(getCRF(0.12, 8));
  });

  it('CRF increases with higher WACC', () => {
    expect(getCRF(0.20, 8)).toBeGreaterThan(getCRF(0.08, 8));
  });
});

describe('Market', () => {
  it('demand grows over time', () => {
    expect(getDemand(2035, defaults)).toBeGreaterThan(getDemand(2026, defaults));
  });

  it('ground supply grows over time', () => {
    expect(getGroundSupply(2035, defaults)).toBeGreaterThan(getGroundSupply(2026, defaults));
  });

  it('SMR boosts ground supply after smrYear', () => {
    const paramsNoSmr = { ...defaults, smrOn: false };
    const paramsWithSmr = { ...defaults, smrOn: true, smrYear: 2032 };
    expect(getGroundSupply(2040, paramsWithSmr)).toBeGreaterThan(getGroundSupply(2040, paramsNoSmr));
  });
});

describe('Orbital - Radiation Effects', () => {
  it('LEO has baseline TID factor', () => {
    const effects = getShellRadiationEffects('leo', 2030, defaults);
    expect(effects.tidFactor).toBe(1.0);
  });

  it('MEO has higher TID factor (Van Allen)', () => {
    const leoEffects = getShellRadiationEffects('leo', 2030, defaults);
    const meoEffects = getShellRadiationEffects('meo', 2030, defaults);
    expect(meoEffects.tidFactor).toBeGreaterThan(leoEffects.tidFactor);
  });

  it('GEO has lower TID than LEO', () => {
    const leoEffects = getShellRadiationEffects('leo', 2030, defaults);
    const geoEffects = getShellRadiationEffects('geo', 2030, defaults);
    expect(geoEffects.tidFactor).toBeLessThan(leoEffects.tidFactor);
  });

  it('SEU penalty improves over time with rad-hard tech', () => {
    // Use MEO which has seuMult > 1 to see improvement
    const effects2026 = getShellRadiationEffects('meo', 2026, defaults);
    const effects2040 = getShellRadiationEffects('meo', 2040, defaults);
    expect(effects2040.seuPenalty).toBeLessThan(effects2026.seuPenalty);
  });

  it('effective lifetime decreases in high-TID environments', () => {
    const leoEffects = getShellRadiationEffects('leo', 2030, defaults);
    const meoEffects = getShellRadiationEffects('meo', 2030, defaults);
    expect(meoEffects.effectiveLife).toBeLessThan(leoEffects.effectiveLife);
  });
});

describe('Satellite', () => {
  it('better AI efficiency gives more TFLOPS from same power', () => {
    // This test would have caught the compMass bug
    const paramsLow = { ...defaults, aiLearn: 0.10 };
    const paramsHigh = { ...defaults, aiLearn: 0.30 };
    const satLow = calcSatellite(2035, paramsLow);
    const satHigh = calcSatellite(2035, paramsHigh);
    // Same power, but higher efficiency means more TFLOPS
    expect(satHigh.tflops).toBeGreaterThan(satLow.tflops);
    // And lower LCOC (more output for same cost)
    expect(satHigh.lcoc).toBeLessThan(satLow.lcoc);
  });

  it('compute mass scales with power not TFLOPS', () => {
    // Verify the fix - mass should NOT increase with better efficiency
    const paramsLow = { ...defaults, aiLearn: 0.10 };
    const paramsHigh = { ...defaults, aiLearn: 0.30 };
    const satLow = calcSatellite(2035, paramsLow);
    const satHigh = calcSatellite(2035, paramsHigh);
    // Same power allocation means same compute mass
    expect(satHigh.mass.comp).toBe(satLow.mass.comp);
  });

  it('LCOC decreases over time', () => {
    const sat2026 = calcSatellite(2026, defaults);
    const sat2040 = calcSatellite(2040, defaults);
    expect(sat2040.lcoc).toBeLessThan(sat2026.lcoc);
  });

  it('LCOC drops significantly after thermal breakthrough', () => {
    const preThermal = calcSatellite(2028, defaults);
    const postThermal = calcSatellite(2032, defaults);
    expect(postThermal.lcoc).toBeLessThan(preThermal.lcoc * 0.5);
  });

  it('power increases after fission breakthrough', () => {
    const preFission = calcSatellite(2034, defaults);
    const postFission = calcSatellite(2036, defaults);
    // Fission increases power (6500 kW vs ~3800 kW = ~1.7x)
    expect(postFission.powerKw).toBeGreaterThan(preFission.powerKw * 1.5);
  });
});

describe('Integration - Sanity Checks', () => {
  it('2050 orbital efficiency should be much higher than 2026', () => {
    const ratio = getOrbitalEfficiency(2050, defaults) / getOrbitalEfficiency(2026, defaults);
    expect(ratio).toBeGreaterThan(10); // 10× improvement over 24 years
  });

  it('launch cost should drop by at least 90% by 2050', () => {
    const cost2026 = getLaunchCost(2026, defaults);
    const cost2050 = getLaunchCost(2050, defaults);
    expect(cost2050 / cost2026).toBeLessThan(0.1);
  });
});
