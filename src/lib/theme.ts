/**
 * WalkPlay EQ — porcelain design system primitives.
 *
 * Ported from the Claude Design handoff (`design-ref/`): the accent palette,
 * the instrument's log-frequency / dB geometry, and the preset mini-curve
 * thumbnail, so every component shares one source of truth.
 */

import { computeMagnitudeResponse, F_MAX, F_MIN, makeFreqAxis } from "@/features/curve/dsp";
import type { EqState } from "@/lib/types";

// ---------------------------------------------------------------------------
// Accent palette
// ---------------------------------------------------------------------------

export type AccentKey = "azure" | "violet" | "emerald" | "amber" | "graphite";

const ACCENT_BASE: Record<AccentKey, { a: string; d: string }> = {
  azure: { a: "#2f6bff", d: "#6a4cff" },
  violet: { a: "#6d5cff", d: "#a64cff" },
  emerald: { a: "#10b07a", d: "#36b6c4" },
  amber: { a: "#e08a2f", d: "#ef6a5b" },
  graphite: { a: "#465066", d: "#6b7488" },
};

export const ACCENT_KEYS = Object.keys(ACCENT_BASE) as AccentKey[];

/** Resolve a hex color to an rgba() string with the given alpha. */
export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export interface Palette {
  /** Primary accent (start of the gradient). */
  a: string;
  /** Secondary accent (end of the gradient). */
  d: string;
  /** `linear-gradient(135deg, a, d)`. */
  grad: string;
  /** Accent at 10% alpha — soft chip/well backgrounds. */
  soft: string;
  /** Accent at 45% alpha — colored shadows. */
  shadow: string;
  ink: string;
  cut: string;
}

/** Build the full palette for an accent key. */
export function palette(accent: AccentKey): Palette {
  const p = ACCENT_BASE[accent] ?? ACCENT_BASE.azure;
  return {
    a: p.a,
    d: p.d,
    grad: `linear-gradient(135deg, ${p.a}, ${p.d})`,
    soft: hexA(p.a, 0.1),
    shadow: hexA(p.a, 0.45),
    ink: "#1b1f2e",
    cut: "#7c8398",
  };
}

// ---------------------------------------------------------------------------
// Instrument geometry — log frequency axis (20 Hz .. 20 kHz) + dB axis
// ---------------------------------------------------------------------------

/** Internal SVG drawing width of the curve/rail (viewBox units). */
export const INSTR_W = 740;
/** Internal SVG drawing height of the curve (viewBox units). */
export const INSTR_H = 256;

const LF0 = Math.log10(F_MIN);
const LFS = Math.log10(F_MAX) - LF0;

/** Gain axis half-span (dB) the curve maps to ±(H/2 − 22). */
const GAIN_SPAN = 15;

/** Frequency (Hz) -> x in [0, INSTR_W]. */
export function freqToX(f: number): number {
  return ((Math.log10(f) - LF0) / LFS) * INSTR_W;
}
/** x in [0, INSTR_W] -> frequency (Hz). */
export function xToFreq(x: number): number {
  return Math.pow(10, LF0 + (x / INSTR_W) * LFS);
}
/** dB -> y in the curve viewBox (0 dB at vertical center). */
export function dbToY(db: number): number {
  return INSTR_H / 2 - (db / GAIN_SPAN) * (INSTR_H / 2 - 22);
}
/** y -> dB (inverse of {@link dbToY}). */
export function yToDb(y: number): number {
  return ((INSTR_H / 2 - y) / (INSTR_H / 2 - 22)) * GAIN_SPAN;
}

/** Format a frequency for axis/label display (e.g. 1000 -> "1k", 1170 -> "1.2k"). */
export function fmtFreq(f: number): string {
  if (f >= 1000) {
    const k = f / 1000;
    return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`;
  }
  return `${Math.round(f)}`;
}

/** Frequency gridlines / ticks for the curve. */
export const FREQ_TICKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
/** dB gridlines for the curve. */
export const DB_TICKS = [-12, -6, 0, 6, 12];

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const round1 = (v: number) => Math.round(v * 10) / 10;
export const round05 = (v: number) => Math.round(v * 2) / 2;

// ---------------------------------------------------------------------------
// Preset mini-curve thumbnail (sidebar cards)
// ---------------------------------------------------------------------------

const THUMB_AXIS = makeFreqAxis(46);

/**
 * SVG path for a preset's response fitted to a `w`×`h` box. Uses the same
 * biquad DSP as the live curve, so thumbnails are real, not faked.
 */
export function thumbPath(eq: EqState, w: number, h: number): string {
  const mags = computeMagnitudeResponse(eq, THUMB_AXIS);
  const last = THUMB_AXIS.length - 1;
  const pts: string[] = [];
  for (let i = 0; i <= last; i++) {
    const x = (i / last) * w;
    const y = clamp(h / 2 - (mags[i] / 10) * (h * 0.41), 2, h - 2);
    pts.push((i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1));
  }
  return pts.join(" ");
}
