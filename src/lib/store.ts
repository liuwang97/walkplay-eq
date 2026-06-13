/**
 * Global EQ store (Zustand) — the single source of truth for UI state.
 *
 * Local-state mutations are implemented now. Device-touching actions delegate to
 * the typed bridge wrappers (src/lib/bridge.ts), which invoke the Rust commands.
 * The HID-CORE agent fleshes out the Rust side; this contract stays stable.
 */

import { create } from "zustand";
import * as bridge from "./bridge";
import {
  DEFAULT_EQ_STATE,
  type ConnStatus,
  type DeviceInfo,
  type EqBand,
  type EqState,
  type Preset,
} from "./types";

export interface EqStoreState {
  device: DeviceInfo | null;
  status: ConnStatus;
  eq: EqState;
  presets: Preset[];

  // --- Local-state mutations ---
  /** Patch one band by id (partial). Updates local state only. */
  setBand: (id: number, patch: Partial<EqBand>) => void;
  /** Set the global preamp (dB). Updates local state only. */
  setPreamp: (preamp: number) => void;
  /** Replace the live EQ with a preset's bands/preamp. */
  applyPreset: (preset: Preset) => void;

  // --- Device-touching actions (delegate to bridge) ---
  /** Connect to a device (auto-picks primary when vid/pid omitted). */
  connect: (vid?: number, pid?: number) => Promise<void>;
  /** Disconnect the current device. */
  disconnect: () => Promise<void>;
  /** Pull the full EQ from the device into the store. */
  loadFromDevice: () => Promise<void>;
  /** Push the entire current EQ (all bands + preamp) to the device. */
  pushToDevice: () => Promise<void>;
  /** Factory-reset the device, then reload local state to defaults. */
  factoryReset: () => Promise<void>;
}

export const useEqStore = create<EqStoreState>((set, get) => ({
  device: null,
  status: "disconnected",
  eq: { bands: DEFAULT_EQ_STATE.bands.map((b) => ({ ...b })), preamp: DEFAULT_EQ_STATE.preamp },
  presets: [],

  setBand: (id, patch) =>
    set((s) => ({
      eq: {
        ...s.eq,
        bands: s.eq.bands.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      },
    })),

  setPreamp: (preamp) =>
    set((s) => ({ eq: { ...s.eq, preamp } })),

  applyPreset: (preset) =>
    set(() => ({
      eq: { bands: preset.bands.map((b) => ({ ...b })), preamp: preset.preamp },
    })),

  connect: async (vid, pid) => {
    set({ status: "connecting" });
    try {
      const device = await bridge.hidConnect(vid, pid);
      set({ device, status: "connected" });
      await bridge.setTrayStatus("connected");
    } catch (err) {
      set({ status: "disconnected", device: null });
      throw err;
    }
  },

  disconnect: async () => {
    await bridge.hidDisconnect();
    set({ device: null, status: "disconnected" });
    await bridge.setTrayStatus("disconnected");
  },

  loadFromDevice: async () => {
    set({ status: "busy" });
    try {
      const eq: EqState = await bridge.hidReadEq();
      set({ eq, status: "connected" });
    } catch (err) {
      set({ status: "connected" });
      throw err;
    }
  },

  pushToDevice: async () => {
    const { eq } = get();
    set({ status: "busy" });
    try {
      for (const band of eq.bands) {
        await bridge.hidWriteBand(band);
      }
      await bridge.hidWritePreamp(eq.preamp);
    } finally {
      set({ status: "connected" });
    }
  },

  factoryReset: async () => {
    set({ status: "busy" });
    try {
      await bridge.hidFactoryReset();
      set({
        eq: {
          bands: DEFAULT_EQ_STATE.bands.map((b) => ({ ...b })),
          preamp: DEFAULT_EQ_STATE.preamp,
        },
      });
    } finally {
      set({ status: "connected" });
    }
  },
}));
