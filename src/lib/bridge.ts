/**
 * Typed wrappers around Tauri `invoke` for the Rust command surface.
 *
 * This is the ONE place the WebView talks to the native HID/firmware layer.
 * Keep these thin — they just type the boundary. Command names + payload shapes
 * are the cross-agent contract with the Rust side (src-tauri/src/{hid,firmware}.rs).
 */

import { invoke } from "@tauri-apps/api/core";
import type { ConnStatus, DeviceInfo, EqBand, EqState } from "./types";

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

/** Download + flash a firmware image. */
export function fwUpgrade(url: string): Promise<FirmwareUpgradeResult> {
  return invoke<FirmwareUpgradeResult>("fw_upgrade", { url });
}
