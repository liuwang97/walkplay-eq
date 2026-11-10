/**
 * The one biquad implementation in the app. Both the frames sent to the device
 * and the curve drawn on screen come from here, so what you see is what the
 * hardware plays.
 *
 * RBJ "Audio EQ Cookbook" filters, normalized by a0 and returned in the
 * device's wire order: [b0, b1, b2, -a1, -a2].
 */

import type { EqBand, EqBandType } from "@/lib/types";

export type Biquad = [number, number, number, number, number];

/** A filter that passes audio through untouched. */
export const IDENTITY: Biquad = [1, 0, 0, 0, 0];

/**
 * Floor for the high-shelf slope term. Steep shelves (high Q) at high gain
 * drive the cookbook radicand to zero and below, where no real filter exists:
 * the result is first a huge resonant spike and then NaN, which the device
 * plays as silence. Flooring keeps such settings a tame, stable filter (damping
 * no sharper than a Q of 2).
 */
const MIN_SHELF_RADICAND = 0.25;

/**
 * The official app's low shelf has one fixed slope and ignores Q: its cookbook
 * slope term `1/S - 1` is the constant 0.25 (S = 0.8).
 */
const LOW_SHELF_SLOPE_TERM = 0.25;

/** The device stores each coefficient as a Q30 int32, so it must lie in [-2, 2). */
const Q30 = 2 ** 30;

function fitsDevice(c: Biquad): boolean {
  return c.every((x) => {
    const n = Math.round(x * Q30);
    return n >= -(2 ** 31) && n < 2 ** 31;
  });
}

/** How far the gain is eased per step when a filter does not fit the device. */
const GAIN_BACKOFF_DB = 0.1;

/**
 * The filter for one band, as the device can hold it.
 *
 * Very wide, strongly boosted bells near the top of the band (and most boosted
 * high shelves) need coefficients of 2 or more. Sent anyway, the int32 wraps
 * and the device plays a different, violent filter, so the gain is eased
 * toward flat until the filter fits. The curve is drawn from the same result,
 * so it shows what is actually played.
 */
export function biquad(
  type: EqBandType,
  freqHz: number,
  q: number,
  gainDb: number,
  fs: number,
): Biquad {
  let gain = gainDb;
  let c = design(type, freqHz, q, gain, fs);
  while (!fitsDevice(c) && gain !== 0) {
    gain = Math.abs(gain) <= GAIN_BACKOFF_DB ? 0 : gain - Math.sign(gain) * GAIN_BACKOFF_DB;
    c = design(type, freqHz, q, gain, fs);
  }
  return c;
}

/** The cookbook filter for these parameters, whether or not the device can hold it. */
function design(type: EqBandType, freqHz: number, q: number, gainDb: number, fs: number): Biquad {
  const w = (2 * Math.PI * freqHz) / fs;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const A = Math.pow(10, gainDb / 40);

  if (type === "LP" || type === "HP") {
    // The pass filters have no gain; the low pass keeps (1 - cos), the high
    // pass (1 + cos).
    const alpha = sw / (2 * q);
    const a0 = 1 + alpha;
    const k = type === "LP" ? 1 - cw : 1 + cw;
    const edge = k / 2 / a0;
    return [edge, type === "LP" ? k / a0 : -k / a0, edge, (2 * cw) / a0, -(1 - alpha) / a0];
  }

  if (type === "PK") {
    const alpha = sw / (2 * q);
    const a0 = 1 + alpha / A;
    return [
      (1 + alpha * A) / a0,
      (-2 * cw) / a0,
      (1 - alpha * A) / a0,
      (2 * cw) / a0,
      -(1 - alpha / A) / a0,
    ];
  }

  // Shelves. The low shelf keeps the official app's order of operations so it
  // rounds to the same bytes.
  const slopeTerm = type === "LS" ? LOW_SHELF_SLOPE_TERM : 1 / q - 1;
  const radicand = Math.max((A + 1 / A) * slopeTerm + 2, MIN_SHELF_RADICAND);
  const alpha = (sw / 2) * Math.sqrt(radicand);
  const twoSqA = 2 * Math.sqrt(A) * alpha;

  if (type === "LS") {
    const a0 = A + 1 + (A - 1) * cw + twoSqA;
    return [
      (A * (A + 1 - (A - 1) * cw + twoSqA)) / a0,
      (2 * A * (A - 1 - (A + 1) * cw)) / a0,
      (A * (A + 1 - (A - 1) * cw - twoSqA)) / a0,
      (2 * (A - 1 + (A + 1) * cw)) / a0,
      -(A + 1 + (A - 1) * cw - twoSqA) / a0,
    ];
  }

  // HS
  const a0 = A + 1 - (A - 1) * cw + twoSqA;
  return [
    (A * (A + 1 + (A - 1) * cw + twoSqA)) / a0,
    (-2 * A * (A - 1 + (A + 1) * cw)) / a0,
    (A * (A + 1 + (A - 1) * cw - twoSqA)) / a0,
    (-2 * (A - 1 - (A + 1) * cw)) / a0,
    -(A + 1 - (A - 1) * cw - twoSqA) / a0,
  ];
}

/** The filter a band contributes: its biquad, or pass-through when disabled. */
export function bandBiquad(band: EqBand, fs: number): Biquad {
  return band.enabled ? biquad(band.type, band.freq, band.q, band.gain, fs) : IDENTITY;
}

/** Magnitude in dB of a biquad at `freqHz`. */
export function magnitudeDb(c: Biquad, freqHz: number, fs: number): number {
  const w = (2 * Math.PI * freqHz) / fs;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  // H(z) = (b0 + b1 z⁻¹ + b2 z⁻²) / (1 + a1 z⁻¹ + a2 z⁻²), with -a1 = c[3], -a2 = c[4].
  const numRe = c[0] + c[1] * c1 + c[2] * c2;
  const numIm = c[1] * s1 + c[2] * s2;
  const denRe = 1 - c[3] * c1 - c[4] * c2;
  const denIm = c[3] * s1 + c[4] * s2;
  return 10 * Math.log10((numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm));
}
