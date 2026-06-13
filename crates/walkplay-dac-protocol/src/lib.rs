//! Walkplay DAC wire protocol.
//!
//! The hardware speaks a custom HID Output Report protocol. This crate owns the
//! byte-level encoding/decoding so the rest of the app never hand-rolls frames.
//!
//! Confirmed samples from the original web bundle:
//! ```text
//! sendReport(84, [49,50,51,52,53,54,55,56,0,0])  // Report ID 84 = ASCII "12345678" handshake/auth
//! sendReport(75, [128,14,0])                      // Report ID 75 = a command frame
//! ```
//!
//! NOTE (FOUNDATION): this is a STUB establishing the public API surface.
//! The PROTOCOL agent fills in the real encoding. Symbols here are the
//! cross-agent contract and must not be renamed without coordination.

#![allow(clippy::missing_const_for_fn)]

use serde::{Deserialize, Serialize};

/// HID Report ID of the handshake / auth frame (ASCII "12345678").
pub const HANDSHAKE_REPORT: u8 = 84;

/// Payload of the handshake frame: ASCII "12345678" padded to 10 bytes.
pub const HANDSHAKE_PAYLOAD: [u8; 10] = [49, 50, 51, 52, 53, 54, 55, 56, 0, 0];

/// HID Report ID used for command frames (e.g. band/preamp writes). Tentative.
pub const COMMAND_REPORT: u8 = 75;

/// Primary device identifiers.
pub const PRIMARY_VID: u16 = 0x0666;
pub const PRIMARY_PID: u16 = 0x0888;

/// Compatible vendor whitelist. `0x0D8C` is C-Media.
pub const VID_WHITELIST: &[u16] = &[
    0x3302, 0x0762, 0x35D8, 0x2FC6, 0x0104, 0xB44D, 0x0661, 0x0666, 0x0D8C, 0x0663, 0x0C3C,
];

/// Serial (CDC) fallback device identifiers: (VID, PID).
pub const SERIAL_DEVICES: &[(u16, u16)] = &[(0x31B2, 0xFFF8), (0x8888, 0xCDC0)];

/// Serial fallback baud rate.
pub const SERIAL_BAUD: u32 = 115_200;

/// Number of parametric EQ bands the device exposes.
pub const NUM_BANDS: usize = 10;

/// Filter type for a single EQ band.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FilterType {
    /// Peaking.
    Peaking,
    /// Low shelf.
    LowShelf,
    /// High shelf.
    HighShelf,
}

/// One EQ band as it travels over the wire.
///
/// This is the protocol-side representation; the UI/store uses its own
/// `EqBand` shape and the HID layer maps between them.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct EqBandWire {
    /// Zero-based band index (0..NUM_BANDS).
    pub index: u8,
    /// Center / corner frequency in Hz.
    pub freq: f32,
    /// Q factor.
    pub q: f32,
    /// Gain in dB.
    pub gain: f32,
    /// Filter type.
    pub filter: FilterType,
    /// Whether the band is enabled.
    pub enabled: bool,
}

/// Encode a single band write into a HID Output Report payload (report id + bytes).
///
/// STUB: the PROTOCOL agent implements the real layout.
pub fn encode_band(_band: &EqBandWire) -> Vec<u8> {
    todo!("PROTOCOL agent: encode band frame")
}

/// Encode a preamp / pre-gain write into a HID Output Report payload.
///
/// `preamp_db` is the global pre-gain in dB (range roughly -16..6).
///
/// STUB: the PROTOCOL agent implements the real layout.
pub fn encode_preamp(_preamp_db: f32) -> Vec<u8> {
    todo!("PROTOCOL agent: encode preamp frame")
}

/// Build the handshake frame payload (report id is [`HANDSHAKE_REPORT`]).
pub fn handshake_frame() -> Vec<u8> {
    HANDSHAKE_PAYLOAD.to_vec()
}

/// Whether a given vendor id is on the compatible whitelist.
pub fn is_supported_vid(vid: u16) -> bool {
    VID_WHITELIST.contains(&vid)
}

/// Whether (vid, pid) is the primary device.
pub fn is_primary(vid: u16, pid: u16) -> bool {
    vid == PRIMARY_VID && pid == PRIMARY_PID
}

/// Stateful codec for framing/deframing a stream of device messages.
///
/// STUB: the PROTOCOL agent fleshes this out (sequencing, ack handling, etc.).
#[derive(Debug, Default)]
pub struct Codec {
    _private: (),
}

impl Codec {
    /// Create a fresh codec.
    pub fn new() -> Self {
        Self { _private: () }
    }

    /// Decode an EQ-readback report into bands.
    ///
    /// STUB: the PROTOCOL agent implements parsing of a device readback frame.
    pub fn decode_eq(&self, _report: &[u8]) -> Option<Vec<EqBandWire>> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handshake_payload_is_ascii_12345678_padded() {
        assert_eq!(&HANDSHAKE_PAYLOAD[..8], b"12345678");
        assert_eq!(&HANDSHAKE_PAYLOAD[8..], &[0, 0]);
    }

    #[test]
    fn primary_vid_pid() {
        assert_eq!(PRIMARY_VID, 0x0666);
        assert_eq!(PRIMARY_PID, 0x0888);
        assert!(is_primary(PRIMARY_VID, PRIMARY_PID));
    }

    #[test]
    fn whitelist_contains_primary() {
        assert!(is_supported_vid(PRIMARY_VID));
    }
}
