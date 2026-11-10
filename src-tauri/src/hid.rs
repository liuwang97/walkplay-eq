//! Native HID connection layer.
//!
//! Owns the SINGLE native HID handle for the whole process; the WebView never
//! touches hardware directly. The handle lives behind a process-wide `Mutex`
//! ([`HidState`]) so every command, the tray and the background poller share
//! one connection. The lock is never held across an `.await` or a Tauri call.
//!
//! The device is driven with whole *programs*: the complete list of output
//! report frames for one EQ state (see `src/features/eq/t02-protocol.ts`, which
//! builds them). The last program is cached, persisted and replayed after every
//! (re)connect, so the EQ survives hot-plug and reboots with no window open.
//!
//! A program plays from the device's RAM. One the user has chosen to keep also
//! carries *save frames*, sent once a moment later, which make the device hold
//! it across power loss — so it still plays on a phone, with no app around.

use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use walkplay_dac_protocol as proto;

/// Event emitted on every connection-status transition (payload: [`ConnStatus`]).
pub const CONN_STATUS_EVENT: &str = "conn-status";

/// How long the poller waits after a failed auto-connect before retrying, so a
/// device we cannot open does not get hammered every tick.
const RETRY_BACKOFF: Duration = Duration::from_secs(10);

/// The report every EQ command and reply travels on.
const COMMAND_REPORT: u8 = 75;

/// The query a device must answer before it is given a program: "what is your
/// firmware version?" in the T02 protocol. The vendor ids are shared by chip
/// families that speak other protocols (the official app tells them apart
/// through its cloud catalogue); those do not answer this, and must not be
/// sent T02 frames.
const PROBE: [u8; 2] = [0x80, 0x0c];

/// How long after a program its save frames follow. The official app waits
/// this long too, so the program has settled before the device writes flash.
const SAVE_DELAY: Duration = Duration::from_secs(1);

/// Connection status as seen by the tray and the UI (`ConnStatus` in TS, which
/// additionally has a UI-only "connecting").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ConnStatus {
    #[default]
    Disconnected,
    Connected,
}

/// The open (or a discovered) device (`DeviceInfo` in TS).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub vid: u16,
    pub pid: u16,
    pub name: String,
}

/// One complete device program: every frame goes out on `report_id`, in order.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Program {
    pub report_id: u8,
    pub frames: Vec<Vec<u8>>,
    /// Frames that make the device keep this program across power loss. Sent
    /// once, [`SAVE_DELAY`] after the program, and never part of a replay.
    /// Empty for a program that is only being tried out.
    #[serde(default)]
    pub save_frames: Vec<Vec<u8>>,
}

/// Process-wide HID manager: the one open handle plus what to replay on it.
pub struct HidManager {
    device: Option<DeviceInfo>,
    hid: Option<hidapi::HidDevice>,
    /// Whether the poller may connect on its own. Cleared by an explicit user
    /// disconnect, re-armed by an explicit connect.
    auto_connect: bool,
    /// Earliest time the poller may try to auto-connect again.
    retry_at: Option<Instant>,
    /// The last program applied; replayed verbatim after every (re)connect.
    program: Option<Program>,
    /// When the program's save frames are due; `None` once sent or not wanted.
    save_at: Option<Instant>,
}

impl Default for HidManager {
    fn default() -> Self {
        HidManager {
            device: None,
            hid: None,
            auto_connect: true,
            retry_at: None,
            program: None,
            save_at: None,
        }
    }
}

impl HidManager {
    /// A disconnected manager that will replay `program` on its first connect.
    pub fn with_program(program: Option<Program>) -> Self {
        HidManager {
            program,
            ..Default::default()
        }
    }

    fn status(&self) -> ConnStatus {
        if self.hid.is_some() {
            ConnStatus::Connected
        } else {
            ConnStatus::Disconnected
        }
    }

    fn close(&mut self) {
        self.hid = None;
        self.device = None;
    }
}

