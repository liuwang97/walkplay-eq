/**
 * Global EQ store (Zustand) — the single source of truth for UI state.
 *
 * Every change to what the device should play goes through {@link scheduleSync},
 * which persists the working EQ and hands the backend one complete program. The
 * backend writes it when a device is connected and replays it on every
 * (re)connect, so the store never has to care whether one is attached.
 */

import { create } from "zustand";
import i18n, { getLanguage } from "@/i18n";
import {
  buildFactoryReset,
  buildProgram,
  micGainFrame,
  parseMicGain,
  parseVersion,
  READ_MIC_GAIN,
  READ_VERSION,
  SAVE_TO_FLASH,
  T02_REPORT_ID,
  UNTAGGED,
} from "@/features/eq/t02-protocol";
import { BUILTIN_PRESETS, presetLabel } from "@/features/presets/builtins";
import * as bridge from "./bridge";
import { ACCENT_KEYS, type AccentKey } from "./theme";
import {
  cloneEq,
  DEFAULT_BANDS,
  fitBands,
  MIC_GAIN,
  snapPreamp,
  type ConnStatus,
  type DeviceInfo,
  type EqBand,
  type EqState,
  type Preset,
} from "./types";

/** localStorage key holding the user's locally-saved custom presets. */
const CUSTOM_KEY = "walkplay.customPresets";
/** One-time copy of the custom presets as saved by the 10-band editor. */
const CUSTOM_BACKUP_KEY = "walkplay.customPresets.10band";
/** localStorage key holding the user's chosen accent color. */
const ACCENT_KEY = "walkplay.accent";
/** localStorage key holding the live "working" EQ (survives window destroy). */
const WORKING_KEY = "walkplay.working";

/** The persisted working state — restored when a closed window is reopened. */
interface WorkingSnapshot {
  eq: EqState;
  masterOn: boolean;
  currentPresetId: string | null;
  dirty: boolean;
}

function loadWorking(): Partial<WorkingSnapshot> {
  try {
    const w = JSON.parse(localStorage.getItem(WORKING_KEY) ?? "null");
    if (!w || !Array.isArray(w.eq?.bands)) return {};
    return { ...w, eq: { ...w.eq, bands: fitBands(w.eq.bands) } };
  } catch {
    return {};
  }
}

function loadAccent(): AccentKey {
  try {
    const raw = localStorage.getItem(ACCENT_KEY) as AccentKey | null;
    return raw && ACCENT_KEYS.includes(raw) ? raw : "azure";
  } catch {
    return "azure";
  }
}

function loadCustomPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY) ?? "[]";
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const presets = (arr as Preset[]).filter((p) => p?.source === "custom" && Array.isArray(p.bands));
    // Presets saved by the 10-band editor lose their two unplayed bands below;
    // keep the original once in case it is ever wanted back.
    if (
      presets.some((p) => p.bands.length > DEFAULT_BANDS.length) &&
      localStorage.getItem(CUSTOM_BACKUP_KEY) === null
    ) {
      persist(CUSTOM_BACKUP_KEY, raw);
    }
    return presets.map((p) => ({ ...p, bands: fitBands(p.bands) }));
  } catch {
    return [];
  }
}

