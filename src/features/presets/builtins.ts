/**
 * Built-in EQ presets (预设).
 *
 * Each preset is a full 10-band PEQ snapshot + preamp, matching the hardware
 * layout in src/lib/types.ts (band 0 = LS @60Hz, band 9 = HS @10kHz, the eight
 * in between = PK). Gains are clamped to the device range (-10..10 dB) and the
 * preamp to (-16..6 dB). Frequencies/Qs reuse DEFAULT_BANDS so every preset is a
 * drop-in replacement the device can accept band-for-band.
 *
 * `name` carries an i18n key (preset.builtin.*); the panel resolves it via t()
 * and falls back to the embedded zh label when the key is missing.
 */

import { DEFAULT_BANDS, type EqBand, type Preset } from "@/lib/types";

/** Per-band gain in dB, indexed 0..9 (low -> high). */
type GainCurve = readonly [
  number, number, number, number, number,
  number, number, number, number, number,
];

/** Build the 10 bands for a preset from a gain curve, keeping freq/q/type. */
function bands(curve: GainCurve): EqBand[] {
  return DEFAULT_BANDS.map((b, i) => ({ ...b, gain: curve[i] }));
}

/** A compact authoring shape; expanded into a full {@link Preset} below. */
interface BuiltinSpec {
  id: string;
  /** i18n key resolved by the panel. */
  i18nKey: string;
  /** zh fallback label used when the i18n key is absent. */
  label: string;
  preamp: number;
  curve: GainCurve;
}

const SPECS: readonly BuiltinSpec[] = [
  {
    id: "builtin-flat",
    i18nKey: "preset.builtin.flat",
    label: "默认",
    preamp: 0,
    curve: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: "builtin-pop",
    i18nKey: "preset.builtin.pop",
    label: "流行",
    preamp: -2,
    curve: [2, 3, 1, -1, -1, 0, 1, 2, 3, 2],
  },
  {
    id: "builtin-rock",
    i18nKey: "preset.builtin.rock",
    label: "摇滚",
    preamp: -3,
    curve: [4, 3, 1, -1, -2, -1, 1, 3, 4, 3],
  },
  {
    id: "builtin-classical",
    i18nKey: "preset.builtin.classical",
    label: "古典",
    preamp: -1,
    curve: [3, 2, 0, 0, 0, 0, -1, -2, 2, 3],
  },
  {
    id: "builtin-vocal",
    i18nKey: "preset.builtin.vocal",
    label: "人声",
    preamp: -2,
    curve: [-2, -1, 1, 2, 3, 3, 2, 1, -1, -2],
  },
  {
    id: "builtin-bass",
    i18nKey: "preset.builtin.bass",
    label: "重低音",
    preamp: -4,
    curve: [6, 5, 3, 1, 0, 0, 0, 0, 0, 0],
  },
  {
    id: "builtin-treble",
    i18nKey: "preset.builtin.treble",
    label: "高音增强",
    preamp: -3,
    curve: [0, 0, 0, 0, 0, 1, 2, 4, 5, 5],
  },
  {
    id: "builtin-jazz",
    i18nKey: "preset.builtin.jazz",
    label: "爵士",
    preamp: -1,
    curve: [3, 2, 1, 1, -1, -1, 0, 1, 2, 2],
  },
  {
    id: "builtin-electronic",
    i18nKey: "preset.builtin.electronic",
    label: "电子",
    preamp: -3,
    curve: [4, 3, 1, 0, -2, 1, 1, 2, 4, 4],
  },
  {
    id: "builtin-acoustic",
    i18nKey: "preset.builtin.acoustic",
    label: "原声",
    preamp: -1,
    curve: [2, 2, 1, 1, 1, 1, 2, 2, 2, 1],
  },
];

/**
 * The built-in preset library. Marked `source: "preset"` so the panel renders
 * the 预设 badge and never offers a delete/edit affordance for them.
 */
export const BUILTIN_PRESETS: readonly Preset[] = SPECS.map((s) => ({
  id: s.id,
  name: s.i18nKey,
  bands: bands(s.curve),
  preamp: s.preamp,
  source: "preset" as const,
}));

/** zh fallback labels keyed by i18n key, for when a translation is missing. */
export const BUILTIN_FALLBACK_LABELS: Readonly<Record<string, string>> =
  Object.fromEntries(SPECS.map((s) => [s.i18nKey, s.label]));