/// The managed-state alias the rest of the app refers to.
pub type HidState = Mutex<HidManager>;

/// Error type surfaced to the WebView. Serializes to a string.
#[derive(Debug, thiserror::Error)]
pub enum HidError {
    #[error("no compatible device found")]
    NotFound,
    #[error("this device does not speak the T02 EQ protocol")]
    Unsupported,
    #[error("device i/o error: {0}")]
    Io(String),
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

/// Lock the manager. A poisoned lock only means another thread panicked while
/// holding it; the data is still a coherent handle + cache, so keep going.
fn lock(state: &HidState) -> MutexGuard<'_, HidManager> {
    state.lock().unwrap_or_else(|e| e.into_inner())
}

/// The connection as the tray and a new window need it: status and the open
/// device.
pub(crate) fn connection(app: &AppHandle) -> (ConnStatus, Option<DeviceInfo>) {
    let state = app.state::<HidState>();
    let mgr = lock(&state);
    (mgr.status(), mgr.device.clone())
}

/// Tell the UI and the tray that the connection status changed.
fn announce(app: &AppHandle, status: ConnStatus) {
    let _ = app.emit(CONN_STATUS_EVENT, status);
    crate::tray::refresh(app);
}

/// Write one HID output report. hidapi takes the report id as the first byte.
fn write_report(dev: &hidapi::HidDevice, report_id: u8, payload: &[u8]) -> CmdResult<()> {
    let mut buf = Vec::with_capacity(payload.len() + 1);
    buf.push(report_id);
    buf.extend_from_slice(payload);
    dev.write(&buf)?;
    Ok(())
}

/// Write a query and wait for its reply (returned without the report id), or
/// `None` if the device stays silent.
fn query(dev: &hidapi::HidDevice, report_id: u8, frame: &[u8]) -> CmdResult<Option<Vec<u8>>> {
    let mut buf = [0u8; 65];
    // Drop anything the device said before this question.
    while dev.read_timeout(&mut buf, 0)? > 0 {}
    write_report(dev, report_id, frame)?;
    for _ in 0..8 {
        let n = dev.read_timeout(&mut buf, 500)?;
        if n == 0 {
            break;
        }
        if n > 2 && buf[0] == report_id && frame.get(1) == Some(&buf[2]) {
            return Ok(Some(buf[1..n].to_vec()));
        }
    }
    Ok(None)
}

fn write_program(dev: &hidapi::HidDevice, program: &Program) -> CmdResult<()> {
    program
        .frames
        .iter()
        .try_for_each(|frame| write_report(dev, program.report_id, frame))
}

/// Human-friendly name from the USB manufacturer / product strings.
fn device_name(d: &hidapi::DeviceInfo) -> String {
    let product = d.product_string().unwrap_or("").trim();
    let manufacturer = d.manufacturer_string().unwrap_or("").trim();
    match (manufacturer.is_empty(), product.is_empty()) {
        (false, false) => format!("{manufacturer} {product}"),
        (true, false) => product.to_string(),
        (false, true) => manufacturer.to_string(),
        (true, true) => "Walkplay DAC".to_string(),
    }
}

/// Find the device to open: the requested (vid, pid), or — when none is given —
/// the first attached EQ device.
fn find_device<'a>(
    api: &'a hidapi::HidApi,
    target: Option<(u16, u16)>,
) -> Option<&'a hidapi::DeviceInfo> {
    api.device_list().find(|d| {
        let id = (d.vendor_id(), d.product_id());
        match target {
            Some(wanted) => id == wanted,
            None => proto::is_eq_device(id.0, id.1),
        }
    })
}

/// Whether the given (or any supported) device is currently attached.
fn is_attached(target: Option<(u16, u16)>) -> Option<bool> {
    let api = hidapi::HidApi::new().ok()?;
    Some(find_device(&api, target).is_some())
}

