/**
 * Built-in EQ presets (预设).
 *
 * OFFICIAL is the vendor's own preset list for the T02, copied verbatim from
 * the official web app (peq.szwalkplay.com, its `eq.preEqList` store, read on
 * 2026-11-11): 8 peaking bands each, preamp 0.
 */

import type { Language } from "@/i18n";
import type { EqBand, Preset } from "@/lib/types";

type Eight = readonly [number, number, number, number, number, number, number, number];

interface OfficialPreset {
  id: string;
  zh: string;
  en: string;
  freqs: Eight;
  qs: Eight;
  gains: Eight;
}

const Q_FLAT: Eight = [0.75, 0.75, 0.75, 0.75, 0.75, 0.75, 0.75, 0.75];
const Q_WIDE_ENDS: Eight = [0.65, 0.75, 0.75, 0.75, 0.75, 0.75, 0.75, 0.6];
const F_STANDARD: Eight = [50, 125, 250, 500, 1000, 2000, 4000, 10000];
const F_LOW: Eight = [31, 62, 125, 250, 500, 1000, 2000, 4000];

const OFFICIAL: readonly OfficialPreset[] = [
  {
    id: "builtin-flat",
    zh: "纯净",
    en: "Pure",
    freqs: [50, 200, 500, 1000, 2500, 5000, 10000, 15000],
    qs: Q_FLAT,
    gains: [0, 0, 0, 0, 0, 0, 0, 0],
  },
  { id: "builtin-pop", zh: "流行", en: "Pop", freqs: F_STANDARD, qs: Q_WIDE_ENDS, gains: [6, -3, -2, 5, 4, -4, -3, 8] },
  { id: "builtin-rock", zh: "摇滚", en: "Rock", freqs: F_STANDARD, qs: Q_WIDE_ENDS, gains: [6, 2, 1, -3, -4, 2, 1, 6] },
  { id: "builtin-vocal", zh: "人声", en: "Vocal", freqs: F_STANDARD, qs: Q_WIDE_ENDS, gains: [-6, 4, -3, 3, 4, 5, 4, -5] },
  { id: "builtin-bass", zh: "重低音", en: "Bass", freqs: F_LOW, qs: Q_FLAT, gains: [3, 3, 5, 3, 0, -1, -1, -1] },
  // The official English label for this one is "FLAT", which it is not.
  { id: "builtin-soft", zh: "柔和", en: "Soft", freqs: F_LOW, qs: Q_FLAT, gains: [-5, -5, -4, -4, 3, 2, 4, 4] },
  {
    id: "builtin-cinema",
    zh: "影院",
    en: "Cinema",
    freqs: [50, 125, 250, 500, 1000, 4000, 6000, 8000],
    qs: [0.65, 0.75, 0.6, 0.75, 0.75, 0.75, 0.12, 0.6],
    gains: [3, 4, 5, 2, 0, 4, 2, 4.8],
  },
  {
    id: "builtin-game",
    zh: "游戏",
    en: "Game",
    freqs: [50, 125, 250, 500, 1000, 4000, 6000, 10000],
    qs: [0.6, 0.75, 0.75, 0.75, 0.75, 0.75, 0.75, 0.75],
    gains: [-7, 5, 4, 3, 4, 4, 3.5, 4],
  },
];

function band(id: number, freq: number, q: number, gain: number, type: EqBand["type"]): EqBand {
  return { id, freq, q, gain, type, enabled: true };
}

const TUNINGS: readonly Preset[] = [
  {
    // Sony WH-1000XM5, AutoEQ Harman-target tuning — imported verbatim from the
    // official WalkPlay app's custom preset "WH1000XM5 AutoEQ哈曼曲线2025".
    id: "builtin-wh1000xm5-autoeq-harman-2025",
    name: "WH-1000XM5 AutoEQ 哈曼2025",
    preamp: -6,
    source: "preset",
    bands: [
      band(0, 105, 0.71, 6.1, "LS"),
      band(1, 220, 1.2, -7, "PK"),
      band(2, 1170, 2, 1.9, "PK"),
      band(3, 1800, 3, -1.9, "PK"),
      band(4, 2230, 1.4, 6.1, "PK"),
      band(5, 3200, 1.8, -1, "PK"),
      band(6, 6200, 3.3, -1.6, "PK"),
      band(7, 10000, 1.2, 3.8, "PK"),
    ],
  },
];

/** The built-in library. `name` holds the zh label; see {@link presetLabel}. */
export const BUILTIN_PRESETS: readonly Preset[] = [
  ...OFFICIAL.map((p, i) => ({
    id: p.id,
    name: p.zh,
    // The official app numbers its presets 1..8 in this order.
    tag: i + 1,
    bands: p.freqs.map((freq, i) => band(i, freq, p.qs[i], p.gains[i], "PK")),
    preamp: 0,
    source: "preset" as const,
  })),
  ...TUNINGS,
];

const EN_LABELS = new Map(OFFICIAL.map((p) => [p.id, p.en]));

/** A preset's display name in the given language (built-ins are bilingual). */
export function presetLabel(preset: Pick<Preset, "id" | "name">, lang: Language): string {
  return (lang === "en" && EN_LABELS.get(preset.id)) || preset.name;
}
