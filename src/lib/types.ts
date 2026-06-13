/**
 * SHARED TYPE CONTRACTS — the cross-agent interface.
 *
 * These shapes are mirrored 1:1 by the Rust side (see src-tauri/src/hid.rs).
 * Do NOT rename fields without coordinating with the HID-CORE / PROTOCOL agents.
 */

/** Filter type of a single EQ band. PK=peaking, LS=low shelf, HS=high shelf. */
export type EqBandType = "PK" | "LS" | "HS";

/** One parametric EQ band. */
export interface EqBand {
  /** Stable id, also the band index 0..9. */
  id: number;
  /** Center / corner frequency in Hz. */
  freq: number;
  /** Q factor. */
  q: number;
  /** Gain in dB, range -10..10. */
  gain: number;
  /** Filter type. */
  type: EqBandType;
  /** Whether this band is active. */
  enabled: boolean;
}

/** Full EQ snapshot: the 10 bands plus a global preamp. */
export interface EqState {
  bands: EqBand[];
  /** Global preamp / pre-gain in dB, range -16..6. */
  preamp: number;
}

/** Source of a preset, drives badge/sort in the preset panel. */
export type PresetSource = "preset" | "custom" | "online" | "shared";

/** A named, applyable EQ preset. */
export interface Preset {
  id: string;
  name: string;
  bands: EqBand[];
  preamp: number;
  source: PresetSource;
}

/** A connected/known device. */
export interface DeviceInfo {
  vid: number;
  pid: number;
  name: string;
  connected: boolean;
  firmware?: string;
}

/** Connection lifecycle status (mirrors Rust `ConnStatus`). */
export type ConnStatus = "disconnected" | "connecting" | "connected" | "busy";

/** Primary device identifiers. */
export const PRIMARY_VID = 0x0666;
export const PRIMARY_PID = 0x0888;

/**
 * Compatible vendor whitelist (mirrors Rust VID_WHITELIST).
 * 0x0D8C = C-Media.
 */
export const VID_WHITELIST: readonly number[] = [
  0x3302, 0x0762, 0x35d8, 0x2fc6, 0x0104, 0xb44d, 0x0661, 0x0666, 0x0d8c, 0x0663, 0x0c3c,
];

/** Serial (CDC) fallback devices: [vid, pid]. */
export const SERIAL_DEVICES: readonly [number, number][] = [
  [0x31b2, 0xfff8],
  [0x8888, 0xcdc0],
];

/**
 * The 10 default PEQ bands.
 *
 * Researched live frequencies: 105, 220, 1170, 1800, 2230, 3200, 6200, 10000.
 * Filled to 10 with two sensible log-spaced bands (60, 500). Band 0 is a low
 * shelf, band 9 a high shelf, the rest peaking — matching the hardware layout.
 */
export const DEFAULT_BANDS: EqBand[] = [
  { id: 0, freq: 60, q: 0.7, gain: 0, type: "LS", enabled: true },
  { id: 1, freq: 105, q: 1.0, gain: 0, type: "PK", enabled: true },
  { id: 2, freq: 220, q: 1.0, gain: 0, type: "PK", enabled: true },
  { id: 3, freq: 500, q: 1.0, gain: 0, type: "PK", enabled: true },
  { id: 4, freq: 1170, q: 1.0, gain: 0, type: "PK", enabled: true },
  { id: 5, freq: 1800, q: 1.0, gain: 0, type: "PK", enabled: true },
  { id: 6, freq: 2230, q: 1.0, gain: 0, type: "PK", enabled: true },
  { id: 7, freq: 3200, q: 1.0, gain: 0, type: "PK", enabled: true },
  { id: 8, freq: 6200, q: 1.0, gain: 0, type: "PK", enabled: true },
  { id: 9, freq: 10000, q: 0.7, gain: 0, type: "HS", enabled: true },
];

/** A fresh, flat EQ state using the default bands. */
export const DEFAULT_EQ_STATE: EqState = {
  bands: DEFAULT_BANDS.map((b) => ({ ...b })),
  preamp: 0,
};
