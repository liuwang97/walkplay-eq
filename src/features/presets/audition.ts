/**
 * Local audition (试听) engine.
 *
 * The device itself can't stream a demo, so audition is a UI-side preview: we
 * synthesize looping pink-ish noise in the WebAudio graph and run it through a
 * BiquadFilter chain that mirrors the preset's 10 PEQ bands + preamp. This lets
 * the user hear the *shape* of a preset before committing it to the hardware
 * with 使用. It never touches the HID layer.
 *
 * A single shared engine instance is used so starting a new audition stops the
 * previous one (only one preview plays at a time).
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

/** Generate ~2s of looping pink-ish noise as an AudioBuffer. */
function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const seconds = 2;
  const length = ctx.sampleRate * seconds;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Voss-McCartney-ish smoothing toward pink noise (cheap approximation).
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.18;
  }
  return buffer;
}

class AuditionEngine {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
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
    if (!this.buffer) this.buffer = makeNoiseBuffer(ctx);

    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
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
