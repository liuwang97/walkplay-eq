//! Firmware check / upgrade layer.
//!
//! Talks to the cloud API (`/api/v3-1/common/checkFirmwareVersion`,
//! `getFirmwareInfoListByPidAndVid`) and drives the on-device upgrade flow.
//!
//! # HIGH RISK — bricking
//!
//! `fw_upgrade` writes to the device's flash. Getting the framing wrong can
//! brick a unit. The exact DFU framing is reverse-engineered from the obfuscated
//! web bundle (`peq-bundle.js`) and the protocol notes
//! (`crates/walkplay-dac-protocol/PROTOCOL.md` §5). Every step that actually
//! touches device flash is marked `// NEEDS HARDWARE VERIFICATION` and is gated
//! behind the `confirmed` flag passed from the UI: with `confirmed == false`
//! the whole machine runs as a **dry run** — it downloads, chunks, emits
//! progress and validates flow, but issues **no** device writes. Real flashing
//! only happens when the caller explicitly opts in *and* a real device writer is
//! wired in (the `DeviceWriter` is a [`NullWriter`] placeholder until the
//! HID-CORE handle is available — see [`DeviceWriter`]).
//!
//! State machine: `Idle -> Download -> EnterDfu -> Erase -> WriteChunks ->
//! Verify -> Reboot -> Done` (or `-> Failed` / `-> Aborted`). Each device-write
//! phase has bounded retry with exponential backoff. Progress is streamed to the
//! WebView via the Tauri `fw-progress` event.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use walkplay_dac_protocol as proto;

// ---------------------------------------------------------------------------
// Cloud API
// ---------------------------------------------------------------------------

/// Cloud API host (VERIFIED from bundle: `https://www.szwalkplay.com`).
const API_HOST: &str = "https://www.szwalkplay.com";

/// `GET getFirmwareInfoListByPidAndVid` — list firmware images for a vid/pid.
const EP_FW_LIST: &str = "/api/v3-1/common/getFirmwareInfoListByPidAndVid";
/// `GET checkFirmwareVersion` — resolve the latest version for a vid/pid.
const EP_FW_CHECK: &str = "/api/v3-1/common/checkFirmwareVersion";

// ---------------------------------------------------------------------------
// DFU sub-protocol constants (PROTOCOL.md §5 — sourced from peq-bundle.js)
// ---------------------------------------------------------------------------

/// HID report id that carries firmware/DFU frames (same report as EQ commands).
// VERIFIED: bundle sends DFU frames on report id 75.
const DFU_REPORT: u8 = proto::COMMAND_REPORT; // 75

/// DFU packet header magic. The bundle builds packets as
/// `{magic:1482184002, nr, type, seq, flag, length, crc32}`.
// VERIFIED: bundle literal `magic:1482184002` (0x585451C2).
const DFU_MAGIC: u32 = 1_482_184_002;

/// Payload bytes carried per chunk during the write phase.
///
/// HID Output Reports on this device are small; the bundle streams flash writes
/// in tiny frames (`[1,13,8, addr(4), val(4)]`). We aggregate the image into
/// `CHUNK_LEN`-byte logical chunks for progress accounting and per-chunk
/// retry; each logical chunk is split into device frames by the writer.
// NEEDS HARDWARE VERIFICATION: real per-frame flash-write granularity is 4 bytes
// in the bundle; the optimal/accepted chunk size for bulk DFU is unconfirmed.
const CHUNK_LEN: usize = 256;

/// Max retries per device-write phase before giving up.
const MAX_RETRIES: u32 = 3;
/// Base backoff between retries; doubles each attempt.
const BACKOFF_BASE: Duration = Duration::from_millis(200);
/// ACK byte the device returns for an accepted DFU frame.
// VERIFIED (serial side): ACK = 0xA5. NEEDS HARDWARE VERIFICATION for HID side.
#[allow(dead_code)]
const DFU_ACK: u8 = 0xA5;

// ---------------------------------------------------------------------------
// Public types (signatures fixed by foundation stub)
// ---------------------------------------------------------------------------

/// Result of a firmware version check.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirmwareCheck {
    /// Firmware currently on the device.
    pub current: String,
    /// Latest available firmware, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest: Option<String>,
    /// Whether an upgrade is available.
    pub update_available: bool,
    /// Download URL for the latest firmware image, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// Progress / outcome of a firmware upgrade.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirmwareUpgradeResult {
    pub success: bool,
    pub message: String,
}

