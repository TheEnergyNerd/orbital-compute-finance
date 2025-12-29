/**
 * Capital Recovery Factor - converts capex to annualized payment
 * CRF = r(1+r)^n / ((1+r)^n - 1)
 *
 * This is the key to proper LCOC calculation - not naive depreciation
 */
export function getCRF(wacc: number, years: number): number {
  if (wacc <= 0 || years <= 0) return 1 / Math.max(1, years);
  const r = wacc;
  const n = years;
  const factor = Math.pow(1 + r, n);
  return (r * factor) / (factor - 1);
}