/// Open a device, replay the cached program on it and store the handle.
/// Announces `connected` on success; leaves the state untouched (and
/// disconnected) on failure.
///
/// The device takes EQ commands as soon as it is open; there is no handshake.
/// (Report 84 with "12345678" is not one — the official app sends it only to
/// start a firmware upgrade over serial.) The one thing sent before the program
/// is [`PROBE`], which a device of another chip family fails.
fn connect_device(
    app: &AppHandle,
    state: &HidState,
    target: Option<(u16, u16)>,
) -> CmdResult<DeviceInfo> {
    // Single-handle invariant: drop whatever was open first.
    let program = {
        let mut mgr = lock(state);
        mgr.close();
        mgr.program.clone()
    };

    let opened: CmdResult<(hidapi::HidDevice, DeviceInfo)> = (|| {
        let api = hidapi::HidApi::new()?;
        let found = find_device(&api, target).ok_or(HidError::NotFound)?;
        let info = DeviceInfo {
            vid: found.vendor_id(),
            pid: found.product_id(),
            name: device_name(found),
        };
        let dev = api.open_path(found.path())?;
        if query(&dev, COMMAND_REPORT, &PROBE)?.is_none() {
            return Err(HidError::Unsupported);
        }
        if let Some(program) = &program {
            write_program(&dev, program)?;
        }
        Ok((dev, info))
    })();

    match opened {
        Ok((dev, info)) => {
            {
                let mut mgr = lock(state);
                mgr.hid = Some(dev);
                mgr.device = Some(info.clone());
                mgr.retry_at = None;
            }
            announce(app, ConnStatus::Connected);
            Ok(info)
        }
        Err(e) => {
            // We closed the previous handle above, so make sure nobody still
            // believes we are connected.
            announce(app, ConnStatus::Disconnected);
            Err(e)
        }
    }
}

/// One tick of the background auto-connect / hot-unplug poller. It owns the
/// connection lifecycle so it keeps working while no window exists.
pub(crate) fn poll_tick(app: &AppHandle) {
    let state = app.state::<HidState>();
    let (open, auto_connect, retry_at) = {
        let mgr = lock(&state);
        (
            mgr.device.as_ref().map(|d| (d.vid, d.pid)),
            mgr.auto_connect,
            mgr.retry_at,
        )
    };

    match open {
        // Connected: watch for hot-unplug. A failed enumeration is treated as
        // "still there" so a transient error does not tear the connection down.
        Some(id) => {
            if is_attached(Some(id)) == Some(false) {
                lock(&state).close();
                announce(app, ConnStatus::Disconnected);
            } else {
                // A save that came due while the device was away goes out now.
                save_if_due(app, false);
            }
        }
        // Disconnected: connect as soon as a supported device shows up.
        None => {
            let waiting = retry_at.is_some_and(|t| Instant::now() < t);
            if auto_connect
                && !waiting
                && is_attached(None) == Some(true)
                && connect_device(app, &state, None).is_err()
            {
                lock(&state).retry_at = Some(Instant::now() + RETRY_BACKOFF);
            }
        }
    }
}

/// Stream a program to the device and remember it for replay.
///
/// When no device is connected this is not an error: the program is cached and
/// goes out on the next (auto-)connect. A failed write means the device went
/// away mid-stream, so the connection is dropped and the failure reported.
pub(crate) fn apply_program(app: &AppHandle, program: Program) -> CmdResult<()> {
    let state = app.state::<HidState>();
    let result = {
        let mut mgr = lock(&state);
        let result = match &mgr.hid {
            Some(dev) => write_program(dev, &program),
            None => Ok(()),
        };
        if result.is_err() {
            mgr.close();
        }
        // A window catching up with a tray pick sends the same frames again,
        // without save frames. That must not cancel the save the pick asked for.
        let resend = program.save_frames.is_empty()
            && mgr.program.as_ref().is_some_and(|p| p.frames == program.frames);
        if !resend {
            mgr.save_at =
                (!program.save_frames.is_empty()).then(|| Instant::now() + SAVE_DELAY);
            mgr.program = Some(program);
        }
        (result, mgr.save_at.is_some())
    };
    let (result, saving) = result;
    if result.is_err() {
        announce(app, ConnStatus::Disconnected);
    }
    if saving {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(SAVE_DELAY);
            save_if_due(&app, false);
        });
    }
    result
}