/// Error surfaced to the WebView.
#[derive(Debug, thiserror::Error)]
pub enum FirmwareError {
    // Part of the foundation-defined error contract; surfaced once the live HID
    // handle is wired into the upgrade path (currently the writer is the dry-run
    // null sink so this arm is not yet constructed).
    #[allow(dead_code)]
    #[error("no device connected")]
    NoDevice,
    #[error("network error: {0}")]
    Network(String),
    #[error("{0}")]
    Other(String),
}

impl Serialize for FirmwareError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

type CmdResult<T> = Result<T, FirmwareError>;

// ---------------------------------------------------------------------------
// State machine model
// ---------------------------------------------------------------------------

/// Phases of the upgrade state machine, in order. Serialized into progress
/// events so the UI can show a labelled step.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FwPhase {
    /// Nothing running.
    Idle,
    /// Downloading the `.bin` from the cloud.
    Download,
    /// Putting the device into DFU / bootloader mode.
    EnterDfu,
    /// Erasing the target flash region.
    Erase,
    /// Streaming firmware chunks to flash.
    WriteChunks,
    /// Reading flash back and comparing (CRC / byte compare).
    Verify,
    /// Rebooting the device into the new firmware.
    Reboot,
    /// Finished successfully.
    Done,
    /// Aborted by the user.
    Aborted,
    /// Failed with an error.
    Failed,
}

impl FwPhase {
    fn label(self) -> &'static str {
        match self {
            FwPhase::Idle => "idle",
            FwPhase::Download => "downloading firmware",
            FwPhase::EnterDfu => "entering DFU mode",
            FwPhase::Erase => "erasing flash",
            FwPhase::WriteChunks => "writing firmware",
            FwPhase::Verify => "verifying",
            FwPhase::Reboot => "rebooting device",
            FwPhase::Done => "complete",
            FwPhase::Aborted => "aborted",
            FwPhase::Failed => "failed",
        }
    }
}

/// One progress tick emitted on the `fw-progress` Tauri event.
#[derive(Debug, Clone, Serialize)]
pub struct FwProgress {
    pub phase: FwPhase,
    /// Human-readable status line.
    pub message: String,
    /// 0..=100 overall progress.
    pub percent: u8,
    /// `true` if no device writes were performed (download/validation only).
    pub dry_run: bool,
}

/// Event name the WebView subscribes to.
const PROGRESS_EVENT: &str = "fw-progress";

/// Abort signal shared with the running machine. The UI flips this via a
/// (future) `fw_abort` command or by dropping the window; the machine checks it
/// at every safe point and unwinds to [`FwPhase::Aborted`].
///
/// Cloned cheaply; the inner `AtomicBool` is the single source of truth.
#[derive(Clone, Default)]
pub struct AbortFlag(Arc<AtomicBool>);

