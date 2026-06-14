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
import { buildProgram, preampFrame, T02_REPORT_ID } from "@/features/eq/t02-protocol";
import {
  DEFAULT_EQ_STATE,
  type ConnStatus,
  type DeviceInfo,
  type EqBand,
  type EqState,
  type Preset,
} from "./types";

/** localStorage key holding the user's locally-saved custom presets. */
const CUSTOM_KEY = "walkplay.customPresets";

function loadCustomPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as Preset[]).filter((p) => p && p.source === "custom") : [];
  } catch {
    return [];
  }
}

function persistCustomPresets(presets: Preset[]): void {
  try {
    localStorage.setItem(
      CUSTOM_KEY,
      JSON.stringify(presets.filter((p) => p.source === "custom")),
    );
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/**
 * Debounced full-program push. While dragging a slider we coalesce the rapid edits
 * into one device write (~60ms after the last change). The T02 device wants the FULL
 * 8-band program + commit on every change, so we always rebuild and stream it.
 */
let pushTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePush(get: () => EqStoreState): void {
  if (!bridge.isTauri()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const s = get();
    if (s.status === "connected" || s.status === "busy") {
      void s.pushToDevice().catch(() => {});
    }
  }, 60);
}

function newPresetId(): string {
  try {
    return "custom-" + crypto.randomUUID();
  } catch {
    return "custom-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

export interface EqStoreState {
  device: DeviceInfo | null;
  status: ConnStatus;
  eq: EqState;
  presets: Preset[];
  /** Id of the most recently applied preset (drives selection + tray check). */
  currentPresetId: string | null;
  /** True when the live EQ has unsaved edits relative to the selected preset. */
  dirty: boolean;
  /** True once the native event bridge has been wired (see {@link init}). */
  bridgeReady: boolean;
  /**
   * When true, the background poller auto-connects to an attached device.
   * Set false on a manual disconnect so we don't immediately reconnect;
   * re-enabled on the next manual connect.
   */
  autoConnect: boolean;

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
  /** Snapshot the live EQ into a new local custom preset. Returns its id. */
  saveAsCustom: (name?: string) => string;
  /**
   * Overwrite the currently-selected custom preset with the live EQ.
   * Returns false when no custom preset is currently selected.
   */
  updateCustom: () => boolean;
  /** Rename a custom preset by id. Returns false if not found / not custom. */
  renameCustom: (id: string, name: string) => boolean;
  /** Delete a custom preset by id. Returns false if not found / not custom. */
  deleteCustom: (id: string) => boolean;

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
  presets: [
    ...BUILTIN_PRESETS.map((p) => ({ ...p, bands: p.bands.map((b) => ({ ...b })) })),
    ...loadCustomPresets(),
  ],
  currentPresetId: null,
  dirty: false,
  bridgeReady: false,
  autoConnect: true,

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

    // Auto-connect poller: while disconnected (and not manually disconnected),
    // watch for an attached device and connect to it automatically. Also covers
    // hot-plug — pull out the dongle and plug it back in and we reconnect.
    let polling = false;
    const poll = async () => {
      if (polling) return; // skip overlapping ticks (connect can take a moment)
      const s = get();
      if (!s.autoConnect || s.status !== "disconnected") return;
      polling = true;
      try {
        const devices = await bridge.hidListDevices();
        // Re-check state after the await: user may have acted in the meantime.
        if (devices.length > 0 && get().autoConnect && get().status === "disconnected") {
          await get().connect();
        }
      } catch {
        /* no device / enumeration error — try again next tick */
      } finally {
        polling = false;
      }
    };
    const timer = setInterval(() => void poll(), 2000);
    void poll(); // attempt immediately on startup
    unlisteners.push(() => clearInterval(timer));

    set({ bridgeReady: true });
    return () => {
      for (const u of unlisteners) u();
    };
  },

  setBand: (id, patch) => {
    set((s) => ({
      // A manual edit marks the EQ dirty but keeps the selected preset so
      // "更新自定义EQ" can write the tweaks back to it.
      dirty: true,
      eq: {
        ...s.eq,
        bands: s.eq.bands.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      },
    }));
    schedulePush(get); // live-apply the edit to the device
  },

  setPreamp: (preamp) => {
    set((s) => ({ dirty: true, eq: { ...s.eq, preamp } }));
    schedulePush(get);
  },

  applyPreset: (preset) => {
    set(() => ({
      currentPresetId: preset.id,
      dirty: false,
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

  saveAsCustom: (name) => {
    const { eq, presets } = get();
    const id = newPresetId();
    const customCount = presets.filter((p) => p.source === "custom").length;
    const preset: Preset = {
      id,
      name: name && name.trim() ? name.trim() : `自定义 EQ ${customCount + 1}`,
      bands: eq.bands.map((b) => ({ ...b })),
      preamp: eq.preamp,
      source: "custom",
    };
    const next = [...presets, preset];
    set({ presets: next, currentPresetId: id, dirty: false });
    persistCustomPresets(next);
    if (bridge.isTauri()) {
      void bridge.setTrayPresets(next.map((p) => ({ id: p.id, name: p.name }))).catch(() => {});
    }
    return id;
  },

  updateCustom: () => {
    const { eq, presets, currentPresetId } = get();
    const idx = presets.findIndex((p) => p.id === currentPresetId && p.source === "custom");
    if (idx < 0) return false;
    const next = presets.map((p, i) =>
      i === idx ? { ...p, bands: eq.bands.map((b) => ({ ...b })), preamp: eq.preamp } : p,
    );
    set({ presets: next, dirty: false });
    persistCustomPresets(next);
    return true;
  },

  renameCustom: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    const { presets } = get();
    const idx = presets.findIndex((p) => p.id === id && p.source === "custom");
    if (idx < 0) return false;
    const next = presets.map((p, i) => (i === idx ? { ...p, name: trimmed } : p));
    set({ presets: next });
    persistCustomPresets(next);
    if (bridge.isTauri()) {
      void bridge.setTrayPresets(next.map((p) => ({ id: p.id, name: p.name }))).catch(() => {});
    }
    return true;
  },

  deleteCustom: (id) => {
    const { presets, currentPresetId } = get();
    const target = presets.find((p) => p.id === id && p.source === "custom");
    if (!target) return false;
    const next = presets.filter((p) => p.id !== id);
    set({
      presets: next,
      // Clear the selection if we just removed the active preset.
      currentPresetId: currentPresetId === id ? null : currentPresetId,
    });
    persistCustomPresets(next);
    if (bridge.isTauri()) {
      void bridge.setTrayPresets(next.map((p) => ({ id: p.id, name: p.name }))).catch(() => {});
    }
    return true;
  },

  connect: async (vid, pid) => {
    // A (re)connect re-arms auto-connect for future hot-plug events.
    set({ status: "connecting", autoConnect: true });
    try {
      const device = await bridge.hidConnect(vid, pid);
      set({ device, status: "connected" });
      await bridge.setTrayStatus("connected");
      // Readback is blocked on Windows for this device, so push our current EQ to
      // establish a known state (UI == device).
      await get().pushToDevice().catch(() => {});
    } catch (err) {
      set({ status: "disconnected", device: null });
      throw err;
    }
  },

  disconnect: async () => {
    // Manual disconnect: stop the poller from immediately reconnecting.
    await bridge.hidDisconnect();
    set({ device: null, status: "disconnected", autoConnect: false });
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
    if (!bridge.isTauri()) return;
    const { eq } = get();
    set({ status: "busy" });
    try {
      // T02-family protocol: stream the full 8-band biquad program + commit.
      // (See src/features/eq/t02-protocol.ts — validated against the official app.)
      const frames = buildProgram(eq.bands);
      for (const frame of frames) {
        await bridge.hidSendRaw(T02_REPORT_ID, frame);
      }
      // Pre-amp / pre-gain (separate immediate frame, no commit).
      await bridge.hidSendRaw(T02_REPORT_ID, preampFrame(eq.preamp));
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
