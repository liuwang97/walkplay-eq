/**
 * Typed wrappers around Tauri `invoke` for the Rust command surface.
 *
 * This is the ONE place the WebView talks to the native HID/firmware layer.
 * Keep these thin — they just type the boundary. Command names + payload shapes
 * are the cross-agent contract with the Rust side (src-tauri/src/{hid,firmware}.rs).
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ConnStatus, DeviceInfo, EqBand, EqState } from "./types";

/**
 * Whether we are running inside the Tauri WebView (vs. a plain browser, e.g.
 * `vite` dev or `vite preview`). When false, every native call no-ops/throws a
 * friendly error instead of blowing up on a missing `window.__TAURI_INTERNALS__`.
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Result of a firmware version check (mirrors Rust `FirmwareCheck`). */
export interface FirmwareCheck {
  current: string;
  latest?: string;
  updateAvailable: boolean;
  url?: string;
}

/** Outcome of a firmware upgrade (mirrors Rust `FirmwareUpgradeResult`). */
export interface FirmwareUpgradeResult {
  success: boolean;
  message: string;
}

/** One firmware-upgrade progress tick (mirrors Rust `FwProgress`). */
export interface FwProgress {
  phase:
    | "idle"
    | "download"
    | "enter-dfu"
    | "erase"
    | "write-chunks"
    | "verify"
    | "reboot"
    | "done"
    | "aborted"
    | "failed";
  message: string;
  /** 0..=100 overall progress. */
  percent: number;
  /** `true` when no device writes were performed (download/validation only). */
  dry_run: boolean;
}

/** Enumerate attached compatible devices. */
export function hidListDevices(): Promise<DeviceInfo[]> {
  return invoke<DeviceInfo[]>("hid_list_devices");
}

/** Open + handshake a device. Omit vid/pid to auto-pick the primary device. */
export function hidConnect(vid?: number, pid?: number): Promise<DeviceInfo> {
  return invoke<DeviceInfo>("hid_connect", { vid, pid });
}

/** Close the active connection. */
export function hidDisconnect(): Promise<void> {
  return invoke<void>("hid_disconnect");
}

/** Read the full EQ (all bands + preamp) back from the device. */
export function hidReadEq(): Promise<EqState> {
  return invoke<EqState>("hid_read_eq");
}

/** Write a single band to the device. */
export function hidWriteBand(band: EqBand): Promise<void> {
  return invoke<void>("hid_write_band", { band });
}

/** Write the global preamp / pre-gain to the device. */
export function hidWritePreamp(preamp: number): Promise<void> {
  return invoke<void>("hid_write_preamp", { preamp });
}

/** Send a raw HID output report (report id + payload). Used by the T02 coeff protocol. */
export function hidSendRaw(reportId: number, data: number[]): Promise<void> {
  return invoke<void>("hid_send_raw", { reportId, data });
}

/** Reset the device EQ to factory defaults. */
export function hidFactoryReset(): Promise<void> {
  return invoke<void>("hid_factory_reset");
}

/** Push a connection status to the native tray (tooltip/title). */
export function setTrayStatus(status: ConnStatus): Promise<void> {
  return invoke<void>("set_tray_status", { status });
}

/** Check whether a firmware update is available for the given device. */
export function fwCheck(vid: number, pid: number): Promise<FirmwareCheck> {
  return invoke<FirmwareCheck>("fw_check", { vid, pid });
}

/**
 * Download + flash a firmware image.
 *
 * `confirmed` is the brick-safety gate on the Rust side: without it the flow
 * runs as a dry run (download + validate + progress, no device writes).
 */
export function fwUpgrade(url: string, confirmed = false): Promise<FirmwareUpgradeResult> {
  return invoke<FirmwareUpgradeResult>("fw_upgrade", { url, confirmed });
}

// ---------------------------------------------------------------------------
// Tray <-> UI: quick EQ switch
// ---------------------------------------------------------------------------

/** A tray-facing preset entry: the id + label the native "Quick EQ" submenu shows. */
export interface TrayPreset {
  id: string;
  name: string;
}

/**
 * Push the current preset list to the native tray so its "Quick EQ" submenu can
 * be (re)built. The tray emits `apply-preset` with the chosen id on click.
 */
export function setTrayPresets(presets: TrayPreset[]): Promise<void> {
  return invoke<void>("set_tray_presets", { presets });
}

// ---------------------------------------------------------------------------
// Event subscriptions (Rust -> WebView)
// ---------------------------------------------------------------------------

/** Subscribe to native connection-status transitions (`conn-status` event). */
export function onConnStatus(handler: (status: ConnStatus) => void): Promise<UnlistenFn> {
  return listen<ConnStatus>("conn-status", (e) => handler(e.payload));
}

/** Subscribe to firmware-upgrade progress (`fw-progress` event). */
export function onFwProgress(handler: (progress: FwProgress) => void): Promise<UnlistenFn> {
  return listen<FwProgress>("fw-progress", (e) => handler(e.payload));
}

/** Subscribe to tray "Quick EQ" selections (`apply-preset` event, payload = preset id). */
export function onApplyPresetFromTray(handler: (presetId: string) => void): Promise<UnlistenFn> {
  return listen<string>("apply-preset", (e) => handler(e.payload));
}
