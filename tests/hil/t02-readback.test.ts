/**
 * Hardware-in-the-loop checks against a real T02 (VID 3302 / PID 12CB). The
 * device itself is the oracle, so these are skipped unless WALKPLAY_HIL is set:
 *
 *   read    only asks the device questions — nothing audible changes
 *   write   also writes a program and a microphone gain and reads them back.
 *           Afterwards the device gets the program the app last applied (from
 *           the app's state file; flat at -1 dB if the app has never run) and
 *           its previous microphone gain
 *   save    writes a marker EQ and tells the device to keep it. Then unplug the
 *           device, plug it back in, and run:
 *   saved   checks the marker EQ survived the power cycle. Open the app and
 *           apply a preset afterwards to put a real EQ back
 *
 * PowerShell:  $env:WALKPLAY_HIL = "read"; npx vitest run tests/hil
 *
 * The read queries are the ones the official app sends on connect.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import HID from "node-hid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildProgram,
  micGainFrame,
  parseMicGain,
  parseVersion,
  READ_MIC_GAIN,
  READ_VERSION,
  SAVE_TO_FLASH,
  T02_REPORT_ID,
} from "../../src/features/eq/t02-protocol";
import { EQ_LIMITS, type EqState } from "../../src/lib/types";

const MODE = process.env.WALKPLAY_HIL;

const READ_BAND_0 = [0x80, 0x09, 0x00];
const READ_PREAMP = [0x80, 0x03, 0x02, 0x00, 0x00];

/** Where the app keeps the program it replays on connect. */
const APP_STATE = join(process.env.APPDATA ?? "", "com.akira.walkplay-eq", "state.json");

/**
 * Flat (0 dB everywhere) with an unmistakable band 0 and tag, so the frames
 * are recognisable without the EQ being audible beyond the -1 dB preamp.
 */
const MARKER_TAG = 77;
const MARKER: EqState = {
  bands: [123, 200, 500, 1000, 2500, 5000, 10000, 15000].map((freq, id) => ({
    id,
    freq,
    q: id === 0 ? 1.23 : 0.75,
    gain: 0,
    type: "PK" as const,
    enabled: true,
  })),
  preamp: -1,
};

const u16 = (b: number[], o: number) => b[o] | (b[o + 1] << 8);
const i8 = (v: number) => (v << 24) >> 24;
const i16 = (b: number[], o: number) => (u16(b, o) << 16) >> 16;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!MODE)("a real T02", () => {
  let dev: HID.HID;

  beforeAll(() => {
    const info = HID.devices().find((d) => d.vendorId === 0x3302 && d.productId === 0x12cb);
    if (!info?.path) throw new Error("no T02 attached");
    dev = new HID.HID(info.path);
  });

  afterAll(async () => {
    if (MODE === "write" && existsSync(APP_STATE)) {
      const { program } = JSON.parse(readFileSync(APP_STATE, "utf8"));
      for (const frame of program?.frames ?? []) dev.write([program.reportId, ...frame]);
      await pause(100);
    }
    dev?.close();
  });

  const send = (frames: number[][]) => frames.forEach((frame) => dev.write([T02_REPORT_ID, ...frame]));

  /** Send a read query and return the reply without its report id. */
  function ask(query: number[]): number[] {
    while (dev.readTimeout(1).length) {
      // drop replies left over from anything else talking to the device
    }
    dev.write([T02_REPORT_ID, ...query]);
    for (let i = 0; i < 8; i++) {
      const reply = dev.readTimeout(500);
      if (reply.length && reply[0] === T02_REPORT_ID && reply[2] === query[1]) return reply.slice(1);
    }
    throw new Error("no reply to " + query.map((b) => b.toString(16)).join(" "));
  }

  /** What the device holds for band 0, from the band index on, and its preamp. */
  const held = () => ({ band0: ask(READ_BAND_0).slice(4, 36), preamp: i8(ask(READ_PREAMP)[4]) });
  const marker = () => {
    const program = buildProgram(MARKER, MARKER_TAG);
    return { program, expected: { band0: program[0].slice(4), preamp: MARKER.preamp } };
  };

  it("reports its firmware version", () => {
    expect(parseVersion(ask(READ_VERSION))).toMatch(/^\d\.\d$/);
  });

  it("hands band 0 back in the layout the protocol module writes", () => {
    const band = ask(READ_BAND_0);
    expect(band[4]).toBe(0); // band index
    expect(u16(band, 27)).toBeGreaterThanOrEqual(EQ_LIMITS.freq.min);
    expect(u16(band, 27)).toBeLessThanOrEqual(EQ_LIMITS.freq.max);
    expect(u16(band, 29) / 256).toBeGreaterThanOrEqual(EQ_LIMITS.q.min - 0.01);
    expect(u16(band, 29) / 256).toBeLessThanOrEqual(EQ_LIMITS.q.max);
    expect(Math.abs(i16(band, 31) / 256)).toBeLessThanOrEqual(EQ_LIMITS.gain.max);
    expect([1, 2, 3, 4, 5]).toContain(band[33]); // LS PK HS LP HP
  });

  it("reports a preamp inside the range the editor allows", () => {
    const db = i8(ask(READ_PREAMP)[4]);
    expect(db).toBeGreaterThanOrEqual(EQ_LIMITS.preamp.min);
    expect(db).toBeLessThanOrEqual(EQ_LIMITS.preamp.max);
  });

  it.skipIf(MODE !== "write")("stores a program and hands band 0, its tag and the preamp back unchanged", async () => {
    const { program, expected } = marker();
    send(program);
    await pause(200);
    expect(held()).toEqual(expected);
  });

  it.skipIf(MODE !== "write")("takes a microphone gain and hands it back, sign included", async () => {
    const before = parseMicGain(ask(READ_MIC_GAIN))!;
    try {
      for (const db of [before === 4 ? 5 : 4, -6]) {
        send([micGainFrame(db)]);
        await pause(200);
        expect(parseMicGain(ask(READ_MIC_GAIN))).toBe(db);
      }
    } finally {
      send([micGainFrame(before)]);
      await pause(200);
    }
  });

  it.skipIf(MODE !== "save")("is told to keep a marker EQ (now unplug it, plug it back in, run `saved`)", async () => {
    const { program, expected } = marker();
    send(program);
    await pause(1000);
    send([SAVE_TO_FLASH]);
    await pause(1000);
    expect(held()).toEqual(expected);
  });

  it.skipIf(MODE !== "saved")("still holds the marker EQ after a power cycle", () => {
    expect(held()).toEqual(marker().expected);
  });
});