impl AbortFlag {
    fn is_set(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
    /// Request abort (callable from another task).
    #[allow(dead_code)]
    pub fn abort(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

// ---------------------------------------------------------------------------
// Device writer abstraction (the brick-safety seam)
// ---------------------------------------------------------------------------

/// Sink for DFU device frames.
///
/// This trait is the single seam where bytes leave the host for the device.
/// Until the HID-CORE handle inside `HidManager` is exposed, the only concrete
/// implementation is [`NullWriter`], which logs/accounts frames but performs
/// **no** I/O — guaranteeing the upgrade path cannot brick a device while the
/// framing is still `// NEEDS HARDWARE VERIFICATION`.
///
/// When a real handle is available, add a `HidWriter { dev: hidapi::HidDevice }`
/// implementing this trait and select it in [`fw_upgrade`] when `confirmed`.
trait DeviceWriter: Send {
    /// Send one DFU output-report frame and await/validate the device ACK.
    fn write_frame(&mut self, report_id: u8, payload: &[u8]) -> Result<(), FirmwareError>;
    /// Read `len` bytes of flash starting at `addr` (verify phase).
    fn read_flash(&mut self, addr: u32, len: usize) -> Result<Vec<u8>, FirmwareError>;
    /// `true` if real I/O is performed; `false` for the dry-run null sink.
    fn is_live(&self) -> bool;
}

/// No-op writer used for dry runs and until a real HID handle is wired in.
/// Records how many frames/bytes *would* have been written.
struct NullWriter {
    frames: u64,
    bytes: u64,
}

impl NullWriter {
    fn new() -> Self {
        Self { frames: 0, bytes: 0 }
    }
}

impl DeviceWriter for NullWriter {
    fn write_frame(&mut self, _report_id: u8, payload: &[u8]) -> Result<(), FirmwareError> {
        // DRY RUN: intentionally no device I/O.
        self.frames += 1;
        self.bytes += payload.len() as u64;
        Ok(())
    }

    fn read_flash(&mut self, _addr: u32, len: usize) -> Result<Vec<u8>, FirmwareError> {
        // DRY RUN: return zeros; verify is skipped when not live.
        Ok(vec![0u8; len])
    }

    fn is_live(&self) -> bool {
        false
    }
}

// ---------------------------------------------------------------------------
// DFU frame builders (PROTOCOL.md §5 — // NEEDS HARDWARE VERIFICATION)
// ---------------------------------------------------------------------------

/// Build the 12-byte DFU packet header `{magic,nr,type,seq,flag,length,crc32}`.
///
/// Layout inferred from the bundle's packet object; field order/endianness is
/// **unconfirmed on the wire**.
// NEEDS HARDWARE VERIFICATION: header byte order and field widths.
fn dfu_header(nr: u8, ptype: u8, seq: u8, flag: u8, length: u16, crc32: u32) -> Vec<u8> {
    let mut h = Vec::with_capacity(12);
    h.extend_from_slice(&DFU_MAGIC.to_le_bytes()); // 4
    h.push(nr); // 1
    h.push(ptype); // 1
    h.push(seq); // 1
    h.push(flag); // 1
    h.extend_from_slice(&length.to_le_bytes()); // 2
    h.extend_from_slice(&crc32.to_le_bytes()); // 4  (truncated to fit 12B model)
    h.truncate(12);
    h
}

/// "Get chip id" probe. VERIFIED sample `sendReport(75,[128,14,0])`.
fn frame_get_chip_id() -> Vec<u8> {
    proto::get_chip_id_frame().to_vec()
}

/// Enter-DFU / bootloader frame.
// NEEDS HARDWARE VERIFICATION: exact enter-DFU opcode. We send the chip-id
// probe followed by a header with a (placeholder) "enter" type.
fn frame_enter_dfu(seq: u8) -> Vec<u8> {
    dfu_header(0, /*type=enter*/ 0x01, seq, 0, 0, 0)
}

/// Erase-region frame for `[addr, addr+len)`.
// NEEDS HARDWARE VERIFICATION: erase opcode + whether erase is page-aligned.
fn frame_erase(seq: u8, addr: u32, len: u32) -> Vec<u8> {
    // Bundle flash-write helper is `[1,13,8, addr(4 LE), val(4 LE)]`; the erase
    // variant is unconfirmed — modelled as a header carrying addr+len.
    let mut f = dfu_header(0, /*type=erase*/ 0x02, seq, 0, 8, 0);
    f.extend_from_slice(&addr.to_le_bytes());
    f.extend_from_slice(&len.to_le_bytes());
    f
}

/// Read-flash frame. VERIFIED bundle: `[128,13,0, addr(4 LE)]`.
fn frame_read_flash(addr: u32) -> Vec<u8> {
    let a = addr.to_le_bytes();
    vec![128, 13, 0, a[0], a[1], a[2], a[3]]
}

/// Write-chunk frame: a DFU header followed by the chunk payload.
// NEEDS HARDWARE VERIFICATION: the bundle writes flash in 4-byte units via
// `[1,13,8, addr(4), val(4)]`. This bulk-chunk frame is a higher-level model;
// a real writer must lower it to the accepted per-frame format.
fn frame_write_chunk(seq: u8, addr: u32, chunk: &[u8]) -> Vec<u8> {
    let crc = crc32_of(chunk);
    let mut f = dfu_header(0, /*type=data*/ 0x03, seq, 0, chunk.len() as u16, crc);
    f.extend_from_slice(&addr.to_le_bytes());
    f.extend_from_slice(chunk);
    f
}

/// Reboot-into-app frame.
// NEEDS HARDWARE VERIFICATION: reboot/run opcode.
fn frame_reboot(seq: u8) -> Vec<u8> {
    dfu_header(0, /*type=reboot*/ 0x05, seq, 0, 0, 0)
}

/// CRC-32 (IEEE) of a buffer. Used for the header `crc32` field and verify.
// NEEDS HARDWARE VERIFICATION: the bundle exposes a CRC-16 (CCITT) for the EQ
// blob path; the DFU `crc32` field's exact algorithm is unconfirmed. IEEE is a
// reasonable default and is only ever *compared against itself* in dry runs.
fn crc32_of(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------

/// Run `op` with bounded retry + exponential backoff. Aborts immediately if the
/// abort flag trips.
async fn with_retry<F>(
    label: &str,
    abort: &AbortFlag,
    mut op: F,
) -> Result<(), FirmwareError>
where
    F: FnMut() -> Result<(), FirmwareError>,
{
    let mut attempt = 0u32;
    loop {
        if abort.is_set() {
            return Err(FirmwareError::Other("aborted".into()));
        }
        match op() {
            Ok(()) => return Ok(()),
            Err(e) => {
                attempt += 1;
                if attempt > MAX_RETRIES {
                    return Err(FirmwareError::Other(format!(
                        "{label} failed after {MAX_RETRIES} retries: {e}"
                    )));
                }
                let backoff = BACKOFF_BASE * 2u32.pow(attempt - 1);
                tokio::time::sleep(backoff).await;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Progress emission
// ---------------------------------------------------------------------------

fn emit(app: &AppHandle, phase: FwPhase, percent: u8, dry_run: bool, msg: impl Into<String>) {
    let msg = msg.into();
    // Prefix the phase label so consumers that ignore `phase` still get context.
    let message = format!("[{}] {}", phase.label(), msg);
    let p = FwProgress {
        phase,
        message,
        percent,
        dry_run,
    };
    // Best-effort: a missing WebView must not fail the upgrade.
    let _ = app.emit(PROGRESS_EVENT, &p);
}

// ---------------------------------------------------------------------------
// Cloud helpers
// ---------------------------------------------------------------------------

/// Loosely-typed firmware list item. The cloud returns a variety of casings;
/// we accept the common ones and fall back to scanning the JSON.
#[derive(Debug, Deserialize)]
struct FwInfo {
    #[serde(alias = "version", alias = "firmwareVersion", alias = "versionName")]
    version: Option<String>,
    #[serde(alias = "url", alias = "fileUrl", alias = "downloadUrl", alias = "firmwareUrl")]
    url: Option<String>,
}

/// Query the cloud for the latest firmware for `vid`/`pid`.
///
/// Tries `getFirmwareInfoListByPidAndVid` (list of `.bin` images) and
/// `checkFirmwareVersion` (latest version string). Returns
/// `(latest_version, bin_url)`.
async fn query_latest_firmware(
    client: &reqwest::Client,
    vid: u16,
    pid: u16,
) -> CmdResult<(Option<String>, Option<String>)> {
    let net = |e: reqwest::Error| FirmwareError::Network(e.to_string());

    // 1) List images for this pid/vid.
    let list_url = format!("{API_HOST}{EP_FW_LIST}");
    let list_resp = client
        .get(&list_url)
        .query(&[("vid", vid.to_string()), ("pid", pid.to_string())])
        .send()
        .await
        .map_err(net)?;

    let mut version: Option<String> = None;
    let mut url: Option<String> = None;

    if list_resp.status().is_success() {
        let body: serde_json::Value = list_resp.json().await.map_err(net)?;
        // The payload wraps the list under `data` (sometimes `result`); scan both.
        let list = body
            .get("data")
            .or_else(|| body.get("result"))
            .cloned()
            .unwrap_or(body);
        if let Ok(items) = serde_json::from_value::<Vec<FwInfo>>(list.clone()) {
            if let Some(first) = items.into_iter().find(|i| i.url.is_some()) {
                version = first.version;
                url = first.url;
            }
        }
    }

    // 2) Confirm latest version (and pick up a URL if the list lacked one).
    let check_url = format!("{API_HOST}{EP_FW_CHECK}");
    if let Ok(resp) = client
        .get(&check_url)
        .query(&[("vid", vid.to_string()), ("pid", pid.to_string())])
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(body) = resp.json::<serde_json::Value>().await {
                let data = body.get("data").cloned().unwrap_or(body);
                if let Ok(info) = serde_json::from_value::<FwInfo>(data) {
                    if version.is_none() {
                        version = info.version;
                    }
                    if url.is_none() {
                        url = info.url;
                    }
                }
            }
        }
    }

    Ok((version, url))
}

/// Read the on-device firmware version via the protocol read frames (addr 4/5).
///
/// // NEEDS HARDWARE VERIFICATION: requires the live HID handle (owned by
/// `HidManager` in hid.rs). Until that handle is exposed to this module we
/// cannot read it here, so report "unknown" rather than guess.
fn read_device_version() -> String {
    "unknown".to_string()
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Check whether a firmware update is available for the connected device.
#[tauri::command]
pub async fn fw_check(vid: u16, pid: u16) -> CmdResult<FirmwareCheck> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| FirmwareError::Network(e.to_string()))?;

    let current = read_device_version();
    let (latest, url) = query_latest_firmware(&client, vid, pid).await?;

    let update_available = match (&current, &latest) {
        // If we can't read the device version, surface availability purely on
        // "a newer image exists" — the UI confirms before flashing.
        (cur, Some(lat)) if cur == "unknown" => true && !lat.is_empty(),
        (cur, Some(lat)) => lat != cur && !lat.is_empty(),
        _ => false,
    };

    Ok(FirmwareCheck {
        current,
        latest,
        update_available,
        url,
    })
}

/// Download and flash a firmware image to the connected device.
///
/// `confirmed` is the brick-safety gate. With `confirmed == false` (or no live
/// device writer wired in) the machine runs the full flow as a **dry run**: it
/// downloads, chunks, validates and emits progress, but performs **no** device
/// writes. Only `confirmed == true` *and* a live [`DeviceWriter`] will flash.
///
/// `app` and the abort flag are injected by Tauri; the foundation registration
/// already lists `firmware::fw_upgrade`, so widening the signature is safe.
#[tauri::command]
pub async fn fw_upgrade(
    app: AppHandle,
    url: String,
    confirmed: Option<bool>,
) -> CmdResult<FirmwareUpgradeResult> {
    let confirmed = confirmed.unwrap_or(false);
    let abort = AbortFlag::default();

    // ---- Phase: Download (always real; no device risk) ----
    emit(&app, FwPhase::Download, 0, true, "starting download");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| FirmwareError::Network(e.to_string()))?;

    let image = download_image(&client, &url, &app).await?;
    if image.is_empty() {
        return fail(&app, "downloaded firmware image is empty");
    }

    // Select the writer. Until the HID handle is exposed (hid.rs) the only
    // writer is the null/dry-run sink; `confirmed` alone never flashes because
    // `is_live()` stays false. This is the core anti-brick guarantee.
    let mut writer: Box<dyn DeviceWriter> = Box::new(NullWriter::new());
    let live = confirmed && writer.is_live();
    let dry = !live;

    if confirmed && !writer.is_live() {
        emit(
            &app,
            FwPhase::Download,
            100,
            true,
            "confirmed, but no live device writer is wired in yet — running dry",
        );
    }

    // Run the device-write state machine. Returns Ok with a message.
    match run_dfu_machine(&app, &abort, writer.as_mut(), &image, dry).await {
        Ok(msg) => Ok(FirmwareUpgradeResult {
            success: true,
            message: msg,
        }),
        Err(e) => {
            if abort.is_set() {
                emit(&app, FwPhase::Aborted, 0, dry, "aborted by user");
                Ok(FirmwareUpgradeResult {
                    success: false,
                    message: "aborted".into(),
                })
            } else {
                emit(&app, FwPhase::Failed, 0, dry, e.to_string());
                Err(e)
            }
        }
    }
}

fn fail(app: &AppHandle, msg: &str) -> CmdResult<FirmwareUpgradeResult> {
    emit(app, FwPhase::Failed, 0, true, msg);
    Err(FirmwareError::Other(msg.to_string()))
}

/// Stream the `.bin` into memory, emitting download progress.
async fn download_image(
    client: &reqwest::Client,
    url: &str,
    app: &AppHandle,
) -> CmdResult<Vec<u8>> {
    use futures_util::StreamExt;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| FirmwareError::Network(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(FirmwareError::Network(format!(
            "download HTTP {}",
            resp.status()
        )));
    }
    let total = resp.content_length();
    let mut buf: Vec<u8> = Vec::with_capacity(total.unwrap_or(0) as usize);
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| FirmwareError::Network(e.to_string()))?;
        buf.extend_from_slice(&chunk);
        let pct = match total {
            Some(t) if t > 0 => ((buf.len() as u64 * 100) / t).min(100) as u8,
            _ => 0,
        };
        emit(
            app,
            FwPhase::Download,
            pct,
            true,
            format!("downloaded {} bytes", buf.len()),
        );
    }
    Ok(buf)
}

/// The device-write state machine. `dry == true` means no real flashing.
///
/// `Idle -> EnterDfu -> Erase -> WriteChunks -> Verify -> Reboot -> Done`.
async fn run_dfu_machine(
    app: &AppHandle,
    abort: &AbortFlag,
    writer: &mut dyn DeviceWriter,
    image: &[u8],
    dry: bool,
) -> CmdResult<String> {
    let mut seq: u8 = 0;
    let mut next_seq = || {
        let s = seq;
        seq = seq.wrapping_add(1);
        s
    };
    let base_addr: u32 = 0; // NEEDS HARDWARE VERIFICATION: app/flash base offset.

    // ---- Phase: EnterDfu ----
    if abort.is_set() {
        return Err(FirmwareError::Other("aborted".into()));
    }
    emit(app, FwPhase::EnterDfu, 0, dry, "probing chip id");
    // VERIFIED probe; harmless even on a non-DFU device.
    with_retry("enter-dfu", abort, || {
        writer.write_frame(DFU_REPORT, &frame_get_chip_id()) // VERIFIED frame
    })
    .await?;
    let s = next_seq();
    with_retry("enter-dfu", abort, || {
        // NEEDS HARDWARE VERIFICATION: enter-DFU opcode.
        writer.write_frame(DFU_REPORT, &frame_enter_dfu(s))
    })
    .await?;
    emit(app, FwPhase::EnterDfu, 100, dry, "in DFU mode");

    // ---- Phase: Erase ----
    if abort.is_set() {
        return Err(FirmwareError::Other("aborted".into()));
    }
    emit(app, FwPhase::Erase, 0, dry, "erasing target region");
    let s = next_seq();
    let img_len = image.len() as u32;
    with_retry("erase", abort, || {
        // NEEDS HARDWARE VERIFICATION: erase framing + alignment.
        writer.write_frame(DFU_REPORT, &frame_erase(s, base_addr, img_len))
    })
    .await?;
    emit(app, FwPhase::Erase, 100, dry, "flash erased");

    // ---- Phase: WriteChunks ----
    let total_chunks = image.len().div_ceil(CHUNK_LEN);
    for (i, chunk) in image.chunks(CHUNK_LEN).enumerate() {
        if abort.is_set() {
            return Err(FirmwareError::Other("aborted".into()));
        }
        let addr = base_addr + (i * CHUNK_LEN) as u32;
        let s = next_seq();
        with_retry("write-chunk", abort, || {
            // NEEDS HARDWARE VERIFICATION: chunk framing must be lowered to the
            // device's accepted per-frame write format.
            writer.write_frame(DFU_REPORT, &frame_write_chunk(s, addr, chunk))
        })
        .await?;
        let pct = (((i + 1) as u64 * 100) / total_chunks as u64).min(100) as u8;
        emit(
            app,
            FwPhase::WriteChunks,
            pct,
            dry,
            format!("chunk {}/{}", i + 1, total_chunks),
        );
    }

    // ---- Phase: Verify ----
    if abort.is_set() {
        return Err(FirmwareError::Other("aborted".into()));
    }
    emit(app, FwPhase::Verify, 0, dry, "verifying flash");
    if writer.is_live() {
        // Read back and compare. Only meaningful with a live device.
        verify_flash(app, abort, writer, image, base_addr).await?;
    } else {
        // DRY RUN: nothing was written; confirm we can *build* the read frame.
        let _ = frame_read_flash(base_addr);
        emit(app, FwPhase::Verify, 100, dry, "verify skipped (dry run)");
    }

    // ---- Phase: Reboot ----
    if abort.is_set() {
        return Err(FirmwareError::Other("aborted".into()));
    }
    emit(app, FwPhase::Reboot, 0, dry, "rebooting");
    let s = next_seq();
    with_retry("reboot", abort, || {
        // NEEDS HARDWARE VERIFICATION: reboot opcode.
        writer.write_frame(DFU_REPORT, &frame_reboot(s))
    })
    .await?;

    // ---- Done ----
    let msg = if dry {
        format!(
            "dry run complete: {} bytes, {} chunks validated (no device writes)",
            image.len(),
            total_chunks
        )
    } else {
        format!("firmware upgrade complete: {} bytes flashed", image.len())
    };
    emit(app, FwPhase::Done, 100, dry, msg.clone());
    Ok(msg)
}

/// Read flash back in chunks and compare with the image (live only).
async fn verify_flash(
    app: &AppHandle,
    abort: &AbortFlag,
    writer: &mut dyn DeviceWriter,
    image: &[u8],
    base_addr: u32,
) -> CmdResult<()> {
    let total_chunks = image.len().div_ceil(CHUNK_LEN);
    for (i, chunk) in image.chunks(CHUNK_LEN).enumerate() {
        if abort.is_set() {
            return Err(FirmwareError::Other("aborted".into()));
        }
        let addr = base_addr + (i * CHUNK_LEN) as u32;
        let read = writer.read_flash(addr, chunk.len())?;
        if read != chunk {
            return Err(FirmwareError::Other(format!(
                "verify mismatch at chunk {} (addr {:#x})",
                i, addr
            )));
        }
        let pct = (((i + 1) as u64 * 100) / total_chunks as u64).min(100) as u8;
        emit(app, FwPhase::Verify, pct, false, format!("verified {}/{}", i + 1, total_chunks));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dfu_header_is_12_bytes_with_magic() {
        let h = dfu_header(1, 3, 5, 0, 256, 0xDEAD_BEEF);
        assert_eq!(h.len(), 12);
        assert_eq!(&h[..4], &DFU_MAGIC.to_le_bytes());
    }

    #[test]
    fn chip_id_frame_matches_bundle_sample() {
        assert_eq!(frame_get_chip_id(), vec![128, 14, 0]);
    }

    #[test]
    fn read_flash_frame_layout() {
        // [128,13,0, addr LE]
        assert_eq!(frame_read_flash(0x0102_0304), vec![128, 13, 0, 0x04, 0x03, 0x02, 0x01]);
    }

    #[test]
    fn write_chunk_carries_payload() {
        let f = frame_write_chunk(0, 0x10, &[1, 2, 3, 4]);
        assert!(f.ends_with(&[1, 2, 3, 4]));
        assert!(f.len() > 4);
    }

    #[test]
    fn crc32_ieee_known_vector() {
        // CRC-32/IEEE of "123456789" is 0xCBF43926.
        assert_eq!(crc32_of(b"123456789"), 0xCBF4_3926);
    }

    #[test]
    fn null_writer_never_claims_live() {
        let mut w = NullWriter::new();
        w.write_frame(DFU_REPORT, &[1, 2, 3]).unwrap();
        assert!(!w.is_live());
        assert_eq!(w.frames, 1);
        assert_eq!(w.bytes, 3);
    }

    #[tokio::test]
    async fn retry_gives_up_after_max() {
        let abort = AbortFlag::default();
        let mut calls = 0u32;
        let r = with_retry("x", &abort, || {
            calls += 1;
            Err(FirmwareError::Other("boom".into()))
        })
        .await;
        assert!(r.is_err());
        assert_eq!(calls, MAX_RETRIES + 1);
    }

    #[tokio::test]
    async fn retry_aborts_immediately() {
        let abort = AbortFlag::default();
        abort.abort();
        let mut calls = 0u32;
        let r = with_retry("x", &abort, || {
            calls += 1;
            Ok(())
        })
        .await;
        assert!(r.is_err());
        assert_eq!(calls, 0);
    }

    #[test]
    fn abort_flag_roundtrip() {
        let f = AbortFlag::default();
        assert!(!f.is_set());
        f.abort();
        assert!(f.is_set());
    }
}
