/**
 * Global EQ store (Zustand) — the single source of truth for UI state.
 *
 * Local-state mutations are implemented now. Device-touching actions delegate to
 * the typed bridge wrappers (src/lib/bridge.ts), which invoke the Rust commands.
 * The HID-CORE agent fleshes out the Rust side; this contract stays stable.
 */

import { create } from "zustand";
import * as bridge from "./bridge";
import { BUILTIN_PRESETS } from "@/features/presets/builtins";
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
  /** Id of the most recently applied preset (drives selection + tray check). */
  currentPresetId: string | null;
  /** True once the native event bridge has been wired (see {@link init}). */
  bridgeReady: boolean;

  // --- Lifecycle ---
  /**
   * Subscribe to the native `conn-status` / `apply-preset` events and seed the
   * tray "Quick EQ" submenu. Idempotent; safe to call once from app bootstrap.
   * Returns a teardown fn that unsubscribes from the native events.
   */
  init: () => Promise<() => void>;

  // --- Local-state mutations ---
  /** Patch one band by id (partial). Updates local state only. */
  setBand: (id: number, patch: Partial<EqBand>) => void;
  /** Set the global preamp (dB). Updates local state only. */
  setPreamp: (preamp: number) => void;
  /** Replace the live EQ with a preset's bands/preamp. */
  applyPreset: (preset: Preset) => void;
  /** Register the preset library and mirror it to the native tray. */
  setPresets: (presets: Preset[]) => void;

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
  // Seed the library with the built-in presets so both the panel and the tray
  // have something to show before any cloud/custom presets load.
  presets: BUILTIN_PRESETS.map((p) => ({ ...p, bands: p.bands.map((b) => ({ ...b })) })),
  currentPresetId: null,
  bridgeReady: false,

  init: async () => {
    if (!bridge.isTauri()) {
      // Plain-browser preview: nothing native to wire. Mark ready anyway so the
      // UI doesn't keep retrying.
      set({ bridgeReady: true });
      return () => {};
    }

    const unlisteners: Array<() => void> = [];

    // Native connection-status transitions (connect/disconnect/handshake).
    unlisteners.push(
      await bridge.onConnStatus((status) => {
        set((s) => ({
          status,
          device:
            status === "disconnected" ? null : s.device,
        }));
      }),
    );

    // Tray "Quick EQ" selection -> apply the matching preset locally + push.
    unlisteners.push(
      await bridge.onApplyPresetFromTray((presetId) => {
        const preset = get().presets.find((p) => p.id === presetId);
        if (preset) void get().applyPreset(preset);
      }),
    );

    // Seed the tray submenu with the current preset library.
    await bridge
      .setTrayPresets(get().presets.map((p) => ({ id: p.id, name: p.name })))
      .catch(() => {});

    set({ bridgeReady: true });
    return () => {
      for (const u of unlisteners) u();
    };
  },

  setBand: (id, patch) =>
    set((s) => ({
      // A manual edit detaches the EQ from any selected preset.
      currentPresetId: null,
      eq: {
        ...s.eq,
        bands: s.eq.bands.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      },
    })),

  setPreamp: (preamp) =>
    set((s) => ({ currentPresetId: null, eq: { ...s.eq, preamp } })),

  applyPreset: (preset) => {
    set(() => ({
      currentPresetId: preset.id,
      eq: { bands: preset.bands.map((b) => ({ ...b })), preamp: preset.preamp },
    }));
    // If connected, applying a preset should also reach the hardware.
    if (get().status === "connected") {
      void get().pushToDevice().catch(() => {});
    }
  },

  setPresets: (presets) => {
    set({ presets });
    if (bridge.isTauri()) {
      void bridge
        .setTrayPresets(presets.map((p) => ({ id: p.id, name: p.name })))
        .catch(() => {});
    }
  },

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
