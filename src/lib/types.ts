/**
 * Shared type contracts. The device-facing shapes are mirrored by the Rust side
 * (see src-tauri/src/hid.rs).
 */

/**
 * Filter type of a single EQ band: PK=peaking, LS=low shelf, HS=high shelf,
 * LP=low pass, HP=high pass. The pass filters ignore the band's gain.
 */
export type EqBandType = "PK" | "LS" | "HS" | "LP" | "HP";

/**
 * The filter types the editor offers — the official app's list for this device.
 * High shelf is left out there too: a boosted high shelf rarely fits the
 * device's coefficient range. EQs saved earlier may still hold one.
 */
export const BAND_TYPES = ["PK", "LS", "HP", "LP"] as const satisfies readonly EqBandType[];

/** One parametric EQ band. */
export interface EqBand {
  /** Stable id, also the band index. */
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

/** Full EQ snapshot: the bands plus a global preamp. */
export interface EqState {
  bands: EqBand[];
  /** Global preamp / pre-gain in whole dB, range -16..6. */
  preamp: number;
}

/** Where a preset comes from; decides which switcher tab lists it. */
export type PresetSource = "preset" | "custom" | "online" | "shared";

/** A named, applyable EQ preset. */
export interface Preset extends EqState {
  id: string;
  name: string;
  source: PresetSource;
  /**
   * The number the official app knows this preset by, written to the device
   * with the EQ so that app shows the same preset as loaded. Only the vendor's
   * own presets have one.
   */
  tag?: number;
}

/** The connected device (mirrors Rust `DeviceInfo`). */
export interface DeviceInfo {
  vid: number;
  pid: number;
  name: string;
}

/**
 * Connection status. The backend reports "connected" / "disconnected";
 * "connecting" is the UI's own state while a connect request is in flight.
 */
export type ConnStatus = "disconnected" | "connecting" | "connected";

/**
 * The device's 8 bands in their factory layout (all peaking, Q 0.75, flat).
 * Taken from the official web app: its hard-coded factory program and its
 * "纯净 / PURE" preset for the T02.
 */
export const DEFAULT_BANDS: EqBand[] = [50, 200, 500, 1000, 2500, 5000, 10000, 15000].map(
  (freq, id) => ({ id, freq, q: 0.75, gain: 0, type: "PK", enabled: true }),
);

/**
 * Fit a band list to the device's 8 bands. Extra bands are dropped (the device
 * never played them) and missing ones are filled from the flat default.
 */
export function fitBands(bands: EqBand[]): EqBand[] {
  return DEFAULT_BANDS.map((flat, id) => (bands[id] ? { ...bands[id], id } : { ...flat }));
}

/**
 * What the editor lets the user set. The gain step is the finest one (dragging
 * a node); the faders and steppers move in 0.5 dB.
 */
export const EQ_LIMITS = {
  freq: { min: 20, max: 20000 },
  q: { min: 0.1, max: 10, step: 0.1 },
  gain: { min: -10, max: 10, step: 0.1 },
  preamp: { min: -16, max: 6, step: 1 },
} as const;

/** The microphone gain range the official app offers for this device, in dB. */
export const MIC_GAIN = { min: -15, max: 15 } as const;

/** The nearest preamp the device can hold: whole dB within range. */
export function snapPreamp(db: number): number {
  const { min, max, step } = EQ_LIMITS.preamp;
  const snapped = Math.round(db / step) * step;
  return Number.isFinite(snapped) ? Math.max(min, Math.min(max, snapped)) : 0;
}

/**
 * An independent deep copy of an EQ state (drops any extra preset fields).
 * The preamp is snapped on the way, so an EQ saved with a half-dB preamp is
 * shown at the value the device will actually get.
 */
export function cloneEq(eq: EqState): EqState {
  return { bands: eq.bands.map((b) => ({ ...b })), preamp: snapPreamp(eq.preamp) };
}
