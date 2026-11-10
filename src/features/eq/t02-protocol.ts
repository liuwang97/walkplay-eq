/**
 * WalkPlay T02-family (VID 0x3302) EQ protocol — the real wire format, captured
 * from the official web app's HID writes (see crates/walkplay-dac-protocol/CAPTURE.md).
 *
 * The device takes pre-computed biquad coefficients packed as Q30 int32. On any
 * EQ change the whole program is re-sent on HID report id 75:
 *
 *   Band frame (36 bytes), one per band:
 *     01 09 18 00 <band:1> 00 00 | 5×int32 LE Q30 [b0,b1,b2,-a1,-a2] | freq:u16 | Q*256:u16 | gain*256:i16 | type:u8 | preamp dB:i8 | tag:u8
 *   Commit (7 bytes), applies the bands:
 *     01 0a 04 00 00 ff ff
 *   Pre-amp (5 bytes), applied immediately, whole dB, range -16..6:
 *     01 03 02 00 <dB:i8>
 *
 * Everything after the coefficients in a band frame is bookkeeping: the device
 * plays the coefficients and stores the rest, handing it back when asked
 * (`80 09 00` returns band 0). The official app uses it to show which EQ is
 * loaded.
 *
 * A program lives in the device's RAM until `01 01 00` tells it to keep the
 * EQ across power loss. A query is the command with the top bit set
 * (`80 0c` asks for the firmware version) and is answered on the same report.
 *
 * Frames match the official app's byte for byte; the reference bytes are in
 * fixtures/web-reference.json.
 */

import { DEFAULT_BANDS, type EqBand, type EqState } from "@/lib/types";
import { bandBiquad } from "./biquad";

export const T02_REPORT_ID = 75;
export const T02_SAMPLE_RATE = 96000;
export const T02_BAND_COUNT = 8;
const Q30 = 2 ** 30;

/**
 * The tag written into every band frame names the preset the EQ came from. In
 * the official app 1–99 are the vendor's presets and 100 up the user's cloud
 * presets. This app's presets are neither, so its programs go out untagged,
 * which the official app reads as "no known preset".
 */
export const UNTAGGED = 0;

/** UI filter type -> device type byte. */
const TYPE_CODE = { LS: 1, PK: 2, HS: 3, LP: 4, HP: 5 } as const;

/** A flat, disabled band for slots the EQ does not fill. */
const EMPTY_BAND: EqBand = { id: 0, freq: 1000, q: 1, gain: 0, type: "PK", enabled: false };

function pushI32LE(arr: number[], v: number): void {
  const n = Math.round(v) | 0;
  arr.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff);
}

function pushU16LE(arr: number[], v: number): void {
  arr.push(v & 0xff, (v >> 8) & 0xff);
}

/**
 * One 36-byte band frame (without the report id). `preampDb` and `tagId`
 * describe the EQ the band belongs to and are the same in all its frames.
 */
export function buildBandFrame(
  index: number,
  band: EqBand,
  preampDb: number,
  tagId: number,
): number[] {
  const gain = band.enabled ? band.gain : 0; // a disabled band is reported flat
  const frame: number[] = [0x01, 0x09, 0x18, 0x00, index & 0xff, 0x00, 0x00];
  for (const c of bandBiquad(band, T02_SAMPLE_RATE)) pushI32LE(frame, c * Q30);
  pushU16LE(frame, Math.round(band.freq));
  pushU16LE(frame, Math.round(band.q * 256));
  pushU16LE(frame, Math.round(gain * 256));
  frame.push(TYPE_CODE[band.type] ?? TYPE_CODE.PK, Math.round(preampDb) & 0xff, tagId & 0xff);
  return frame;
}

/**
 * The full program for an EQ state: 8 band frames, the commit, then the
 * pre-amp. Bands beyond the device's 8 are dropped; missing ones are sent flat.
 */
export function buildProgram(eq: EqState, tagId: number = UNTAGGED): number[][] {
  const preamp = Math.round(eq.preamp);
  const frames: number[][] = [];
  for (let i = 0; i < T02_BAND_COUNT; i++) {
    frames.push(buildBandFrame(i, eq.bands[i] ?? EMPTY_BAND, preamp, tagId));
  }
  frames.push([0x01, 0x0a, 0x04, 0x00, 0x00, 0xff, 0xff]);
  frames.push([0x01, 0x03, 0x02, 0x00, preamp & 0xff]);
  return frames;
}

/** Makes the device keep the EQ it is playing across power loss. */
export const SAVE_TO_FLASH: number[] = [0x01, 0x01, 0x00];

/** The tag of the vendor's flat preset, which a factory reset leaves loaded. */
const FACTORY_TAG = 1;

/**
 * Everything the official app's "restore factory settings" sends: preamp 0,
 * the flat factory bands, commit, save, then five housekeeping frames. Sent
 * once — it must not be replayed on reconnect, or every plug-in would rewrite
 * the flash.
 */
export function buildFactoryReset(): number[][] {
  const program = buildProgram({ bands: DEFAULT_BANDS, preamp: 0 }, FACTORY_TAG);
  const preamp = program[program.length - 1];
  return [
    preamp,
    ...program.slice(0, -1),
    SAVE_TO_FLASH,
    [0x01, 0x05, 0x01],
    [0x01, 0x05, 0x02],
    [0x01, 0x05, 0x03],
    [0x01, 0x05, 0x04],
    [0x01, 0x17, 0x00],
  ];
}

/** Asks for the microphone gain. */
export const READ_MIC_GAIN: number[] = [0x80, 0x02, 0x00];

/** The microphone gain in dB in a reply to {@link READ_MIC_GAIN}. */
export function parseMicGain(reply: number[]): number | null {
  return reply[1] === READ_MIC_GAIN[1] ? (reply[4] << 24) >> 24 : null;
}

/**
 * Sets the microphone gain in whole dB. It takes effect at once;
 * {@link SAVE_TO_FLASH} makes the device keep it.
 */
export function micGainFrame(db: number): number[] {
  return [0x01, 0x02, 0x02, 0x80, Math.round(db) & 0xff];
}

/** Asks for the firmware version. */
export const READ_VERSION: number[] = [0x80, 0x0c];

/** The firmware version in a reply to {@link READ_VERSION}, e.g. "0.1". */
export function parseVersion(reply: number[]): string | null {
  if (reply[1] !== READ_VERSION[1]) return null;
  const text = String.fromCharCode(...reply.slice(3, 6).filter((c) => c > 0));
  return text || null;
}
