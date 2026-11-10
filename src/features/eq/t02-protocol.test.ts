/**
 * Every expectation here comes from outside this codebase:
 *
 *  - `fixtures/web-reference.json` holds bytes produced by the official web
 *    app (its own filter classes, its factory-default program and reset, a
 *    program captured from it while driving a real T02) and a reply read from
 *    the T02 itself.
 *  - The last two tests check the wire format itself: what the frames decode
 *    to must be the filter the editor draws.
 */

import { describe, expect, it } from "vitest";
import { computeMagnitudeResponse, makeFreqAxis } from "@/features/curve/dsp";
import { BUILTIN_PRESETS } from "@/features/presets/builtins";
import {
  cloneEq,
  DEFAULT_BANDS,
  EQ_LIMITS,
  type EqBand,
  type EqBandType,
  type EqState,
} from "@/lib/types";
import { biquad, magnitudeDb, type Biquad } from "./biquad";
import ref from "./fixtures/web-reference.json";
import {
  buildBandFrame,
  buildFactoryReset,
  buildProgram,
  parseVersion,
  T02_SAMPLE_RATE,
} from "./t02-protocol";

const Q30 = 2 ** 30;
const FS = T02_SAMPLE_RATE;
const TYPE_BY_CODE: Record<number, EqBandType> = { 1: "LS", 2: "PK", 3: "HS", 4: "LP", 5: "HP" };

const hex = (bytes: number[]) => bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => (s.match(/../g) ?? []).map((b) => parseInt(b, 16));

function band(type: EqBandType, freq: number, q: number, gain: number, id = 0): EqBand {
  return { id, freq, q, gain, type, enabled: true };
}

/** An EQ in the official app's own shape (parallel arrays plus an offset). */
function fromWebEq(eq: { freqs: number[]; qs: number[]; gains: number[]; types: number[]; offset: number }): EqState {
  return {
    bands: eq.freqs.map((f, i) => band(TYPE_BY_CODE[eq.types[i]], f, eq.qs[i], eq.gains[i], i)),
    preamp: eq.offset,
  };
}

/** The five coefficients of a band frame, read the way the device reads them. */
function decodeCoefficients(frame: number[]): Biquad {
  const out: number[] = [];
  for (let o = 7; o < 27; o += 4) {
    out.push((frame[o] | (frame[o + 1] << 8) | (frame[o + 2] << 16) | (frame[o + 3] << 24)) / Q30);
  }
  return out as Biquad;
}

/** The response of a whole program as the device would play it. */
function deviceResponse(frames: number[][], freqs: Float64Array): Float64Array {
  const out = new Float64Array(freqs.length);
  for (const frame of frames) {
    if (frame[1] === 0x09) {
      const c = decodeCoefficients(frame);
      for (let i = 0; i < freqs.length; i++) out[i] += magnitudeDb(c, freqs[i], FS);
    } else if (frame[1] === 0x03) {
      const db = (frame[4] << 24) >> 24;
      for (let i = 0; i < freqs.length; i++) out[i] += db;
    }
  }
  return out;
}

/** Every value from `min` to `max` in `step`s, free of float drift. */
function steps({ min, max, step }: { min: number; max: number; step: number }): number[] {
  const out: number[] = [];
  for (let i = 0; min + i * step <= max + 1e-9; i++) out.push(Math.round((min + i * step) * 1000) / 1000);
  return out;
}

