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

  // Check for photonic computing
  const hasPhotonic = params.photonicOn && year >= params.photonicYear;

  // Photonic systems have PARTIAL radiation immunity (70% mitigation, not 100%)
  // While photons themselves are immune to radiation, photonic systems still need:
  // - Control electronics (ASICs, FPGAs)
  // - Memory and drivers
  // - Power electronics
  // - Photodetectors (which degrade)
  // - Packaging and interconnects
  // These components still suffer radiation damage
  const photonicMitigation = 0.7;  // 70% reduction in radiation effects

  // TID effect: reduces effective lifetime (higher tidMult = shorter life)
  let tidFactor = shellData.tidMult;
  if (hasPhotonic) {
    // Reduce TID penalty by 70% (e.g., 50x becomes 15.7x)
    tidFactor = 1 + (shellData.tidMult - 1) * (1 - photonicMitigation);
  }
  const effectiveLife = params.satLife / tidFactor;

  // SEU effect: reliability overhead (redundancy, ECC, spares)
  // seuMult of 1.0 = baseline (LEO), higher = worse (MEO, Cislunar)
  // Improves over time with rad-hard tech
  // Note: GEO has seuMult=0.8 (less than LEO) but we clamp penalty >= 1.0
  const radHardBase = 0.82 + params.radPen * 0.1;
  const radHardImprovement = Math.pow(radHardBase, t);
  // Clamp seuMult to 1.0 minimum - can't have better-than-baseline availability
  const effectiveSeuMult = Math.max(1.0, shellData.seuMult);
  let seuPenalty = 1 + (effectiveSeuMult - 1) * radHardImprovement;
  if (hasPhotonic) {
    // Photonic reduces SEU penalty by 70% (e.g., 5.4x becomes ~2.3x)
    seuPenalty = 1 + (seuPenalty - 1) * (1 - photonicMitigation);
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
