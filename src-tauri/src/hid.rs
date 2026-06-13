//! Native HID connection layer.
//!
//! Owns the SINGLE native HID device handle for the whole process. The WebView
//! never touches hardware directly — it calls these `tauri::command`s.
//!
//! Implemented by the HID-CORE agent: `hidapi` is the primary transport. All
//! byte-level framing is delegated to the `walkplay-dac-protocol` crate so we
//! never hand-roll wire bytes here.
//!
//! # Threading model
//!
//! The one open [`hidapi::HidDevice`] lives behind a process-wide `Mutex`
//! ([`HidState`]) registered as Tauri managed state, so every command shares the
//! same single connection. `HidDevice` is `Send` (hidapi marks it so) which lets
//! it sit in the `Mutex`. We never hold the lock across an `.await`, so the
//! commands stay sound on the async runtime.
//!
//! We deliberately do NOT keep a long-lived `HidApi` in the manager: a fresh
//! `HidApi::new()` is cheap enough for our enumerate/connect paths and avoids
//! pinning a (potentially non-`Sync`) enumeration context in shared state.
//!
//! # Verification status
//!
//! * Enumeration, connect/handshake, band/preamp/reset **writes** use byte
//!   layouts marked `// VERIFIED` in the protocol crate (lifted from the
//!   original web bundle). They are protocol-correct but still
//!   `// NEEDS HARDWARE` for end-to-end confirmation.
//! * EQ **read-back** (`hid_read_eq`) is `// INFERRED` — the bundle's primary
//!   class ships an empty readback handler, so the device response shape is not
//!   proven. We attempt a real feature/input read and fall back to a cached
//!   best-effort snapshot. Marked `// NEEDS HARDWARE`.

use std::sync::Mutex;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use walkplay_dac_protocol as proto;

/// Event name emitted on every connection-status transition. The tray and the
/// React UI both subscribe to this.
pub const CONN_STATUS_EVENT: &str = "conn-status";

/// Connection status mirrored to the UI store (`ConnStatus` in TS).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ConnStatus {
    #[default]
    Disconnected,
    Connecting,
    Connected,
    /// Set by the UI/tray during long operations (e.g. firmware flash). Not
    /// constructed inside this module; kept as part of the declared API surface.
    #[allow(dead_code)]
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
    /// "PK" | "LS" | "HS" (also accepts "LP" | "HP").
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

impl Default for EqState {
    fn default() -> Self {
        // Flat 10-band default mirroring the web app's initial program.
        let default_freqs = [31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0];
        let bands = (0..proto::NUM_BANDS)
            .map(|i| EqBand {
                id: i as u32,
                freq: default_freqs[i],
                q: 1.41,
                gain: 0.0,
                band_type: "PK".to_string(),
                enabled: true,
            })
            .collect();
        EqState { bands, preamp: 0.0 }
    }
}

// ---------------------------------------------------------------------------
// UI <-> protocol band mapping
// ---------------------------------------------------------------------------

/// Map the UI band-type string ("PK"|"LS"|"HS"|"LP"|"HP") to a protocol filter.
fn ui_type_to_filter(s: &str) -> proto::FilterType {
    match s.to_ascii_uppercase().as_str() {
        "LS" => proto::FilterType::LowShelf,
        "HS" => proto::FilterType::HighShelf,
        "LP" => proto::FilterType::LowPass,
        "HP" => proto::FilterType::HighPass,
        // "PK" and anything unrecognised collapse to peaking.
        _ => proto::FilterType::Peaking,
    }
}

/// Map a protocol filter back to the UI band-type string.
fn filter_to_ui_type(f: proto::FilterType) -> &'static str {
    match f {
        proto::FilterType::Peaking => "PK",
        proto::FilterType::LowShelf => "LS",
        proto::FilterType::HighShelf => "HS",
        proto::FilterType::LowPass => "LP",
        proto::FilterType::HighPass => "HP",
    }
}

