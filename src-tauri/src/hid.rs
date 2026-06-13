//! Native HID connection layer.
//!
//! Owns the SINGLE native HID device handle for the whole process. The WebView
//! never touches hardware directly — it calls these `tauri::command`s.
//!
//! FOUNDATION STUB: signatures + state container + registration are final.
//! The HID-CORE agent fills the bodies (hidapi primary, serialport fallback).

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::State;

/// Connection status mirrored to the UI store (`ConnStatus` in TS).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ConnStatus {
    #[default]
    Disconnected,
    Connecting,
    Connected,
    Busy,
}

/// A discovered device candidate (`DeviceInfo` in TS).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub vid: u16,
    pub pid: u16,
    pub name: String,
    pub connected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub firmware: Option<String>,
}

/// One EQ band as exchanged with the UI (`EqBand` in TS).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EqBand {
    pub id: u32,
    pub freq: f32,
    pub q: f32,
    pub gain: f32,
    /// "PK" | "LS" | "HS"
    #[serde(rename = "type")]
    pub band_type: String,
    pub enabled: bool,
}

/// Full EQ snapshot (`EqState` in TS).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EqState {
    pub bands: Vec<EqBand>,
    pub preamp: f32,
}

/// Process-wide HID manager. Holds the one open handle + current status.
///
/// Wrapped in a `Mutex` and registered as Tauri managed state so every command
/// shares the same single connection.
#[derive(Default)]
pub struct HidManager {
    pub status: ConnStatus,
    pub device: Option<DeviceInfo>,
    // The HID-CORE agent adds the live handle(s) here, e.g.:
    //   hid: Option<hidapi::HidDevice>,
    //   serial: Option<Box<dyn serialport::SerialPort>>,
    //   api: Option<hidapi::HidApi>,
}

/// The managed-state alias the rest of the app refers to.
pub type HidState = Mutex<HidManager>;

/// Error type surfaced to the WebView. Serializes to a string.
#[derive(Debug, thiserror::Error)]
pub enum HidError {
    #[error("no compatible device found")]
    NotFound,
    #[error("device is busy")]
    Busy,
    #[error("device i/o error: {0}")]
    Io(String),
    #[error("{0}")]
    Other(String),
}

impl Serialize for HidError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

type CmdResult<T> = Result<T, HidError>;

/// List all currently attached compatible devices (whitelist-filtered).
#[tauri::command]
pub async fn hid_list_devices() -> CmdResult<Vec<DeviceInfo>> {
    // HID-CORE: enumerate via hidapi, filter by VID_WHITELIST / SERIAL_DEVICES.
    Ok(Vec::new())
}

/// Open and handshake with a device. `vid`/`pid` optional — None = auto-pick primary.
#[tauri::command]
pub async fn hid_connect(
    state: State<'_, HidState>,
    vid: Option<u16>,
    pid: Option<u16>,
) -> CmdResult<DeviceInfo> {
    let _ = (&state, vid, pid);
    // HID-CORE: open device, send HANDSHAKE_REPORT, store handle + status.
    todo!("HID-CORE agent: implement hid_connect")
}

/// Close the active connection.
#[tauri::command]
pub async fn hid_disconnect(state: State<'_, HidState>) -> CmdResult<()> {
    let mut mgr = state.lock().map_err(|e| HidError::Other(e.to_string()))?;
    mgr.device = None;
    mgr.status = ConnStatus::Disconnected;
    Ok(())
}

/// Read the full EQ (all bands + preamp) back from the device.
#[tauri::command]
pub async fn hid_read_eq(state: State<'_, HidState>) -> CmdResult<EqState> {
    let _ = &state;
    // HID-CORE: read report(s), decode via walkplay_dac_protocol::Codec.
    todo!("HID-CORE agent: implement hid_read_eq")
}

/// Write a single band to the device.
#[tauri::command]
pub async fn hid_write_band(state: State<'_, HidState>, band: EqBand) -> CmdResult<()> {
    let _ = (&state, &band);
    // HID-CORE: encode_band + sendReport.
    todo!("HID-CORE agent: implement hid_write_band")
}

/// Write the global preamp / pre-gain to the device.
#[tauri::command]
pub async fn hid_write_preamp(state: State<'_, HidState>, preamp: f32) -> CmdResult<()> {
    let _ = (&state, preamp);
    // HID-CORE: encode_preamp + sendReport.
    todo!("HID-CORE agent: implement hid_write_preamp")
}

/// Reset the device EQ to factory defaults.
#[tauri::command]
pub async fn hid_factory_reset(state: State<'_, HidState>) -> CmdResult<()> {
    let _ = &state;
    // HID-CORE: issue factory-reset command frame.
    todo!("HID-CORE agent: implement hid_factory_reset")
}
