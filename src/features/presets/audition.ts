/**
 * Local audition (试听) engine.
 *
 * The device itself can't stream a demo, so audition is a UI-side preview: we
 * synthesize a short looping music bed (a lo-fi pad + bass + arpeggio + soft
 * hats, covering low/mid/high so every EQ band is audible) entirely in the
 * WebAudio graph — no bundled audio files — and run it through a BiquadFilter
 * chain that mirrors the preset's 10 PEQ bands + preamp. This lets the user
 * hear the *shape* of a preset on actual music before committing it to the
 * hardware with 使用. It never touches the HID layer.
 *
 * Several chord progressions are generated and rotated so consecutive auditions
 * don't always play the same loop. A single shared engine instance is used so
 * starting a new audition stops the previous one (only one preview plays).
 */

import type { EqBand, EqBandType, Preset } from "@/lib/types";

/** Map an EQ band type to the WebAudio BiquadFilter type. */
function biquadType(t: EqBandType): BiquadFilterType {
  switch (t) {
    case "LS":
      return "lowshelf";
    case "HS":
      return "highshelf";
    case "PK":
    default:
      return "peaking";
  }
}

// ---------------------------------------------------------------------------
// Music-loop synthesis (no audio files — rendered offline into an AudioBuffer)
// ---------------------------------------------------------------------------

/** MIDI note number -> frequency in Hz (A4 = 69 = 440 Hz). */
function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** One bar: a bass root (MIDI) + the chord voicing (MIDI notes). */
interface Bar {
  bass: number;
  chord: number[];
}
/** A loopable song: tempo + a sequence of bars (4 beats each). */
interface Song {
  bpm: number;
  bars: Bar[];
}

/**
 * A handful of mellow progressions in different keys/moods. play() rotates
 * through these so back-to-back auditions aren't the identical loop.
 */
const SONGS: Song[] = [
  // Lo-fi C major: Cmaj7 – Am7 – Fmaj7 – G7
  {
    bpm: 76,
    bars: [
      { bass: 36, chord: [60, 64, 67, 71] },
      { bass: 33, chord: [57, 60, 64, 67] },
      { bass: 41, chord: [53, 57, 60, 64] },
      { bass: 43, chord: [55, 59, 62, 65] },
    ],
  },
  // Warm A minor: Am7 – Fmaj7 – Cmaj7 – G7
  {
    bpm: 70,
    bars: [
      { bass: 33, chord: [57, 60, 64, 67] },
      { bass: 41, chord: [53, 57, 60, 64] },
      { bass: 36, chord: [60, 64, 67, 71] },
      { bass: 43, chord: [55, 59, 62, 65] },
    ],
  },
  // Jazzy ii–V–I in C: Dm7 – G7 – Cmaj7 – Cmaj7
  {
    bpm: 84,
    bars: [
      { bass: 38, chord: [62, 65, 69, 72] },
      { bass: 43, chord: [55, 59, 62, 65] },
      { bass: 36, chord: [60, 64, 67, 71] },
      { bass: 36, chord: [60, 64, 67, 71] },
    ],
  },
];

interface NoteOpts {
  start: number; // seconds
  dur: number; // seconds (sustain length, before release)
  freq: number; // Hz
  gain: number;
  harmonics: number[]; // amplitude per harmonic (index 0 = fundamental)
  attack: number;
  decay: number;
  sustain: number; // 0..1 level after decay
  release: number;
}

/**
 * Render one ADSR-enveloped harmonic tone additively into `data`. Writes wrap
 * around the buffer end (modulo length) so note tails spill into the next loop
 * iteration — which makes every loop seamless without click/gap at the seam.
 */
function addNote(data: Float32Array, sr: number, o: NoteOpts): void {
  const N = data.length;
  const startI = Math.floor(o.start * sr);
  const atk = Math.max(1, o.attack * sr);
  const dec = Math.max(1, o.decay * sr);
  const noteEnd = Math.max(atk + dec, o.dur * sr);
  const rel = Math.max(1, o.release * sr);
  const total = Math.floor(noteEnd + rel);
  const w = (2 * Math.PI * o.freq) / sr;
  for (let n = 0; n < total; n++) {
    let env: number;
    if (n < atk) env = n / atk;
    else if (n < atk + dec) env = 1 - (1 - o.sustain) * ((n - atk) / dec);
    else if (n < noteEnd) env = o.sustain;
    else env = o.sustain * (1 - (n - noteEnd) / rel);
    if (env <= 0) {
      if (n >= atk + dec) break; // pluck (sustain 0) — nothing left to render
      continue;
    }
    let s = 0;
    for (let h = 0; h < o.harmonics.length; h++) {
      s += o.harmonics[h] * Math.sin(w * (h + 1) * n);
    }
    data[(startI + n) % N] += s * o.gain * env;
  }
}

/** A short high-passed noise burst — a soft hi-hat tick for treble content. */
function addHat(data: Float32Array, sr: number, start: number, dur: number, gain: number): void {
  const N = data.length;
  const startI = Math.floor(start * sr);
  const total = Math.floor(dur * sr);
  let last = 0;
  for (let n = 0; n < total; n++) {
    const env = (1 - n / total) ** 2;
    const white = Math.random() * 2 - 1;
    const hp = white - last; // crude 1st-order high-pass -> treble-weighted
    last = white;
    data[(startI + n) % N] += hp * gain * env;
  }
}

