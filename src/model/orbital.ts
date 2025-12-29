import { SHELLS } from './constants';
import type { Params, RadiationEffects } from './types';

/**
 * RADIATION IS THE TAX YOU PAY FOR FREE POWER
 *
 * Calculate radiation effects by orbital shell:
 * - TID (Total Ionizing Dose): your chips slowly die
 * - SEU (Single Event Upsets): random cosmic ray bit-flips
 *
 * MEO is hell (Van Allen belts). GEO is surprisingly chill.
 * Cislunar gets weird with GCR exposure.
 */
export function getShellRadiationEffects(
  shell: string,
  year: number,
  params: Params
): RadiationEffects {
  const shellData = SHELLS[shell];
  const t = year - 2026;

  // TID effect: reduces effective lifetime (higher tidMult = shorter life)
  const tidFactor = shellData.tidMult;
  const effectiveLife = params.satLife / tidFactor;

  // SEU effect: reliability overhead (redundancy, ECC, spares)
  // seuMult of 1.0 = no overhead, 2.0 = 2× compute needed
  // Improves over time with rad-hard tech
  // Higher radPen = slower improvement (higher base means slower decay)
  const radHardBase = 0.82 + params.radPen * 0.1;
  const radHardImprovement = Math.pow(radHardBase, t);
  const seuPenalty = 1 + (shellData.seuMult - 1) * radHardImprovement;

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
