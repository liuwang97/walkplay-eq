/**
 * Typed wrappers around Tauri `invoke` / `listen` — the ONE place the WebView
 * talks to the Rust backend (src-tauri/src/{lib,hid,tray}.rs).
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Language } from "@/i18n";
import type { ConnStatus, DeviceInfo } from "./types";

/**
 * Whether we are running inside the Tauri WebView (vs. a plain browser, e.g.
 * `vite` dev). When false, callers skip native calls.
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// ---------------------------------------------------------------------------
// Device
// ---------------------------------------------------------------------------

/** Open + handshake a device (auto-picked). The backend replays the current EQ. */
export function hidConnect(): Promise<DeviceInfo> {
  return invoke<DeviceInfo>("hid_connect");
}

/** Close the connection and stop the backend from auto-reconnecting. */
export function hidDisconnect(): Promise<void> {
  return invoke<void>("hid_disconnect");
}

/** What a freshly created window needs to catch up (mirrors Rust `Snapshot`). */
export interface Snapshot {
  status: Exclude<ConnStatus, "connecting">;
  device: DeviceInfo | null;
  /** A preset picked from the tray that no window has shown yet. */
  pendingPreset: string | null;
  /** Whether the app launches at system startup. */
  autostart: boolean;
}

/** The backend's live state; it may have connected while no window existed. */
export function snapshot(): Promise<Snapshot> {
  return invoke<Snapshot>("snapshot");
}

/** Turn launch-at-startup on or off; resolves to the state actually in effect. */
export function setAutostart(enabled: boolean): Promise<boolean> {
  return invoke<boolean>("set_autostart", { enabled });
}

/**
 * Apply a full EQ program in one round trip. The backend writes it if a device
 * is connected and, either way, keeps it to replay on every (re)connect.
 * `saveFrames` follow a second later and make the device keep the program
 * across power loss; pass none for a program that is only being tried out.
 * `presetId` names the preset the program equals, if any.
 */
export function hidApplyProgram(
  reportId: number,
  frames: number[][],
  saveFrames: number[][],
  presetId: string | null,
): Promise<void> {
  return invoke<void>("hid_apply_program", { reportId, frames, saveFrames, presetId });
}

/**
 * Write frames once, without the backend remembering them — for commands that
 * must not be replayed on reconnect. Rejects when no device is connected.
 */
export function hidSend(reportId: number, frames: number[][]): Promise<void> {
  return invoke<void>("hid_send", { reportId, frames });
}

/** Ask the device a question and get its reply (without the report id). */
export function hidQuery(reportId: number, frame: number[]): Promise<number[]> {
  return invoke<number[]>("hid_query", { reportId, frame });
}

/** Subscribe to connection-status transitions (`conn-status` event). */
export function onConnStatus(handler: () => void): Promise<UnlistenFn> {
  return listen("conn-status", handler);
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

/** A tray "Quick EQ" entry: its label plus the program that applies it. */
export interface TrayPreset {
  id: string;
  name: string;
  reportId: number;
  frames: number[][];
  saveFrames: number[][];
}

/** Give the tray the UI language and the preset library it can switch between. */
export function traySync(lang: Language, presets: TrayPreset[]): Promise<void> {
  return invoke<void>("tray_sync", { lang, presets });
}

/** Subscribe to tray "Quick EQ" selections (`apply-preset` event, payload = preset id). */
export function onApplyPresetFromTray(handler: (presetId: string) => void): Promise<UnlistenFn> {
  return listen<string>("apply-preset", (e) => handler(e.payload));
}