/** Render a {@link Song} to a seamlessly-looping mono AudioBuffer. */
function makeMusicBuffer(ctx: AudioContext, song: Song): AudioBuffer {
  const sr = ctx.sampleRate;
  const beat = 60 / song.bpm;
  const barDur = beat * 4;
  const total = barDur * song.bars.length;
  const length = Math.floor(sr * total);
  const buffer = ctx.createBuffer(1, length, sr);
  const data = buffer.getChannelData(0);

  song.bars.forEach((bar, bi) => {
    const t0 = bi * barDur;

    // Sustained pad chord.
    for (const m of bar.chord) {
      addNote(data, sr, {
        start: t0, dur: barDur * 0.92, freq: midiToFreq(m),
        gain: 0.045, harmonics: [1, 0.28, 0.1],
        attack: 0.18, decay: 0.3, sustain: 0.7, release: 0.5,
      });
    }

    // Bass plucks on beats 1 and 3.
    for (const bt of [0, 2]) {
      addNote(data, sr, {
        start: t0 + bt * beat, dur: beat * 0.9, freq: midiToFreq(bar.bass),
        gain: 0.22, harmonics: [1, 0.5, 0.22, 0.1],
        attack: 0.006, decay: beat * 0.8, sustain: 0, release: 0.08,
      });
    }

    // Eighth-note arpeggio an octave above the chord (mid/high sparkle).
    const arp = [0, 1, 2, 3, 2, 1, 2, 3];
    arp.forEach((ci, k) => {
      addNote(data, sr, {
        start: t0 + k * (beat / 2), dur: beat * 0.35, freq: midiToFreq(bar.chord[ci] + 12),
        gain: 0.05, harmonics: [1, 0.2],
        attack: 0.005, decay: beat * 0.3, sustain: 0, release: 0.1,
      });
    });

    // Soft hats on the offbeats.
    for (let k = 1; k < 8; k += 2) {
      addHat(data, sr, t0 + k * (beat / 2), 0.035, 0.03);
    }
  });

  // Normalize to a safe peak.
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const a = Math.abs(data[i]);
    if (a > peak) peak = a;
  }
  if (peak > 1e-4) {
    const g = 0.85 / peak;
    for (let i = 0; i < length; i++) data[i] *= g;
  }
  return buffer;
}

class AuditionEngine {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  /** Lazily-rendered loop per song index (rotated through SONGS). */
  private buffers: (AudioBuffer | null)[] = SONGS.map(() => null);
  private songIndex = 0;
  private listeners = new Set<(id: string | null) => void>();
  private playingId: string | null = null;

  /** Subscribe to "which preset is auditioning" changes. Returns unsubscribe. */
  subscribe(fn: (id: string | null) => void): () => void {
    this.listeners.add(fn);
    fn(this.playingId);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.playingId);
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctor();
    }
    return this.ctx;
  }

  /** Build a preamp + per-band biquad chain into ctx.destination. */
  private buildChain(ctx: AudioContext, bands: EqBand[], preamp: number): AudioNode {
    const input = ctx.createGain();
    // Preamp in dB -> linear gain.
    input.gain.value = Math.pow(10, preamp / 20);

    let node: AudioNode = input;
    for (const band of bands) {
      if (!band.enabled || band.gain === 0) continue;
      const f = ctx.createBiquadFilter();
      f.type = biquadType(band.type);
      f.frequency.value = band.freq;
      f.Q.value = band.q;
      f.gain.value = band.gain;
      node.connect(f);
      node = f;
    }
    node.connect(ctx.destination);
    return input;
  }

  /** Start auditioning a preset. Stops any current audition first. */
  async play(preset: Preset): Promise<void> {
    this.stop();
    const ctx = this.ensureCtx();
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        /* ignore: user-gesture requirement may still allow next attempt */
      }
    }
    // Rotate to the next song so back-to-back auditions vary; render once.
    const idx = this.songIndex % SONGS.length;
    this.songIndex++;
    if (!this.buffers[idx]) this.buffers[idx] = makeMusicBuffer(ctx, SONGS[idx]);

    const src = ctx.createBufferSource();
    src.buffer = this.buffers[idx];
    src.loop = true;
    const chainInput = this.buildChain(ctx, preset.bands, preset.preamp);
    src.connect(chainInput);
    src.start();

    this.source = src;
    this.playingId = preset.id;
    this.emit();
  }

  /** Stop the current audition (if any). */
  stop(): void {
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
    if (this.playingId !== null) {
      this.playingId = null;
      this.emit();
    }
  }

  /** Toggle audition for a preset: play if not active, stop if active. */
  async toggle(preset: Preset): Promise<void> {
    if (this.playingId === preset.id) {
      this.stop();
    } else {
      await this.play(preset);
    }
  }

  /** The id of the preset currently auditioning, or null. */
  get currentId(): string | null {
    return this.playingId;
  }
}

/** Process-wide singleton; only one preview plays at a time. */
export const auditionEngine = new AuditionEngine();
