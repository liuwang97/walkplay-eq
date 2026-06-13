/**
 * useResponseCurve — memoized combined PEQ magnitude response.
 *
 * Returns the shared log frequency axis plus the magnitude array (dB) for the
 * given EqState. If no state is passed it reads the live EQ from the store.
 * Reusable by the curve chart, by export, or anywhere a numeric response is
 * needed.
 */

import { useMemo } from "react";
import type { EqState } from "@/lib/types";
import { useEqStore } from "@/lib/store";
import { computeMagnitudeResponse, makeFreqAxis } from "./dsp";

export interface ResponseCurveData {
  /** Log-spaced frequency axis (Hz), length === points. */
  freqs: Float64Array;
  /** Combined magnitude response (dB), aligned with `freqs`. */
  mags: Float64Array;
  /** Min dB across the curve (useful for auto-ranging the y-axis). */
  minDb: number;
  /** Max dB across the curve. */
  maxDb: number;
}

/**
 * @param eqOverride optional EqState; when omitted, uses the live store EQ.
 * @param points     number of samples on the log frequency axis (default 256).
 */
export function useResponseCurve(eqOverride?: EqState, points = 256): ResponseCurveData {
  const storeEq = useEqStore((s) => s.eq);
  const eq = eqOverride ?? storeEq;

  const freqs = useMemo(() => makeFreqAxis(points), [points]);

  return useMemo(() => {
    const mags = computeMagnitudeResponse(eq, freqs);
    let minDb = Infinity;
    let maxDb = -Infinity;
    for (let i = 0; i < mags.length; i++) {
      const v = mags[i];
      if (v < minDb) minDb = v;
      if (v > maxDb) maxDb = v;
    }
    return { freqs, mags, minDb, maxDb };
  }, [eq, freqs]);
}
