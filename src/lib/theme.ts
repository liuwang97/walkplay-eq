/**
 * WalkPlay EQ — porcelain design system primitives.
 *
 * Ported from the Claude Design handoff (`design-ref/`). Centralizes the accent
 * palette, the instrument's log-frequency / dB geometry, and the preset
 * mini-curve thumbnail generator so every redesigned component shares one
 * source of truth. The DSP itself is reused from `@/features/curve/dsp`.
 */

import { computeMagnitudeResponse } from "@/features/curve/dsp";
import type { EqState } from "@/lib/types";

// ---------------------------------------------------------------------------
// Accent palette
// ---------------------------------------------------------------------------

export type AccentKey = "azure" | "violet" | "emerald" | "amber" | "graphite";

export const ACCENT_KEYS: readonly AccentKey[] = [
  "azure",
  "violet",
  "emerald",
  "amber",
  "graphite",
];

const ACCENT_BASE: Record<AccentKey, { a: string; d: string }> = {
  azure: { a: "#2f6bff", d: "#6a4cff" },
  violet: { a: "#6d5cff", d: "#a64cff" },
  emerald: { a: "#10b07a", d: "#36b6c4" },
  amber: { a: "#e08a2f", d: "#ef6a5b" },
  graphite: { a: "#465066", d: "#6b7488" },
};

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
  muted: string;
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
    muted: "#8a90a3",
    cut: "#7c8398",
  };
}

// ---------------------------------------------------------------------------
// Shared neutral porcelain tokens (for inline styles)
// ---------------------------------------------------------------------------

export const INK = "#1b1f2e";
export const MUTED = "#8a90a3";
export const CUT = "#7c8398";
export const LINE = "rgba(28,32,58,0.08)";
export const LINE_SOFT = "rgba(28,32,58,0.07)";
export const HAIRLINE = "rgba(28,32,58,0.06)";

// ---------------------------------------------------------------------------
// Instrument geometry — log frequency axis (20 Hz .. 20 kHz) + dB axis
// ---------------------------------------------------------------------------

/** Internal SVG drawing width of the curve/rail (viewBox units). */
export const INSTR_W = 740;
/** Internal SVG drawing height of the curve (viewBox units). */
export const INSTR_H = 256;

export const F_MIN = 20;
export const F_MAX = 20000;
const LF0 = Math.log10(F_MIN);
const LFS = Math.log10(F_MAX) - Math.log10(F_MIN);

/** Gain axis half-span (dB) the curve maps to ±(H/2). */
export const GAIN_SPAN = 15;
/** Per-band gain clamp (dB). */
export const GAIN_MIN = -10;
export const GAIN_MAX = 10;
/** Preamp clamp (dB). */
export const PREAMP_MIN = -16;
export const PREAMP_MAX = 6;

/** Frequency (Hz) -> x in [0, INSTR_W]. */
export function freqToX(f: number, w = INSTR_W): number {
  return ((Math.log10(f) - LF0) / LFS) * w;
}
/** x in [0, INSTR_W] -> frequency (Hz). */
export function xToFreq(x: number, w = INSTR_W): number {
  return Math.pow(10, LF0 + (x / w) * LFS);
}
/** dB -> y in the curve viewBox (0 dB at vertical center). */
export function dbToY(db: number, h = INSTR_H): number {
  return h / 2 - (db / GAIN_SPAN) * (h / 2 - 22);
}
/** y -> dB (inverse of {@link dbToY}). */
export function yToDb(y: number, h = INSTR_H): number {
  return ((h / 2 - y) / (h / 2 - 22)) * GAIN_SPAN;
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

/**
 * Build an SVG path string for a preset's response, fitted to a `w`×`h` box
 * (default 108×34 to match the design cards). Uses the same biquad DSP as the
 * live curve so thumbnails are real, not faked.
 */
export function thumbPath(eq: EqState, w = 108, h = 34, n = 46): string {
  const freqs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    freqs[i] = Math.pow(10, LF0 + (i / (n - 1)) * LFS);
  }
  const mags = computeMagnitudeResponse(eq, freqs);
  const mid = h / 2;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w;
    const y = clamp(mid - (mags[i] / 10) * (h * 0.41), 2, h - 2);
    pts.push((i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1));
  }
  return pts.join(" ");
}