describe("against the official web app", () => {
  it("computes the same coefficient bytes as its four filter classes", () => {
    const cases = ref.coefficients.cases as [EqBandType, number, number, number, string][];
    const label = ([type, freq, q, gain]: (typeof cases)[number]) => `${type} ${freq}Hz q${q} ${gain}dB`;

    // b0 is positive for every one of these filters. Where the reference shows
    // a negative one, the official app's own int32 has wrapped; that is its
    // bug, not something to reproduce (the wire-format test below covers ours).
    const wrapped = cases.filter(([, , , , want]) => decodeCoefficients([...Array(7).fill(0), ...unhex(want)])[0] < 0);
    expect(wrapped.map(label)).toEqual(["PK 10000Hz q0.1 10dB", "PK 20000Hz q0.1 10dB"]);

    const different = cases
      .filter((c) => !wrapped.includes(c))
      .filter(([type, freq, q, gain, want]) => hex(buildBandFrame(0, band(type, freq, q, gain), 0, 0).slice(7, 27)) !== want)
      .map(label);
    expect({ count: different.length, first: different.slice(0, 5) }).toEqual({ count: 0, first: [] });
  });

  it("rebuilds its factory-default program byte for byte", () => {
    const { eq, tagId, bandFrames } = ref.defaultProgram;
    expect(buildProgram(fromWebEq(eq), tagId).slice(0, 8).map(hex)).toEqual(bandFrames);
  });

  it("sends its factory reset frame for frame", () => {
    expect(buildFactoryReset().map(hex)).toEqual(ref.factoryReset.frames);
  });

  it("rebuilds a program captured from it on a real T02", () => {
    const { eq, tagId, frames } = ref.capturedProgram;
    expect(buildProgram(fromWebEq(eq), tagId).slice(0, 9).map(hex)).toEqual(frames);
  });

  it("sends the preamp frames it was captured sending", () => {
    for (const [db, frame] of Object.entries(ref.capturedPreampFrames.frames)) {
      const program = buildProgram({ bands: [], preamp: Number(db) });
      expect(hex(program[program.length - 1])).toBe(frame);
    }
  });
});

describe("against a real T02", () => {
  it("reads the firmware version out of the device's reply", () => {
    const { reply, text } = ref.capturedReplies.version;
    expect(parseVersion(unhex(reply))).toBe(text);
  });
});

describe("the wire format", () => {
  it("holds every filter the editor can ask for, unwrapped and stable", () => {
    // Includes high shelf: the editor no longer offers it, but saved EQs may.
    const types: EqBandType[] = ["PK", "LS", "HS", "LP", "HP"];
    const freqs: number[] = [EQ_LIMITS.freq.min, EQ_LIMITS.freq.max];
    for (let f = EQ_LIMITS.freq.min; f < EQ_LIMITS.freq.max; f *= 1.12) freqs.push(Math.round(f));
    const qs = steps(EQ_LIMITS.q);
    const gains = steps({ ...EQ_LIMITS.gain, step: 0.5 });

    const broken: string[] = [];
    for (const type of types) {
      let worst = "";
      let count = 0;
      for (const freq of freqs) {
        for (const q of qs) {
          for (const gain of gains) {
            const b = band(type, freq, q, gain);
            const sent = decodeCoefficients(buildBandFrame(0, b, 0, 0));
            const meant = biquad(type, freq, q, gain, FS);
            // An int32 that wrapped is off by 4.0; honest rounding by 2^-31.
            const intact = sent.every((c, i) => Math.abs(c - meant[i]) <= 1 / Q30);
            const [a1, a2] = [-sent[3], -sent[4]];
            const stable = Math.abs(a2) < 1 && Math.abs(a1) < 1 + a2;
            if (!intact || !stable) {
              count++;
              worst ||= `${freq}Hz q${q} ${gain}dB`;
            }
          }
        }
      }
      if (count) broken.push(`${type}: ${count} settings, first ${worst}`);
    }
    expect(broken).toEqual([]);
  });

  it("carries exactly the curve the editor draws", () => {
    const freqs = makeFreqAxis(300);
    const flat: EqState = { bands: DEFAULT_BANDS, preamp: 0 };
    const allBands = (gain: number): EqState => ({ bands: DEFAULT_BANDS.map((b) => ({ ...b, gain })), preamp: 0 });

    const states: [string, EqState][] = [
      ["default", flat],
      ["every band at full boost", allBands(EQ_LIMITS.gain.max)],
      ["every band at full cut", allBands(EQ_LIMITS.gain.min)],
      ...BUILTIN_PRESETS.map((p): [string, EqState] => [`preset ${p.id}`, p]),
      ...steps(EQ_LIMITS.preamp).map((p): [string, EqState] => [`preamp ${p}dB`, { ...flat, preamp: p }]),
    ];

    const off: string[] = [];
    for (const [name, state] of states) {
      const eq = cloneEq(state); // every EQ enters the store through cloneEq
      const drawn = computeMagnitudeResponse(eq, freqs);
      const played = deviceResponse(buildProgram(eq), freqs);
      let worst = 0;
      for (let i = 0; i < freqs.length; i++) worst = Math.max(worst, Math.abs(drawn[i] - played[i]));
      if (!(worst < 0.05)) off.push(`${name}: off by ${worst.toFixed(2)} dB`);
    }
    expect(off).toEqual([]);
  });
});