/** Write a value to localStorage; storage being unavailable is non-fatal. */
function persist(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function newPresetId(): string {
  return "custom-" + crypto.randomUUID();
}

export interface EqStoreState {
  device: DeviceInfo | null;
  /** The connected device's firmware version, once it has answered. */
  firmware: string | null;
  /** The connected device's microphone gain in dB, once it has answered. */
  micGain: number | null;
  status: ConnStatus;
  eq: EqState;
  presets: Preset[];
  /** Id of the most recently applied preset (drives selection + tray tick). */
  currentPresetId: string | null;
  /** True when the live EQ has unsaved edits relative to the selected preset. */
  dirty: boolean;
  /** Index of the band selected in the instrument / inspector. */
  selected: number;
  /** Master EQ on/off. When off, the device gets a flat program (bypass). */
  masterOn: boolean;
  /** Active accent color (persisted). */
  accent: AccentKey;
  /** Whether the app launches at system startup (owned by the backend). */
  autostart: boolean;
  /** A/B compare: which slot is live. */
  activeSlot: "A" | "B";
  /**
   * The stashed (inactive) slot's EQ. `eq` always mirrors the active slot;
   * switching slots swaps `eq` <-> `slotStash`. Null until B is first used.
   */
  slotStash: EqState | null;

  /**
   * Wire the store to the backend: follow connection changes and tray preset
   * picks, publish the preset library to the tray, and catch up with whatever
   * the backend did while no window existed. Returns a teardown function.
   */
  init: () => Promise<() => void>;

  /** Patch one band by id and apply it. */
  setBand: (id: number, patch: Partial<EqBand>) => void;
  /** Set the global preamp (dB) and apply it. */
  setPreamp: (preamp: number) => void;
  /** Set the device's microphone gain (dB); the device keeps it. */
  setMicGain: (db: number) => void;
  /** Replace the live EQ with a preset's bands/preamp and apply it. */
  applyPreset: (preset: Preset) => void;
  /** Restore the default EQ (all bands, types and frequencies) and re-enable it. */
  resetToDefault: () => void;
  /** Snapshot the live EQ into a new local custom preset. */
  saveAsCustom: () => void;
  /**
   * Overwrite the currently-selected custom preset with the live EQ.
   * Returns false when no custom preset is currently selected.
   */
  updateCustom: () => boolean;
  /** Rename a custom preset by id. */
  renameCustom: (id: string, name: string) => void;
  /** Delete a custom preset by id. */
  deleteCustom: (id: string) => void;

  /** Select a band (instrument node / fader / inspector focus). */
  setSelected: (i: number) => void;
  /** Toggle master EQ on/off. */
  toggleMaster: () => void;
  /** Set the accent color (persisted). */
  setAccent: (accent: AccentKey) => void;
  /** Turn launch-at-startup on or off. */
  setAutostart: (enabled: boolean) => Promise<void>;
  /** Switch the live A/B slot, stashing the current one. */
  setActiveSlot: (slot: "A" | "B") => void;
  /** Copy the live EQ into the other A/B slot. */
  copyToOtherSlot: () => void;

  /** Connect to a device. Rejects when none could be opened. */
  connect: () => Promise<void>;
  /** Disconnect; the backend stays disconnected until the next connect. */
  disconnect: () => Promise<void>;
}

type Get = () => EqStoreState;

// ---------------------------------------------------------------------------
// Device sync
// ---------------------------------------------------------------------------

let syncTimer: ReturnType<typeof setTimeout> | undefined;
let syncing = false;
let syncAgain = false;

let micSaveTimer: ReturnType<typeof setTimeout> | undefined;

/** The next send should also make the device keep the EQ across power loss. */
let saveNext = false;

/**
 * Persist the working EQ and send it to the backend. Coalesces bursts (a slider
 * drag fires on every pointer move) into one send ~50ms after the last change.
 *
 * `save` marks an EQ the user chose to keep — a preset applied, a custom EQ
 * saved — as opposed to an edit in progress, which only plays. It is the
 * official app's "use" versus "try".
 */
function scheduleSync(get: Get, save = false): void {
  if (save) saveNext = true;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void sync(get), 50);
}

async function sync(get: Get): Promise<void> {
  // One send at a time, always ending on the latest state, so programs can
  // never reach the device out of order.
  if (syncing) {
    syncAgain = true;
    return;
  }
  syncing = true;
  try {
    do {
      syncAgain = false;
      const { eq, masterOn, currentPresetId, dirty, presets } = get();
      persist(WORKING_KEY, { eq, masterOn, currentPresetId, dirty } satisfies WorkingSnapshot);
      if (!bridge.isTauri()) continue;
      // Master off = device bypass: a flat program instead of the live EQ.
      const audible: EqState = masterOn
        ? eq
        : { bands: eq.bands.map((b) => ({ ...b, gain: 0 })), preamp: 0 };
      const presetId = masterOn && !dirty ? currentPresetId : null;
      const tag = presets.find((p) => p.id === presetId)?.tag ?? UNTAGGED;
      // The bypass is never worth keeping on the device.
      const saveFrames = saveNext && masterOn ? [SAVE_TO_FLASH] : [];
      saveNext = false;
      // A failed write means the device went away; the backend reports that
      // through `conn-status` and replays this program when it is back.
      await bridge
        .hidApplyProgram(T02_REPORT_ID, buildProgram(audible, tag), saveFrames, presetId)
        .catch(() => {});
    } while (syncAgain);
  } finally {
    syncing = false;
  }
}

