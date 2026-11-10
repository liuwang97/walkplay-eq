/**
 * Combined magnitude response of an EQ state, for the on-screen curve and the
 * preset thumbnails. Uses the same biquads, at the same sample rate, as the
 * frames sent to the device (see `@/features/eq/biquad`).
 */

import { bandBiquad, magnitudeDb } from "@/features/eq/biquad";
import { T02_SAMPLE_RATE } from "@/features/eq/t02-protocol";
import type { EqState } from "@/lib/types";

/** Visualization range. */
export const F_MIN = 20;
export const F_MAX = 20_000;

/** A log-spaced frequency axis of `n` points over [F_MIN, F_MAX]. */
export function makeFreqAxis(n: number): Float64Array {
  const freqs = new Float64Array(n);
  const logMin = Math.log10(F_MIN);
  const step = (Math.log10(F_MAX) - logMin) / (n - 1);
  for (let i = 0; i < n; i++) freqs[i] = Math.pow(10, logMin + step * i);
  return freqs;
}

/** Response in dB at each frequency: every band's contribution plus the preamp. */
export function computeMagnitudeResponse(eq: EqState, freqs: Float64Array): Float64Array {
  const filters = eq.bands.map((b) => bandBiquad(b, T02_SAMPLE_RATE));
  const out = new Float64Array(freqs.length);
  for (let i = 0; i < freqs.length; i++) {
    let db = eq.preamp;
    for (const f of filters) db += magnitudeDb(f, freqs[i], T02_SAMPLE_RATE);
    out[i] = db;
  }
  return out;
}
