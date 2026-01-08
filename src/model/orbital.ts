import { SHELLS } from './constants';
import type { Params, RadiationEffects } from './types';

/**
 * Calculate radiation effects by orbital shell.
 * - TID (Total Ionizing Dose): cumulative damage reducing hardware lifetime
 * - SEU (Single Event Upsets): transient errors requiring redundancy
 *
 * MEO experiences highest radiation due to Van Allen belts.
 * GEO is above the belts with lower radiation.
 * Cislunar has galactic cosmic ray (GCR) exposure.
 */
export function getShellRadiationEffects(
  shell: string,
  year: number,
  params: Params
): RadiationEffects {
  const shellData = SHELLS[shell];
  const t = year - 2026;

  // Check for photonic computing - photons are immune to ionizing radiation
  const hasPhotonic = params.photonicOn && year >= params.photonicYear;

  // TID effect: reduces effective lifetime (higher tidMult = shorter life)
  // Photonic circuits don't degrade from ionizing radiation
  const tidFactor = hasPhotonic ? 1.0 : shellData.tidMult;
  const effectiveLife = params.satLife / tidFactor;

  // SEU effect: reliability overhead (redundancy, ECC, spares)
  // seuMult of 1.0 = no overhead, 2.0 = 2× compute needed
  // Improves over time with rad-hard tech
  // Photonic computing is completely immune to SEU - photons aren't affected by cosmic rays
  let seuPenalty = 1.0;
  if (!hasPhotonic) {
    const radHardBase = 0.82 + params.radPen * 0.1;
    const radHardImprovement = Math.pow(radHardBase, t);
    seuPenalty = 1 + (shellData.seuMult - 1) * radHardImprovement;
  }

  // Availability factor: fraction of compute usable after SEU overhead
  const availabilityFactor = 1 / seuPenalty;

  // Replacement rate: driven by TID degradation
  const baseReplacement = 1 / effectiveLife;
  const replacementRate = Math.min(0.30, baseReplacement);

  return {
    tidFactor,
    effectiveLife,
    seuPenalty,
    availabilityFactor,
    replacementRate
  };
}

export function getAllShellReliability(
  year: number,
  params: Params
): Record<string, RadiationEffects> {
  return {
    leo: getShellRadiationEffects('leo', year, params),
    meo: getShellRadiationEffects('meo', year, params),
    geo: getShellRadiationEffects('geo', year, params),
    cislunar: getShellRadiationEffects('cislunar', year, params)
  };
}