/// Send the current program's save frames if they are due (or, with `now`,
/// merely pending — used on exit). With no device open they stay pending and
/// go out after the next connect; a newer program replaces them.
pub(crate) fn save_if_due(app: &AppHandle, now: bool) {
    let state = app.state::<HidState>();
    let mut mgr = lock(&state);
    if !mgr.save_at.is_some_and(|due| now || Instant::now() >= due) {
        return;
    }
    let sent = match (&mgr.hid, &mgr.program) {
        (Some(dev), Some(program)) => program
            .save_frames
            .iter()
            .try_for_each(|frame| write_report(dev, program.report_id, frame))
            .is_ok(),
        _ => false,
    };
    if sent {
        mgr.save_at = None;
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Connect on the user's request. Omit `vid`/`pid` to auto-pick a device.
/// Re-arms auto-connect for future hot-plug events.
#[tauri::command]
pub async fn hid_connect(
    app: AppHandle,
    state: State<'_, HidState>,
    vid: Option<u16>,
    pid: Option<u16>,
) -> CmdResult<DeviceInfo> {
    lock(&state).auto_connect = true;
    connect_device(&app, &state, vid.zip(pid))
}

/// Disconnect on the user's request. Idempotent. Disarms auto-connect so the
/// poller does not immediately reconnect.
#[tauri::command]
pub async fn hid_disconnect(app: AppHandle, state: State<'_, HidState>) -> CmdResult<()> {
    {
        let mut mgr = lock(&state);
        mgr.close();
        mgr.auto_connect = false;
    }
    announce(&app, ConnStatus::Disconnected);
    Ok(())
}

/// Apply the UI's current EQ as one program (a single IPC round trip, written
/// atomically under the device lock). `preset_id` names the preset the program
/// equals, if any, so the tray can tick it. `save_frames` are given when the
/// device should keep the program (see [`Program::save_frames`]).
#[tauri::command]
pub async fn hid_apply_program(
    app: AppHandle,
    report_id: u8,
    frames: Vec<Vec<u8>>,
    save_frames: Option<Vec<Vec<u8>>>,
    preset_id: Option<String>,
) -> CmdResult<()> {
    let program = Program {
        report_id,
        frames,
        save_frames: save_frames.unwrap_or_default(),
    };
    crate::tray::record_program(&app, &program, preset_id, false);
    apply_program(&app, program)
}

/// Write frames once, without remembering them — for commands that must not be
/// replayed on reconnect, such as a factory reset. Fails when no device is open.
#[tauri::command]
pub async fn hid_send(
    state: State<'_, HidState>,
    report_id: u8,
    frames: Vec<Vec<u8>>,
) -> CmdResult<()> {
    let mgr = lock(&state);
    let dev = mgr.hid.as_ref().ok_or(HidError::NotFound)?;
    frames
        .iter()
        .try_for_each(|frame| write_report(dev, report_id, frame))
}

/// Ask the device a question: write `frame` and return its reply, without the
/// report id. A reply repeats the query's command byte as its second byte.
#[tauri::command]
pub async fn hid_query(
    state: State<'_, HidState>,
    report_id: u8,
    frame: Vec<u8>,
) -> CmdResult<Vec<u8>> {
    let mgr = lock(&state);
    let dev = mgr.hid.as_ref().ok_or(HidError::NotFound)?;
    query(dev, report_id, &frame)?.ok_or_else(|| HidError::Io("no reply from device".into()))
}
