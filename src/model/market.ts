import type { Params } from './types';

export function getDemand(year: number, params: Params): number {
  const t = year - 2026;
  const growth = Math.max(0.25, params.demandGrowth + 0.20 - t * 0.015);
  return params.demand2025 * Math.pow(1 + growth, t);
}

export function getGroundSupply(year: number, params: Params): number {
  const t = year - 2026;
  const delayYears = params.interconnect / 12;
  const effectiveT = Math.max(0, t - delayYears);
  let baseSupply = params.supply2025 + effectiveT * (params.supplyGrowth * 100);

  // SMR boost: DECOUPLED from space fission - independent ground policy
  if (params.smrOn && year >= params.smrYear) {
    const smrMaturity = Math.min(1, (year - params.smrYear) / 5);
    const smrBoost = (10 + smrMaturity * 15) * (year - params.smrYear);
    baseSupply += smrBoost;
  }

  return baseSupply;
}
