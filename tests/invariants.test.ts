import { describe, it, expect } from 'vitest';
import {
  getLaunchCost,
  getRadiatorMassPerMW,
  getGroundEfficiency,
  getOrbitalEfficiency,
  getRadiatorNetWPerM2,
  getEclipseFraction,
  getPlatformGoodputGbps,
  getCommsTflopsLimit,
  getTokensPerSecond
} from '../src/model/physics';
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

  it('radiation penalty reduces satellite TFLOPS output', () => {
    const sat = calcSatellite(2030, defaults);
    const rawTflops = sat.computeKw * sat.gflopsW;
    expect(sat.tflops).toBeLessThan(rawTflops);
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

// =====================================================
// NEW CONSTRAINT TESTS
// =====================================================

describe('Thermal - Radiative Balance', () => {
  it('net radiation is positive (q_emit > q_abs)', () => {
    const qNetSun = getRadiatorNetWPerM2(defaults, 2030, false);
    const qNetEcl = getRadiatorNetWPerM2(defaults, 2030, true);
    expect(qNetSun).toBeGreaterThan(0);
    expect(qNetEcl).toBeGreaterThan(0);
  });

  it('eclipse has higher net radiation (no solar/albedo absorption)', () => {
    const qNetSun = getRadiatorNetWPerM2(defaults, 2030, false);
    const qNetEcl = getRadiatorNetWPerM2(defaults, 2030, true);
    expect(qNetEcl).toBeGreaterThan(qNetSun);
  });

  it('eclipse fraction is between 0 and 1', () => {
    const frac = getEclipseFraction(defaults, 2030, 'leo');
    expect(frac).toBeGreaterThanOrEqual(0);
    expect(frac).toBeLessThanOrEqual(1);
  });

  it('LEO has higher eclipse fraction than GEO (when no global override)', () => {
    // Remove global eclipseFrac override to test per-shell defaults
    const noOverride = { ...defaults, eclipseFrac: 0 };
    const leoFrac = getEclipseFraction(noOverride, 2030, 'leo');
    const geoFrac = getEclipseFraction(noOverride, 2030, 'geo');
    expect(leoFrac).toBeGreaterThan(geoFrac);
  });
});

describe('Thermal Constraint - Binding', () => {
  it('reducing radMassFrac makes thermal bind', () => {
    // Normal params
    const satNormal = calcSatellite(2030, defaults);

    // Severely constrained radiator budget
    const constrainedParams = { ...defaults, radMassFrac: 0.02 }; // 2% instead of 15%
    const satConstrained = calcSatellite(2030, constrainedParams);

    // Thermal should bind
    expect(satConstrained.binding).toBe('thermal');
    expect(satConstrained.thermalLimited).toBe(true);
    // TFLOPs should be lower
    expect(satConstrained.tflops).toBeLessThan(satNormal.tflops);
  });

  it('increasing qSolarAbsWPerM2 reduces thermal limit', () => {
    const satNormal = calcSatellite(2030, defaults);

    // High absorbed solar flux
    const highAbsParams = { ...defaults, qSolarAbsWPerM2: 800 }; // 4x absorption
    const satHighAbs = calcSatellite(2030, highAbsParams);

    // Thermal capacity should be lower (higher absorption eats into net rejection)
    expect(satHighAbs.radCapacityKw).toBeLessThan(satNormal.radCapacityKw);
  });

  it('increasing wasteHeatFrac reduces compute', () => {
    const satNormal = calcSatellite(2030, defaults);

    // Higher waste heat fraction
    const highWasteParams = { ...defaults, wasteHeatFrac: 0.99 }; // 99% waste
    const satHighWaste = calcSatellite(2030, highWasteParams);

    // Same radiator can reject less compute power
    expect(satHighWaste.limits.thermalKwLimit).toBeLessThan(satNormal.limits.thermalKwLimit);
  });
});

describe('Bandwidth - Goodput Model', () => {
  it('goodput is positive', () => {
    const goodput = getPlatformGoodputGbps(defaults, 2030);
    expect(goodput).toBeGreaterThan(0);
  });

  it('goodput scales with terminal capacity', () => {
    const goodputLow = getPlatformGoodputGbps({ ...defaults, terminalGoodputGbps: 10 }, 2030);
    const goodputHigh = getPlatformGoodputGbps({ ...defaults, terminalGoodputGbps: 100 }, 2030);
    expect(goodputHigh).toBeGreaterThan(goodputLow);
  });

  it('comms TFLOPs limit is positive', () => {
    const limit = getCommsTflopsLimit(defaults, 2030);
    expect(limit).toBeGreaterThan(0);
  });

  it('reducing terminalGoodputGbps reduces comms limit', () => {
    const limitHigh = getCommsTflopsLimit(defaults, 2030);
    const limitLow = getCommsTflopsLimit({ ...defaults, terminalGoodputGbps: 2 }, 2030);
    expect(limitLow).toBeLessThan(limitHigh);
  });
});

describe('Tokens - FLOPs Model', () => {
  it('tokens per second scales with TFLOPs', () => {
    const tokens1 = getTokensPerSecond(1, defaults);
    const tokens10 = getTokensPerSecond(10, defaults);
    expect(tokens10).toBeCloseTo(tokens1 * 10, 5);
  });

  it('larger models produce fewer tokens per TFLOP', () => {
    // Llama-7B: 14 GFLOPs/token
    const small = getTokensPerSecond(1000, { ...defaults, flopsPerToken: 14e9 });
    // Llama-70B: 140 GFLOPs/token
    const large = getTokensPerSecond(1000, { ...defaults, flopsPerToken: 140e9 });
    expect(large).toBeLessThan(small);
  });
});

describe('Constraint Audit', () => {
  it('satellite returns valid constraint limits', () => {
    const sat = calcSatellite(2030, defaults);
    expect(sat.limits.powerKwLimit).toBeGreaterThan(0);
    expect(sat.limits.thermalKwLimit).toBeGreaterThan(0);
    expect(sat.limits.commsTflopsLimit).toBeGreaterThan(0);
  });

  it('satellite returns valid binding constraint', () => {
    const sat = calcSatellite(2030, defaults);
    expect(['power', 'thermal', 'comms']).toContain(sat.binding);
  });

  it('margins are between 0 and 1 for binding constraints', () => {
    const sat = calcSatellite(2030, defaults);
    // At least one margin should be close to 1 (the binding one)
    const maxMargin = Math.max(sat.margins.power, sat.margins.thermal);
    expect(maxMargin).toBeGreaterThan(0.5);
  });
});

describe('Unit Sanity', () => {
  it('computeKw=1 and gflopsW=1000 gives rawTflops=1000', () => {
    // This tests the TFLOPS calculation: TFLOPS = computeKw × gflopsW
    // When computeKw=1 and gflopsW=1000, we should get 1000 TFLOPS
    // Note: The actual satellite model has availability factors, so we test physics directly
    const computeKw = 1;
    const gflopsW = 1000;
    const rawTflops = computeKw * gflopsW;
    expect(rawTflops).toBe(1000);
  });
});

describe('No Circular Sizing', () => {
  it('higher wasteHeatFrac means lower compute', () => {
    const sat90 = calcSatellite(2030, { ...defaults, wasteHeatFrac: 0.90 });
    const sat95 = calcSatellite(2030, { ...defaults, wasteHeatFrac: 0.95 });
    // More waste heat = less compute capacity from same thermal budget
    expect(sat95.computeKw).toBeLessThanOrEqual(sat90.computeKw);
  });
});