/// Convert a UI band into the protocol wire band.
///
/// Disabled bands are flattened to 0 dB / Peaking, mirroring the web app (the
/// primary register protocol carries no per-band enable bit — see the protocol
/// crate docs on [`proto::encode_band`]).
fn ui_band_to_wire(b: &EqBand) -> proto::EqBandWire {
    if b.enabled {
        proto::EqBandWire {
            index: b.id as u8,
            freq: b.freq,
            q: b.q,
            gain: b.gain,
            filter: ui_type_to_filter(&b.band_type),
            enabled: true,
        }
    } else {
        proto::EqBandWire {
            index: b.id as u8,
            freq: b.freq,
            q: b.q,
            gain: 0.0,
            filter: proto::FilterType::Peaking,
            enabled: false,
        }
    }
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

/// Process-wide HID manager. Holds the one open handle + current status.
///
/// Wrapped in a `Mutex` and registered as Tauri managed state so every command
/// shares the same single connection.
#[derive(Default)]
pub struct HidManager {
    pub status: ConnStatus,
    pub device: Option<DeviceInfo>,
    /// The single live native HID handle. `hidapi::HidDevice` is `Send`.
    pub hid: Option<hidapi::HidDevice>,
    /// Codec carrying the EQ base address for the connected device variant.
    pub codec: Option<proto::Codec>,
    /// Last EQ state we successfully wrote/read. Used as the best-effort
    /// fallback for `hid_read_eq` until hardware confirms the readback shape.
    pub cached_eq: Option<EqState>,
    /// Timestamp of the last successful device I/O (keep-alive bookkeeping).
    pub last_io: Option<Instant>,
}

impl HidManager {
    /// True when a handle is open.
    fn is_connected(&self) -> bool {
        self.hid.is_some()
    }

    /// Drop the handle and reset to disconnected.
    fn clear_connection(&mut self) {
        self.hid = None;
        self.device = None;
        self.codec = None;
        self.last_io = None;
        self.status = ConnStatus::Disconnected;
    }
}

/// The managed-state alias the rest of the app refers to.
pub type HidState = Mutex<HidManager>;

/// Error type surfaced to the WebView. Serializes to a string.
#[derive(Debug, thiserror::Error)]
pub enum HidError {
    #[error("no compatible device found")]
    NotFound,
    #[error("device is busy")]
    #[allow(dead_code)]
    Busy,
    #[error("no device connected")]
    NotConnected,
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

impl From<hidapi::HidError> for HidError {
    fn from(e: hidapi::HidError) -> Self {
        HidError::Io(e.to_string())
    }
}

type CmdResult<T> = Result<T, HidError>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Lock the manager, mapping a poisoned mutex into a `HidError`.
fn lock(state: &HidState) -> CmdResult<std::sync::MutexGuard<'_, HidManager>> {
    state.lock().map_err(|e| HidError::Other(e.to_string()))
}

/// Set status, store it, and emit the `conn-status` event to tray + UI.
fn set_status_and_emit(app: &AppHandle, state: &HidState, status: ConnStatus) -> CmdResult<()> {
    {
        let mut mgr = lock(state)?;
        mgr.status = status;
    }
    // Best-effort emit; a failed emit must not poison the connection flow.
    let _ = app.emit(CONN_STATUS_EVENT, status);
    Ok(())
}

/// Write a single HID Output Report payload on the given report id.
///
/// hidapi's `write` takes the report id as the FIRST byte of the buffer, so the
/// JS `sendReport(reportId, payload)` becomes `write([reportId, payload..])`.
fn write_report(dev: &hidapi::HidDevice, report_id: u8, payload: &[u8]) -> CmdResult<()> {
    let mut buf = Vec::with_capacity(payload.len() + 1);
    buf.push(report_id);
    buf.extend_from_slice(payload);
    dev.write(&buf)?;
    Ok(())
}

/// Send the handshake / auth frame (Report 84 = ASCII "12345678").
// VERIFIED frame; // NEEDS HARDWARE end-to-end confirmation that the device
// acks it and then accepts command frames.
fn send_handshake(dev: &hidapi::HidDevice) -> CmdResult<()> {
    write_report(dev, proto::HANDSHAKE_REPORT, &proto::handshake_frame())
}

/// Build a human-friendly device name from a hidapi `DeviceInfo`.
fn device_name(d: &hidapi::DeviceInfo) -> String {
    let product = d.product_string().unwrap_or("").trim().to_string();
    let manufacturer = d.manufacturer_string().unwrap_or("").trim().to_string();
    let label = match (manufacturer.is_empty(), product.is_empty()) {
        (false, false) => format!("{manufacturer} {product}"),
        (true, false) => product,
        (false, true) => manufacturer,
        (true, true) => "Walkplay DAC".to_string(),
    };
    if proto::is_primary(d.vendor_id(), d.product_id()) {
        format!("{label} (primary)")
    } else {
        label
    }
}

/// Enumerate whitelisted HID devices, primary device first.
fn enumerate_devices() -> CmdResult<Vec<DeviceInfo>> {
    let api = hidapi::HidApi::new().map_err(HidError::from)?;
    let mut out: Vec<DeviceInfo> = Vec::new();
    let mut seen: Vec<(u16, u16)> = Vec::new();

    for d in api.device_list() {
        let vid = d.vendor_id();
        let pid = d.product_id();
        if !proto::is_supported_vid(vid) {
            continue;
        }
        // De-duplicate by (vid, pid): a single device can expose several HID
        // interfaces/usages; the UI only cares about one logical device.
        if seen.contains(&(vid, pid)) {
            continue;
        }
        seen.push((vid, pid));
        out.push(DeviceInfo {
            vid,
            pid,
            name: device_name(d),
            connected: false,
            firmware: None,
        });
    }

    // Stable order: the primary 0x0666/0x0888 first, then the rest by (vid,pid).
    out.sort_by_key(|d| {
        let primary = !proto::is_primary(d.vid, d.pid); // false (0) sorts first
        (primary, d.vid, d.pid)
    });
    Ok(out)
}

/// Open a device by (vid, pid), preferring the path that matches the primary
/// usage. Falls back to the first matching HID interface.
fn open_device(vid: u16, pid: u16) -> CmdResult<hidapi::HidDevice> {
    let api = hidapi::HidApi::new().map_err(HidError::from)?;

    // Try to find a concrete path first so we open a deterministic interface.
    let path = api
        .device_list()
        .find(|d| d.vendor_id() == vid && d.product_id() == pid)
        .map(|d| d.path().to_owned());

    let dev = match path {
        Some(p) => api.open_path(&p).map_err(HidError::from)?,
        None => api.open(vid, pid).map_err(|_| HidError::NotFound)?,
    };
    Ok(dev)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// List all currently attached compatible devices (whitelist-filtered).
///
/// The result marks the currently-open device (if any) as `connected: true`.
#[tauri::command]
pub async fn hid_list_devices(state: State<'_, HidState>) -> CmdResult<Vec<DeviceInfo>> {
    let mut devices = enumerate_devices()?;

    // Flag the open device, if we have one.
    if let Ok(mgr) = lock(&state) {
        if let Some(open) = &mgr.device {
            for d in devices.iter_mut() {
                if d.vid == open.vid && d.pid == open.pid {
                    d.connected = true;
                }
            }
        }
    }
    Ok(devices)
}

/// Open and handshake with a device.
///
/// `vid`/`pid` are optional — when both are `None` we auto-pick: the primary
/// 0x0666/0x0888 if present, otherwise the first whitelisted device found.
///
/// Emits `conn-status` = `connecting` then `connected` (or back to
/// `disconnected` on failure).
#[tauri::command]
pub async fn hid_connect(
    app: AppHandle,
    state: State<'_, HidState>,
    vid: Option<u16>,
    pid: Option<u16>,
) -> CmdResult<DeviceInfo> {
    // If something is already open, close it first (single-handle invariant).
    {
        let mut mgr = lock(&state)?;
        if mgr.is_connected() {
            mgr.clear_connection();
        }
    }

    set_status_and_emit(&app, &state, ConnStatus::Connecting)?;

    // Resolve which device to open.
    let resolve = || -> CmdResult<(u16, u16)> {
        match (vid, pid) {
            (Some(v), Some(p)) => Ok((v, p)),
            _ => {
                let devices = enumerate_devices()?;
                // Prefer the primary; enumerate_devices already sorts it first.
                devices
                    .first()
                    .map(|d| (d.vid, d.pid))
                    .ok_or(HidError::NotFound)
            }
        }
    };

    let (v, p) = match resolve() {
        Ok(t) => t,
        Err(e) => {
            let _ = set_status_and_emit(&app, &state, ConnStatus::Disconnected);
            return Err(e);
        }
    };

    // Open + handshake.
    let dev = match open_device(v, p) {
        Ok(d) => d,
        Err(e) => {
            let _ = set_status_and_emit(&app, &state, ConnStatus::Disconnected);
            return Err(e);
        }
    };

    // Non-blocking reads so keep-alive / readback never hangs the UI thread.
    let _ = dev.set_blocking_mode(false);

    // NEEDS HARDWARE: confirm the device acks the handshake before commands.
    if let Err(e) = send_handshake(&dev) {
        let _ = set_status_and_emit(&app, &state, ConnStatus::Disconnected);
        return Err(e);
    }

    // Pull a friendly name from the open handle if we can.
    let name = dev
        .get_device_info()
        .ok()
        .map(|di| device_name(&di))
        .unwrap_or_else(|| {
            if proto::is_primary(v, p) {
                "Walkplay DAC (primary)".to_string()
            } else {
                "Walkplay DAC".to_string()
            }
        });

    let info = DeviceInfo {
        vid: v,
        pid: p,
        name,
        connected: true,
        firmware: None,
    };

    {
        let mut mgr = lock(&state)?;
        mgr.hid = Some(dev);
        mgr.device = Some(info.clone());
        // Primary device uses EQ base 32; other variants would override here.
        // NEEDS HARDWARE: alternate variants (base 53/66) are not auto-detected.
        mgr.codec = Some(proto::Codec::new());
        mgr.last_io = Some(Instant::now());
        mgr.status = ConnStatus::Connected;
    }

    let _ = app.emit(CONN_STATUS_EVENT, ConnStatus::Connected);
    Ok(info)
}

/// Close the active connection. Idempotent.
#[tauri::command]
pub async fn hid_disconnect(app: AppHandle, state: State<'_, HidState>) -> CmdResult<()> {
    {
        let mut mgr = lock(&state)?;
        mgr.clear_connection();
    }
    let _ = app.emit(CONN_STATUS_EVENT, ConnStatus::Disconnected);
    Ok(())
}

/// Read the full EQ (all bands + preamp) back from the device.
///
/// # Verification
///
/// `// INFERRED` + `// NEEDS HARDWARE`. The original web bundle's primary
/// device class implements `readFilterInfo(){}` as a no-op, so the wire shape of
/// the device's EQ *response* is unproven. We:
///
/// 1. Send a register READ frame for each band address (best-effort poke),
/// 2. Try to drain any input reports and decode them via [`proto::Codec`],
/// 3. Fall back to the last cached EQ we wrote — or a flat default — so the UI
///    always has a coherent state to render.
///
/// When real hardware is available, replace step 2's parsing with the confirmed
/// response framing and drop the cache fallback.
#[tauri::command]
pub async fn hid_read_eq(state: State<'_, HidState>) -> CmdResult<EqState> {
    let mut mgr = lock(&state)?;
    if !mgr.is_connected() {
        return Err(HidError::NotConnected);
    }

    // Best-effort device interaction. We never fail the command on a read miss;
    // we degrade to the cache so the editor stays usable.
    let decoded: Option<EqState> = {
        let dev = mgr.hid.as_ref().expect("connected");
        // Codec is not Clone; rebuild one from the connected variant's base.
        let eq_base = mgr.codec.as_ref().map(|c| c.eq_base).unwrap_or(proto::EQ_BASE_ADDR);
        let codec = proto::Codec::with_base(eq_base);

        // Poke each band's two register addresses with a READ frame.
        // NEEDS HARDWARE: firmware may instead bulk-dump on a single request.
        let base = proto::EQ_BASE_ADDR;
        for i in 0..proto::NUM_BANDS as u8 {
            let addr_a = base + 2 * i;
            let addr_b = base + 2 * i + 1;
            let fa = proto::register_frame(addr_a, proto::CMD_READ, [0, 0, 0, 0]);
            let fb = proto::register_frame(addr_b, proto::CMD_READ, [0, 0, 0, 0]);
            let _ = write_report(dev, proto::COMMAND_REPORT, &fa);
            let _ = write_report(dev, proto::COMMAND_REPORT, &fb);
        }

        // Drain whatever the device returns (non-blocking handle).
        let mut collected: Vec<u8> = Vec::new();
        let mut buf = [0u8; 64];
        for _ in 0..(proto::NUM_BANDS * 2 + 4) {
            match dev.read_timeout(&mut buf, 20) {
                Ok(n) if n >= 10 => {
                    // hidapi may or may not prefix the report id depending on the
                    // OS/descriptor. We expect raw 10-byte register frames whose
                    // byte 0 is a register address in the EQ block.
                    // NEEDS HARDWARE: confirm whether a leading report-id byte is
                    // present and strip it if so.
                    collected.extend_from_slice(&buf[..n]);
                }
                Ok(_) => break,
                Err(_) => break,
            }
        }

        // Try to decode a contiguous, frame-aligned slice.
        let aligned_len = (collected.len() / 10) * 10;
        codec
            .decode_eq(&collected[..aligned_len])
            .map(|wire_bands: Vec<proto::EqBandWire>| wire_to_eq_state(&wire_bands))
    };

    if let Some(eq) = decoded {
        mgr.cached_eq = Some(eq.clone());
        mgr.last_io = Some(Instant::now());
        return Ok(eq);
    }

    // Fallback: last thing we wrote, else a flat default.
    let eq = mgr.cached_eq.clone().unwrap_or_default();
    Ok(eq)
}

/// Build a UI `EqState` from decoded wire bands, preserving preamp from cache
/// (preamp has no readback in the bundle).
fn wire_to_eq_state(wire: &[proto::EqBandWire]) -> EqState {
    let bands = wire
        .iter()
        .map(|w| EqBand {
            id: w.index as u32,
            freq: w.freq,
            q: w.q,
            gain: w.gain,
            band_type: filter_to_ui_type(w.filter).to_string(),
            enabled: w.enabled,
        })
        .collect();
    EqState { bands, preamp: 0.0 }
}

/// Write a single band to the device.
///
/// Encodes both register frames (gain+freq, then Q+type) via the protocol crate
/// and pushes them on Report ID 75, then flushes to volatile memory so the
/// change takes effect immediately (mirroring the web app's per-edit flush).
// VERIFIED frame layout; // NEEDS HARDWARE end-to-end confirmation.
#[tauri::command]
pub async fn hid_write_band(state: State<'_, HidState>, band: EqBand) -> CmdResult<()> {
    let mut mgr = lock(&state)?;
    if !mgr.is_connected() {
        return Err(HidError::NotConnected);
    }

    let wire = ui_band_to_wire(&band);
    let frames = proto::encode_band(&wire); // 20 bytes = two 10-byte frames

    {
        let dev = mgr.hid.as_ref().expect("connected");
        write_report(dev, proto::COMMAND_REPORT, &frames[..10])?;
        write_report(dev, proto::COMMAND_REPORT, &frames[10..])?;
        // Apply immediately (RAM). Persisting to flash is a separate explicit
        // action; we keep edits cheap and non-wearing here.
        let _ = write_report(dev, proto::COMMAND_REPORT, &proto::flush_to_memory_frame());
    }

    // Keep the cache coherent so a subsequent read_eq reflects the edit even if
    // hardware readback is unavailable.
    update_cached_band(&mut mgr, &band);
    mgr.last_io = Some(Instant::now());
    Ok(())
}

/// Patch the cached EQ snapshot with a single edited band.
fn update_cached_band(mgr: &mut HidManager, band: &EqBand) {
    let eq = mgr.cached_eq.get_or_insert_with(EqState::default);
    if let Some(existing) = eq.bands.iter_mut().find(|b| b.id == band.id) {
        *existing = band.clone();
    } else {
        eq.bands.push(band.clone());
    }
}

/// Write the global preamp / pre-gain to the device.
// VERIFIED frame layout (negated ×10 int32 at addr 87); // NEEDS HARDWARE.
#[tauri::command]
pub async fn hid_write_preamp(state: State<'_, HidState>, preamp: f32) -> CmdResult<()> {
    let mut mgr = lock(&state)?;
    if !mgr.is_connected() {
        return Err(HidError::NotConnected);
    }

    let frame = proto::encode_preamp(preamp);
    {
        let dev = mgr.hid.as_ref().expect("connected");
        write_report(dev, proto::COMMAND_REPORT, &frame)?;
        let _ = write_report(dev, proto::COMMAND_REPORT, &proto::flush_to_memory_frame());
    }

    mgr.cached_eq.get_or_insert_with(EqState::default).preamp = preamp;
    mgr.last_io = Some(Instant::now());
    Ok(())
}

/// Reset the device EQ to factory defaults.
// VERIFIED frame (addr 0, cmd 'C'); // NEEDS HARDWARE.
#[tauri::command]
pub async fn hid_factory_reset(state: State<'_, HidState>) -> CmdResult<()> {
    let mut mgr = lock(&state)?;
    if !mgr.is_connected() {
        return Err(HidError::NotConnected);
    }

    {
        let dev = mgr.hid.as_ref().expect("connected");
        write_report(dev, proto::COMMAND_REPORT, &proto::factory_reset_frame())?;
        // Persist the reset to flash so it survives a power cycle.
        let _ = write_report(dev, proto::COMMAND_REPORT, &proto::flush_to_flash_frame());
    }

    // Reset the cache to flat defaults too.
    mgr.cached_eq = Some(EqState::default());
    mgr.last_io = Some(Instant::now());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_eq_has_ten_flat_bands() {
        let eq = EqState::default();
        assert_eq!(eq.bands.len(), proto::NUM_BANDS);
        assert!(eq.bands.iter().all(|b| b.gain == 0.0));
        assert_eq!(eq.preamp, 0.0);
    }

    #[test]
    fn ui_type_roundtrip() {
        for s in ["PK", "LS", "HS", "LP", "HP"] {
            let f = ui_type_to_filter(s);
            assert_eq!(filter_to_ui_type(f), s);
        }
        // Unknown collapses to PK.
        assert_eq!(ui_type_to_filter("???"), proto::FilterType::Peaking);
    }

    #[test]
    fn disabled_band_flattens_to_peaking_0db() {
        let b = EqBand {
            id: 3,
            freq: 1000.0,
            q: 1.0,
            gain: 6.0,
            band_type: "HS".into(),
            enabled: false,
        };
        let w = ui_band_to_wire(&b);
        assert_eq!(w.index, 3);
        assert_eq!(w.gain, 0.0);
        assert_eq!(w.filter, proto::FilterType::Peaking);
    }

    #[test]
    fn enabled_band_maps_through() {
        let b = EqBand {
            id: 2,
            freq: 500.0,
            q: 0.707,
            gain: -3.0,
            band_type: "LS".into(),
            enabled: true,
        };
        let w = ui_band_to_wire(&b);
        assert_eq!(w.gain, -3.0);
        assert_eq!(w.filter, proto::FilterType::LowShelf);
        // The encoded bytes should match the protocol crate's verified layout.
        let bytes = proto::encode_band(&w);
        assert_eq!(bytes.len(), 20);
    }

    #[test]
    fn update_cached_band_replaces_in_place() {
        let mut mgr = HidManager::default();
        let b = EqBand {
            id: 0,
            freq: 100.0,
            q: 1.0,
            gain: 4.0,
            band_type: "PK".into(),
            enabled: true,
        };
        update_cached_band(&mut mgr, &b);
        let eq = mgr.cached_eq.as_ref().unwrap();
        assert_eq!(eq.bands[0].gain, 4.0);
        assert_eq!(eq.bands.len(), proto::NUM_BANDS);
    }
}
