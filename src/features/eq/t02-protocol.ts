/**
 * WalkPlay T02-family (VID 0x3302) EQ protocol — REAL wire format, reverse-engineered
 * by capturing the official web app's HID writes live (see crates/walkplay-dac-protocol/CAPTURE.md).
 *
 * This device does NOT use the register protocol of the 0x0666 primary family. It wants
 * pre-computed biquad coefficients (RBJ cookbook) packed as Q30 int32. On any EQ change the
 * app re-sends the FULL 8-band program followed by a commit frame, all via HID report id 75.
 *
 * Frame (36 bytes), report id 75:
 *   01 09 18 00 <band:1> 00 00 | 20B = 5×int32 LE Q30 [b0,b1,b2,-a1,-a2] | freq:u16 | Q*256:u16 | gain*256:i16 | type:u8 | fd 6d
 * Commit (7 bytes), report id 75:
 *   01 0a 04 00 00 ff ff
 *
 * Validated byte-for-byte against captured frames at fs=96000 (peaking, low-shelf, high-shelf).
 */

import type { EqBand, EqBandType } from "@/lib/types";

export const T02_REPORT_ID = 75;
export const T02_SAMPLE_RATE = 96000;
export const T02_BAND_COUNT = 8;
const Q30 = 2 ** 30;

/** UI filter type -> device type byte. */
const TYPE_CODE: Record<EqBandType, number> = { LS: 1, PK: 2, HS: 3 };

/** RBJ biquad coefficients, returned as [b0, b1, b2, -a1, -a2] (normalized by a0). */
function biquad(type: EqBandType, freqHz: number, q: number, gainDb: number, fs: number): number[] {
  const w = (2 * Math.PI * freqHz) / fs;
  const cw = Math.cos(w);
  const sw = Math.sin(w);

  if (type === "PK") {
    const A = Math.pow(10, gainDb / 40);
    const alpha = sw / (2 * q);
    const a0 = 1 + alpha / A;
    return [
      (1 + alpha * A) / a0,
      (-2 * cw) / a0,
      (1 - alpha * A) / a0,
      (2 * cw) / a0, // -a1
      -(1 - alpha / A) / a0, // -a2
    ];
  }

  // Shelving filters (RBJ cookbook, Q-based slope).
  const A = Math.pow(10, gainDb / 40);
  const sq = Math.sqrt(A);
  const alpha = (sw / 2) * Math.sqrt((A + 1 / A) * (1 / q - 1) + 2);
  const twoSqA = 2 * sq * alpha;

  if (type === "LS") {
    const a0 = A + 1 + (A - 1) * cw + twoSqA;
    return [
      (A * (A + 1 - (A - 1) * cw + twoSqA)) / a0,
      (2 * A * (A - 1 - (A + 1) * cw)) / a0,
      (A * (A + 1 - (A - 1) * cw - twoSqA)) / a0,
      (2 * (A - 1 + (A + 1) * cw)) / a0, // -a1
      -(A + 1 + (A - 1) * cw - twoSqA) / a0, // -a2
    ];
  }
  // HS
  const a0 = A + 1 - (A - 1) * cw + twoSqA;
  return [
    (A * (A + 1 + (A - 1) * cw + twoSqA)) / a0,
    (-2 * A * (A - 1 + (A + 1) * cw)) / a0,
    (A * (A + 1 + (A - 1) * cw - twoSqA)) / a0,
    (-2 * (A - 1 - (A + 1) * cw)) / a0, // -a1
    -(A + 1 - (A - 1) * cw - twoSqA) / a0, // -a2
  ];
}

function pushI32LE(arr: number[], v: number): void {
  // round to nearest, wrap to int32
  const n = Math.round(v) | 0;
  arr.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff);
}

function pushU16LE(arr: number[], v: number): void {
  const n = v & 0xffff;
  arr.push(n & 0xff, (n >> 8) & 0xff);
}

/** Build one 36-byte band frame (without the report id). */
export function buildBandFrame(band: number, b: EqBand): number[] {
  const enabled = b.enabled !== false;
  const gain = enabled ? b.gain : 0; // disabled band = flat
  const type: EqBandType = b.type;
  const coeffs = enabled
    ? biquad(type, b.freq, b.q, gain, T02_SAMPLE_RATE)
    : [1, 0, 0, 0, 0]; // identity biquad

  const frame: number[] = [0x01, 0x09, 0x18, 0x00, band & 0xff, 0x00, 0x00];
  for (const c of coeffs) pushI32LE(frame, c * Q30);
  pushU16LE(frame, Math.round(b.freq)); // freq
  pushU16LE(frame, Math.round(b.q * 256)); // Q * 256
  pushU16LE(frame, Math.round(gain * 256) & 0xffff); // gain * 256 (i16)
  frame.push(TYPE_CODE[type] ?? 2); // type
  frame.push(0xfd, 0x6d); // constant trailer
  return frame;
}

/** The commit frame that tells the device to apply the program. */
export function commitFrame(): number[] {
  return [0x01, 0x0a, 0x04, 0x00, 0x00, 0xff, 0xff];
}

/**
 * Pre-amp / pre-gain frame. Captured from the official app: `01 03 02 00 <dB:i8>`
 * (report id 75), applied immediately with no commit. Range -16..6 dB.
 */
export function preampFrame(preampDb: number): number[] {
  return [0x01, 0x03, 0x02, 0x00, Math.round(preampDb) & 0xff];
}

/**
 * Build the full program (8 band frames + commit). Each entry is the raw bytes to
 * send via hid_send_raw(T02_REPORT_ID, bytes). Bands beyond the device's 8 are dropped;
 * missing bands are sent flat.
 */
export function buildProgram(bands: EqBand[]): number[][] {
  const frames: number[][] = [];
  for (let i = 0; i < T02_BAND_COUNT; i++) {
    const b = bands[i] ?? { id: i, freq: 1000, q: 1, gain: 0, type: "PK", enabled: false };
    frames.push(buildBandFrame(i, b));
  }
  frames.push(commitFrame());
  return frames;
}
