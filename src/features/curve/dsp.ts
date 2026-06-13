/**
 * DSP: combined magnitude response of the 10-band PEQ.
 *
 * We model each band as an RBJ "Audio EQ Cookbook" biquad (peaking / low-shelf /
 * high-shelf) at fs = 48000 Hz, evaluate its complex transfer function on the
 * unit circle at each frequency, take |H(e^jw)| in dB, and SUM the per-band dB
 * contributions. The global preamp is a flat dB offset added on top.
 *
 * Reference: Robert Bristow-Johnson, "Cookbook formulae for audio EQ biquad
 * filter coefficients".
 */

import type { EqBand, EqState } from "@/lib/types";

/** Sample rate assumed by the hardware DSP. */
export const FS = 48000;

/** Visualization range. */
export const F_MIN = 20;
export const F_MAX = 20_000;

const LN10_OVER_20 = Math.LN10 / 20; // for 10^(x/20) via exp

/**
 * Biquad coefficients (b0,b1,b2,a0,a1,a2) for one cookbook band.
 * Returns a flat (all-pass-ish, 0 dB) identity filter when the band is disabled
 * or has zero gain, so it contributes nothing to the summed response.
 */
function bandCoeffs(band: EqBand): [number, number, number, number, number, number] {
  if (!band.enabled || band.gain === 0) {
    return [1, 0, 0, 1, 0, 0];
  }

  const A = Math.exp((band.gain / 40) * Math.LN10); // 10^(gain/40) = sqrt(linear gain)
  const w0 = (2 * Math.PI * band.freq) / FS;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const q = band.q > 0 ? band.q : 0.0001;
  const alpha = sinw0 / (2 * q);

  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;

  switch (band.type) {
    case "LS": {
      // Low shelf
      const twoSqrtAalpha = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cosw0 + twoSqrtAalpha);
      b1 = 2 * A * (A - 1 - (A + 1) * cosw0);
      b2 = A * (A + 1 - (A - 1) * cosw0 - twoSqrtAalpha);
      a0 = A + 1 + (A - 1) * cosw0 + twoSqrtAalpha;
      a1 = -2 * (A - 1 + (A + 1) * cosw0);
      a2 = A + 1 + (A - 1) * cosw0 - twoSqrtAalpha;
      break;
    }
    case "HS": {
      // High shelf
      const twoSqrtAalpha = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cosw0 + twoSqrtAalpha);
      b1 = -2 * A * (A - 1 + (A + 1) * cosw0);
      b2 = A * (A + 1 + (A - 1) * cosw0 - twoSqrtAalpha);
      a0 = A + 1 - (A - 1) * cosw0 + twoSqrtAalpha;
      a1 = 2 * (A - 1 - (A + 1) * cosw0);
      a2 = A + 1 - (A - 1) * cosw0 - twoSqrtAalpha;
      break;
    }
    case "PK":
    default: {
      // Peaking
      b0 = 1 + alpha * A;
      b1 = -2 * cosw0;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cosw0;
      a2 = 1 - alpha / A;
      break;
    }
  }

  return [b0, b1, b2, a0, a1, a2];
}

/**
 * Magnitude (in dB) of a biquad at digital frequency w (rad/sample).
 *
 * |H(e^jw)| where H(z) = (b0 + b1 z^-1 + b2 z^-2) / (a0 + a1 z^-1 + a2 z^-2),
 * evaluated with z^-1 = e^-jw.
 */
function biquadMagDb(
  c: readonly [number, number, number, number, number, number],
  w: number,
): number {
  const [b0, b1, b2, a0, a1, a2] = c;
  const cos1 = Math.cos(w);
  const cos2 = Math.cos(2 * w);
  const sin1 = Math.sin(w);
  const sin2 = Math.sin(2 * w);

  // z^-1 = cos(w) - j sin(w); z^-2 = cos(2w) - j sin(2w)
  const numRe = b0 + b1 * cos1 + b2 * cos2;
  const numIm = -(b1 * sin1 + b2 * sin2);
  const denRe = a0 + a1 * cos1 + a2 * cos2;
  const denIm = -(a1 * sin1 + a2 * sin2);

  const numMagSq = numRe * numRe + numIm * numIm;
  const denMagSq = denRe * denRe + denIm * denIm;

  // 10*log10(|num|^2/|den|^2) = 20*log10(|num|/|den|)
  return 10 * Math.log10(numMagSq / denMagSq);
}

/**
 * Build a log-spaced frequency axis of `n` points over [F_MIN, F_MAX].
 */
export function makeFreqAxis(n = 256): Float64Array {
  const freqs = new Float64Array(n);
  const logMin = Math.log10(F_MIN);
  const logMax = Math.log10(F_MAX);
  const step = (logMax - logMin) / (n - 1);
  for (let i = 0; i < n; i++) {
    freqs[i] = Math.pow(10, logMin + step * i);
  }
  return freqs;
}

/**
 * Combined magnitude response in dB across the given frequency axis.
 *
 * For each frequency, sums the dB contribution of every band plus the preamp.
 */
export function computeMagnitudeResponse(eq: EqState, freqs: Float64Array): Float64Array {
  const n = freqs.length;
  const out = new Float64Array(n);

  // Precompute coefficients once per band.
  const coeffs = eq.bands.map(bandCoeffs);

  for (let i = 0; i < n; i++) {
    const w = (2 * Math.PI * freqs[i]) / FS;
    let db = eq.preamp; // flat preamp offset
    for (let k = 0; k < coeffs.length; k++) {
      db += biquadMagDb(coeffs[k], w);
    }
    out[i] = db;
  }
  return out;
}

/** Linear amplitude from dB (handy for callers / tests). */
export function dbToLin(db: number): number {
  return Math.exp(db * LN10_OVER_20);
}
