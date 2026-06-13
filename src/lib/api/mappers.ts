/**
 * Map between the local UI EQ model (`Preset` / `EqState`) and the cloud API EQ
 * graph (`ApiEqGraph`, with parallel `freqs/qs/gains/filterTypes` arrays + a
 * global `offset`).
 *
 * Filter-type code mapping (confirmed enum `{PK:0,LP:1,HP:2,LS:3,HS:4}` from the
 * bundle). The local UI only models PK/LS/HS; LP/HP from the cloud are coerced
 * to the nearest supported type (LP→LS, HP→HS) on the way in.
 */

import { API_FILTER_TYPE } from "./types";
import type { ApiEqGraph, EqShareItem } from "./types";
import type { EqBand, EqBandType, EqState, Preset, PresetSource } from "../types";

/** Local band type -> numeric API filter-type code. */
export function bandTypeToCode(t: EqBandType): number {
  switch (t) {
    case "PK":
      return API_FILTER_TYPE.PK;
    case "LS":
      return API_FILTER_TYPE.LS;
    case "HS":
      return API_FILTER_TYPE.HS;
    default:
      return API_FILTER_TYPE.PK;
  }
}

/** Numeric API filter-type code -> local band type (LP/HP coerced to LS/HS). */
export function codeToBandType(code: number): EqBandType {
  switch (code) {
    case API_FILTER_TYPE.PK:
      return "PK";
    case API_FILTER_TYPE.LS:
    case API_FILTER_TYPE.LP: // low-pass coerced to low-shelf
      return "LS";
    case API_FILTER_TYPE.HS:
    case API_FILTER_TYPE.HP: // high-pass coerced to high-shelf
      return "HS";
    default:
      return "PK";
  }
}

/** Convert a local EqState into the cloud graph shape. */
export function eqStateToApiGraph(eq: EqState, name = ""): ApiEqGraph {
  return {
    eqName: name,
    freqs: eq.bands.map((b) => b.freq),
    qs: eq.bands.map((b) => b.q),
    gains: eq.bands.map((b) => b.gain),
    filterTypes: eq.bands.map((b) => bandTypeToCode(b.type)),
    offset: eq.preamp,
  };
}

/** Convert a local Preset into the cloud graph shape. */
export function presetToApiGraph(preset: Preset): ApiEqGraph {
  return eqStateToApiGraph({ bands: preset.bands, preamp: preset.preamp }, preset.name);
}

/**
 * Build local EqBands from a (partial) cloud graph. Tolerant of mismatched /
 * missing arrays: missing values fall back to flat/peaking defaults, and the
 * band count is the max length across the provided arrays.
 */
export function apiGraphToBands(g: Partial<ApiEqGraph>): EqBand[] {
  const freqs = g.freqs ?? [];
  const qs = g.qs ?? [];
  const gains = g.gains ?? [];
  const types = g.filterTypes ?? [];
  const n = Math.max(freqs.length, qs.length, gains.length, types.length);
  const bands: EqBand[] = [];
  for (let i = 0; i < n; i++) {
    bands.push({
      id: i,
      freq: typeof freqs[i] === "number" ? freqs[i] : 1000,
      q: typeof qs[i] === "number" ? qs[i] : 0.7,
      gain: typeof gains[i] === "number" ? gains[i] : 0,
      type: codeToBandType(typeof types[i] === "number" ? types[i] : API_FILTER_TYPE.PK),
      enabled: true,
    });
  }
  return bands;
}

/** Convert a (partial) cloud graph into a local EqState. */
export function apiGraphToEqState(g: Partial<ApiEqGraph>): EqState {
  return {
    bands: apiGraphToBands(g),
    preamp: typeof g.offset === "number" ? g.offset : 0,
  };
}

/**
 * Convert a cloud share/online list item into a local Preset. The numeric `id`
 * is stringified to match the local `Preset.id: string` contract.
 */
export function eqShareItemToPreset(
  item: EqShareItem,
  source: PresetSource = "online",
): Preset {
  const name = item.name ?? item.eqName ?? item.eqNameEn ?? item.eqNameCn ?? `EQ ${item.id}`;
  const state = apiGraphToEqState(item);
  return {
    id: String(item.id),
    name,
    bands: state.bands,
    preamp: state.preamp,
    source,
  };
}