/** Publish the preset library (names in the UI language) to the native tray. */
function syncTray(presets: Preset[]): void {
  if (!bridge.isTauri()) return;
  const lang = getLanguage();
  const entries = presets.map((p) => ({
    id: p.id,
    name: presetLabel(p, lang),
    reportId: T02_REPORT_ID,
    frames: buildProgram(p, p.tag ?? UNTAGGED),
    // Picking a preset from the tray means "use this", so the device keeps it.
    saveFrames: [SAVE_TO_FLASH],
  }));
  void bridge.traySync(lang, entries).catch(() => {});
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const WORKING = loadWorking();

export const useEqStore = create<EqStoreState>((set, get) => {
  /** Replace the custom-preset part of the library, persisting + republishing it. */
  const commitPresets = (presets: Preset[], extra: Partial<EqStoreState> = {}) => {
    set({ presets, ...extra });
    persist(CUSTOM_KEY, presets.filter((p) => p.source === "custom"));
    syncTray(presets);
  };

  /** Ask the connected device for its firmware version and microphone gain. */
  const readDevice = async () => {
    const ask = (query: number[]) => bridge.hidQuery(T02_REPORT_ID, query).catch(() => null);
    const version = await ask(READ_VERSION);
    const mic = await ask(READ_MIC_GAIN);
    set({ firmware: version && parseVersion(version), micGain: mic && parseMicGain(mic) });
  };

  /** Pull connection status, device and settings from the backend. */
  const refreshConnection = async () => {
    const snap = await bridge.snapshot();
    set({ status: snap.status, device: snap.device, autostart: snap.autostart });
    if (snap.status === "connected") void readDevice();
    else set({ firmware: null, micGain: null });
    return snap;
  };

  /** Make a preset the live EQ in the editor (the caller sends it). */
  const showPreset = (preset: Preset) => {
    set((s) => ({
      currentPresetId: preset.id,
      dirty: false,
      eq: cloneEq(preset),
      // Presets differ in band count; keep the selection on a real band.
      selected: Math.min(s.selected, preset.bands.length - 1),
    }));
  };

  /** Show a preset the tray already put on the device. */
  const adoptTrayPreset = (presetId: string) => {
    const preset = get().presets.find((p) => p.id === presetId);
    if (preset) {
      // Picking a preset from the tray means "play this", so leave bypass.
      set({ masterOn: true });
      showPreset(preset);
    }
    // The tray has already had the device keep it; this send only tells the
    // backend that a window now shows it.
    scheduleSync(get);
  };

  return {
    device: null,
    firmware: null,
    micGain: null,
    status: "disconnected",
    eq: cloneEq(WORKING.eq ?? { bands: DEFAULT_BANDS, preamp: 0 }),
    presets: [...BUILTIN_PRESETS.map((p) => ({ ...p, ...cloneEq(p) })), ...loadCustomPresets()],
    currentPresetId: WORKING.currentPresetId ?? null,
    dirty: WORKING.dirty ?? false,
    selected: 3,
    masterOn: WORKING.masterOn ?? true,
    accent: loadAccent(),
    autostart: false,
    activeSlot: "A",
    slotStash: null,

    init: async () => {
      if (!bridge.isTauri()) return () => {};

      const unlisten = await Promise.all([
        bridge.onConnStatus(() => void refreshConnection().catch(() => {})),
        bridge.onApplyPresetFromTray(adoptTrayPreset),
      ]);
      // Tray labels follow the UI language.
      const onLanguage = () => syncTray(get().presets);
      i18n.on("languageChanged", onLanguage);
      syncTray(get().presets);

      try {
        const snap = await refreshConnection();
        if (snap.pendingPreset) adoptTrayPreset(snap.pendingPreset);
        // Give the backend the EQ this window shows. On a first run it has
        // none; otherwise this replaces a program an older build encoded.
        else scheduleSync(get);
      } catch {
        /* backend unavailable — stay on defaults */
      }

      return () => {
        for (const u of unlisten) u();
        i18n.off("languageChanged", onLanguage);
      };
    },

    setBand: (id, patch) => {
      // An edit marks the EQ dirty but keeps the selected preset, so "update
      // custom EQ" can write the tweaks back to it.
      set((s) => ({
        dirty: true,
        eq: { ...s.eq, bands: s.eq.bands.map((b) => (b.id === id ? { ...b, ...patch } : b)) },
      }));
      scheduleSync(get);
    },

    setPreamp: (preamp) => {
      set((s) => ({ dirty: true, eq: { ...s.eq, preamp: snapPreamp(preamp) } }));
      scheduleSync(get);
    },

    applyPreset: (preset) => {
      showPreset(preset);
      scheduleSync(get, true);
    },

    resetToDefault: () => {
      set({ masterOn: true });
      showPreset(BUILTIN_PRESETS[0]);
      if (!bridge.isTauri()) return scheduleSync(get);
      // The device's own factory reset saves the flat EQ itself, so the program
      // that follows only plays. With no device to reset, have the flat EQ
      // saved on the next connect instead.
      void bridge.hidSend(T02_REPORT_ID, buildFactoryReset()).then(
        () => {
          scheduleSync(get);
          // The device needs a moment before it reports its new state.
          setTimeout(() => void readDevice(), 500);
        },
        () => scheduleSync(get, true),
      );
    },

    setMicGain: (db) => {
      const micGain = Math.max(MIC_GAIN.min, Math.min(MIC_GAIN.max, Math.round(db)));
      set({ micGain });
      if (!bridge.isTauri()) return;
      void bridge.hidSend(T02_REPORT_ID, [micGainFrame(micGain)]).catch(() => {});
      // Have the device keep it once the stepping has settled.
      clearTimeout(micSaveTimer);
      micSaveTimer = setTimeout(
        () => void bridge.hidSend(T02_REPORT_ID, [SAVE_TO_FLASH]).catch(() => {}),
        1000,
      );
    },

    saveAsCustom: () => {
      const { eq, presets } = get();
      const id = newPresetId();
      const n = presets.filter((p) => p.source === "custom").length + 1;
      const name = getLanguage() === "en" ? `Custom EQ ${n}` : `自定义 EQ ${n}`;
      commitPresets([...presets, { id, name, ...cloneEq(eq), source: "custom" }], {
        currentPresetId: id,
        dirty: false,
      });
      scheduleSync(get, true);
    },

    updateCustom: () => {
      const { eq, presets, currentPresetId } = get();
      if (!presets.some((p) => p.id === currentPresetId && p.source === "custom")) return false;
      commitPresets(
        presets.map((p) => (p.id === currentPresetId ? { ...p, ...cloneEq(eq) } : p)),
        { dirty: false },
      );
      scheduleSync(get, true);
      return true;
    },

    renameCustom: (id, name) => {
      commitPresets(
        get().presets.map((p) => (p.id === id && p.source === "custom" ? { ...p, name } : p)),
      );
    },

    deleteCustom: (id) => {
      const { presets, currentPresetId } = get();
      commitPresets(
        presets.filter((p) => !(p.id === id && p.source === "custom")),
        // Clear the selection if we just removed the active preset.
        currentPresetId === id ? { currentPresetId: null } : {},
      );
      scheduleSync(get);
    },

    setSelected: (i) => set({ selected: i }),

    toggleMaster: () => {
      set((s) => ({ masterOn: !s.masterOn }));
      scheduleSync(get);
    },

    setAccent: (accent) => {
      set({ accent });
      persist(ACCENT_KEY, accent);
    },

    setAutostart: async (enabled) => {
      set({ autostart: await bridge.setAutostart(enabled) });
    },

    setActiveSlot: (slot) => {
      const s = get();
      if (slot === s.activeSlot) return;
      // Swap the live EQ with the stash; B starts as a copy of A.
      set({
        activeSlot: slot,
        slotStash: cloneEq(s.eq),
        eq: cloneEq(s.slotStash ?? s.eq),
        currentPresetId: null,
        dirty: false,
      });
      scheduleSync(get);
    },

    copyToOtherSlot: () => set((s) => ({ slotStash: cloneEq(s.eq) })),

    connect: async () => {
      set({ status: "connecting" });
      try {
        // The backend replays the current program on the freshly opened device.
        const device = await bridge.hidConnect();
        set({ device, status: "connected" });
        void readDevice();
      } catch (err) {
        set({ status: "disconnected", device: null });
        throw err;
      }
    },

    disconnect: async () => {
      await bridge.hidDisconnect();
      set({ device: null, firmware: null, micGain: null, status: "disconnected" });
    },
  };
});
