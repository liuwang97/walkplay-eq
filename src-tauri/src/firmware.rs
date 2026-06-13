//! Firmware check / upgrade layer.
//!
//! Talks to the cloud API (`/api/v3-1/common/checkFirmwareVersion`,
//! `getFirmwareInfoListByPidAndVid`) and drives the on-device upgrade flow.
//!
//! FOUNDATION STUB: signatures + types are final. The FIRMWARE agent fills bodies.

use serde::{Deserialize, Serialize};

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

/// Check whether a firmware update is available for the connected device.
#[tauri::command]
pub async fn fw_check(vid: u16, pid: u16) -> CmdResult<FirmwareCheck> {
    let _ = (vid, pid);
    // FIRMWARE: read on-device version, query cloud, compare.
    todo!("FIRMWARE agent: implement fw_check")
}

/// Download and flash a firmware image to the connected device.
#[tauri::command]
pub async fn fw_upgrade(url: String) -> CmdResult<FirmwareUpgradeResult> {
    let _ = url;
    // FIRMWARE: download image, push to device, report progress/result.
    todo!("FIRMWARE agent: implement fw_upgrade")
}
