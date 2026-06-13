//! Walkplay DAC wire protocol.
//!
//! The hardware speaks a custom HID Output Report protocol. This crate owns the
//! byte-level encoding/decoding so the rest of the app never hand-rolls frames.
//!
//! # Provenance
//!
//! This codec was reverse-engineered from the original web bundle
//! (`peq-bundle.js`, Vue3 + Element Plus). Every encoding is marked:
//!
//! * `// VERIFIED` — byte layout taken directly from the bundle source.
//! * `// INFERRED` — derived by reasoning about the bundle; needs hardware
//!   confirmation before it can be fully trusted.
//!
//! # Device families found in the bundle
//!
//! The bundle ships several device-class drivers. The two that matter:
//!
//! * **Register protocol (primary, Report ID 75).** 10-byte command frames
//!   `[addr, 0, 0, 0, cmd, 0, d0, d1, d2, d3]`. `cmd` is an ASCII letter:
//!   `'R'`(0x52)=read, `'W'`(0x57)=write, `'S'`(0x53)=save, `'C'`(0x43)=reset.
//!   EQ bands live at register addresses starting at a per-variant base; the
//!   primary device uses base 32 (0x20). Frequency, Q and gain are packed as
//!   little-endian integers with fixed scaling. This is what [`encode_band`],
//!   [`encode_preamp`], [`Codec::decode_eq`] implement.
//! * **`calcCoeff` packet protocol (CB1100AU class).** Computes raw RBJ biquad
//!   coefficients host-side, frames them as an `"EQ1#"` blob with a
//!   CRC-16/XMODEM trailer, then chunks the blob across HID reports. We expose
//!   the helpers ([`crc16_xmodem`], [`preamp_linear`]) but the primary path is
//!   the register protocol above.
//!
//! Confirmed samples from the original web bundle:
//! ```text
//! sendReport(84, [49,50,51,52,53,54,55,56,0,0])  // Report ID 84 = ASCII "12345678" handshake/auth
//! sendReport(75, [128,14,0])                      // Report ID 75 = "get chip id" (firmware/DFU framing)
//! ```

#![allow(clippy::missing_const_for_fn)]

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Identity / handshake (VERIFIED from bundle)
// ---------------------------------------------------------------------------

/// HID Report ID of the handshake / auth frame (ASCII "12345678").
// VERIFIED: bundle calls `sendReport(84, new Uint8Array([49,50,51,52,53,54,55,56,0,0]))`.
pub const HANDSHAKE_REPORT: u8 = 84;

/// Payload of the handshake frame: ASCII "12345678" padded to 10 bytes.
// VERIFIED: literal bytes from the bundle.
pub const HANDSHAKE_PAYLOAD: [u8; 10] = [49, 50, 51, 52, 53, 54, 55, 56, 0, 0];

/// HID Report ID used for the primary register command protocol (band/preamp
/// writes, reads, save, reset).
// VERIFIED: the primary device class sets `this.reportId = 75` and all
// `deviceWrite`/`deviceRead` calls go out on report id 75.
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

// ---------------------------------------------------------------------------
// Register protocol constants (VERIFIED from bundle)
// ---------------------------------------------------------------------------

/// Command byte for a register WRITE frame (ASCII `'W'`).
// VERIFIED: every write frame template is `[addr,0,0,0,87,0,...]` (87 = 'W').
pub const CMD_WRITE: u8 = b'W'; // 0x57 = 87

/// Command byte for a register READ frame (ASCII `'R'`).
// VERIFIED: read frame templates are `[addr,0,0,0,82,0,...]` (82 = 'R').
pub const CMD_READ: u8 = b'R'; // 0x52 = 82

/// Command byte for the "save" frame (ASCII `'S'`).
// INFERRED: save register frames use cmd byte 83 ('S'); the dedicated
// "flush to flash" helper instead sends `[1,1,0]`. Treat as INFERRED until a
// real device confirms which save path the primary firmware honours.
pub const CMD_SAVE: u8 = b'S'; // 0x53 = 83

/// Command byte for the factory-reset frame (ASCII `'C'`).
// VERIFIED: `resetDevice()` for the primary class sends `[0,0,0,0,67,...]` (67 = 'C').
pub const CMD_RESET: u8 = b'C'; // 0x43 = 67

/// Base register address of the EQ band block on the primary device.
// VERIFIED: `setEqInfo` for the primary class computes
//   addr = 2*(s+1)-2 + 32  and  2*(s+1)-1 + 32   (s = band index).
// Other device variants use base 53 or 66 for DAC EQ and 38/66 for ADC EQ.
pub const EQ_BASE_ADDR: u8 = 32;

/// Register address holding the EQ "tag id" (preset id), written before bands.
// VERIFIED: the primary class writes the tag-id frame at addr 22 (0x16).
pub const EQ_TAG_ADDR: u8 = 22;

/// Register address of the DAC pre-gain / preamp offset.
// VERIFIED: `setDacOffset` sends frame `[87,0,0,0,87,0,...]` — addr 87 (0x57).
pub const PREAMP_ADDR: u8 = 87;

/// Q23 fixed-point scale used by the `calcCoeff` biquad path. (`1 << 23`.)
// VERIFIED: bundle defines `GAIN_Q = 1 << 23`.
pub const GAIN_Q: i64 = 1 << 23;

/// Q27 fixed-point scale used by the `calcCoeff` biquad path. (`1 << 27`.)
// VERIFIED: bundle defines `COEFF_Q = 1 << 27`.
pub const COEFF_Q: i64 = 1 << 27;

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

/// Filter type for a single EQ band.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FilterType {
    /// Peaking.
    Peaking,
    /// Low shelf.
    LowShelf,
    /// High shelf.
    HighShelf,
    /// Low pass.
    LowPass,
    /// High pass.
    HighPass,
}

impl FilterType {
    /// Type code as written into the register-protocol EQ frame.
    ///
    /// The wire byte is `8 + (code & 7)` (see [`encode_band`]).
    // VERIFIED: primary device type map is `{PK:0, LP:1, HP:2, LS:3, HS:4}`.
    pub fn wire_code(self) -> u8 {
        match self {
            FilterType::Peaking => 0,
            FilterType::LowPass => 1,
            FilterType::HighPass => 2,
            FilterType::LowShelf => 3,
            FilterType::HighShelf => 4,
        }
    }

    /// Decode a type code (the low 3 bits of the on-wire type byte).
    pub fn from_wire_code(code: u8) -> Option<Self> {
        match code & 0x07 {
            0 => Some(FilterType::Peaking),
            1 => Some(FilterType::LowPass),
            2 => Some(FilterType::HighPass),
            3 => Some(FilterType::LowShelf),
            4 => Some(FilterType::HighShelf),
            _ => None,
        }
    }
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

// ---------------------------------------------------------------------------
// Low-level frame helpers
// ---------------------------------------------------------------------------

/// Two's-complement narrowing used everywhere in the bundle (`toSignedByte`).
///
/// The JS does `e > 127 ? e - 256 : e` on each already-masked byte. Since we
/// emit `u8`, the bit pattern is identical; this helper exists for parity and
/// for documenting intent.
// VERIFIED: `toSignedByte(e){ return e>127 ? e-256 : e; }`.
#[inline]
pub fn to_signed_byte(b: u8) -> i8 {
    b as i8
}

/// Build a raw 10-byte register frame: `[addr, 0, 0, 0, cmd, 0, d0, d1, d2, d3]`.
///
/// `data` is the 4-byte little-endian payload (bytes 6..10).
// VERIFIED: every register write/read in the primary class uses this exact
// 10-byte template with data in bytes 6..=9.
pub fn register_frame(addr: u8, cmd: u8, data: [u8; 4]) -> [u8; 10] {
    [addr, 0, 0, 0, cmd, 0, data[0], data[1], data[2], data[3]]
}

#[inline]
fn le16(v: i32) -> [u8; 2] {
    let u = (v as i64 & 0xFFFF) as u16;
    [(u & 0xFF) as u8, ((u >> 8) & 0xFF) as u8]
}

#[inline]
fn le32(v: i64) -> [u8; 4] {
    let u = (v & 0xFFFF_FFFF) as u32;
    [
        (u & 0xFF) as u8,
        ((u >> 8) & 0xFF) as u8,
        ((u >> 16) & 0xFF) as u8,
        ((u >> 24) & 0xFF) as u8,
    ]
}

// ---------------------------------------------------------------------------
// Scaling (VERIFIED — straight from the bundle's setEqInfo)
// ---------------------------------------------------------------------------

/// Encode a frequency (Hz) into its on-wire 16-bit value: `round(freq / 2)`.
// VERIFIED: `const i = freqs[s] / 2;` then `i & 0xFF`, `(i>>8) & 0xFF`.
pub fn encode_freq(freq_hz: f32) -> i32 {
    (freq_hz / 2.0).round() as i32
}

/// Decode an on-wire frequency value back to Hz.
pub fn decode_freq(raw: i32) -> f32 {
    (raw * 2) as f32
}

/// Encode a Q factor into its on-wire 16-bit value: `parseInt(1000 * q)`.
// VERIFIED: `const u = parseInt(1e3 * qs[s]);`.
pub fn encode_q(q: f32) -> i32 {
    (q * 1000.0).trunc() as i32
}

/// Decode an on-wire Q value back to a float.
pub fn decode_q(raw: i32) -> f32 {
    raw as f32 / 1000.0
}

/// Encode a gain (dB) into its on-wire 16-bit value: `parseInt(10 * gain)`.
// VERIFIED: `const c = parseInt(10 * gains[s]);`.
pub fn encode_gain(gain_db: f32) -> i32 {
    (gain_db * 10.0).trunc() as i32
}

/// Decode an on-wire gain value back to dB.
pub fn decode_gain(raw: i32) -> f32 {
    raw as f32 / 10.0
}

// ---------------------------------------------------------------------------
// Public encoders
// ---------------------------------------------------------------------------

/// Encode a single band write for the register (Report ID 75) protocol.
///
/// Returns the two 10-byte frames the bundle emits per band, concatenated:
///
/// * Frame A (`addr = base + 2*index`): gain (int16 LE, ×10) in bytes 6..8,
///   freq (int16 LE, freq/2) in bytes 8..10.
/// * Frame B (`addr = base + 2*index + 1`): Q (int16 LE, ×1000) in bytes 6..8,
///   type byte `8 + (type & 7)` in byte 8, byte 9 = 0.
///
/// Note the *enabled* flag is not represented here on the primary device — the
/// register protocol does not carry a per-band enable. (The `0x3F5AA5` variant
/// writes a separate enable register; see `PROTOCOL.md`.) Disabled bands are
/// expected to be flattened to 0 dB / Peaking by the caller, mirroring the web
/// app.
///
/// `base` is the device EQ base address ([`EQ_BASE_ADDR`] for the primary
/// device; pass 53 or 66 for the alternate DAC variants).
// VERIFIED: byte-for-byte from primary-class `setEqInfo`.
pub fn encode_band_at(band: &EqBandWire, base: u8) -> [u8; 20] {
    let s = band.index as i32;
    let addr_a = (base as i32 + 2 * s) as u8; // 2*(s+1)-2 + base
    let addr_b = (base as i32 + 2 * s + 1) as u8; // 2*(s+1)-1 + base

    let gain = le16(encode_gain(band.gain));
    let freq = le16(encode_freq(band.freq));
    let q = le16(encode_q(band.q));
    let type_byte = 8 + (band.filter.wire_code() & 0x07);

    let frame_a = register_frame(addr_a, CMD_WRITE, [gain[0], gain[1], freq[0], freq[1]]);
    let frame_b = register_frame(addr_b, CMD_WRITE, [q[0], q[1], type_byte, 0]);

    let mut out = [0u8; 20];
    out[..10].copy_from_slice(&frame_a);
    out[10..].copy_from_slice(&frame_b);
    out
}

/// Encode a single band write using the primary device's base address.
///
/// The returned 20 bytes are two 10-byte HID Output Report payloads (frame A
/// then frame B) to send on [`COMMAND_REPORT`].
pub fn encode_band(band: &EqBandWire) -> Vec<u8> {
    encode_band_at(band, EQ_BASE_ADDR).to_vec()
}

/// Encode the EQ "tag id" (preset id) frame written before the band block.
// VERIFIED: `saveEqTagId(e)` -> `[22,0,0,0,87,0, e&0xFF, e>>8, e>>16, e>>24]`.
pub fn encode_eq_tag(tag_id: u32) -> [u8; 10] {
    register_frame(EQ_TAG_ADDR, CMD_WRITE, le32(tag_id as i64))
}

/// Encode a preamp / pre-gain write into a HID Output Report payload.
///
/// `preamp_db` is the global pre-gain in dB (range roughly -16..6). The wire
/// value is `-10 * preamp_db` as a signed int32 LE in bytes 6..10 of the
/// `[87,0,0,0,'W',0,...]` frame. Note the **negation**: a +6 dB preamp encodes
/// to -60, a -16 dB preamp encodes to +160.
// VERIFIED: `setDacOffset(e){ a = -10 * e; n[6..9] = a (int32 LE); }`.
pub fn encode_preamp(preamp_db: f32) -> Vec<u8> {
    let a = (-10.0 * preamp_db).round() as i64;
    register_frame(PREAMP_ADDR, CMD_WRITE, le32(a)).to_vec()
}

/// Build the handshake frame payload (report id is [`HANDSHAKE_REPORT`]).
pub fn handshake_frame() -> Vec<u8> {
    HANDSHAKE_PAYLOAD.to_vec()
}

/// Build the factory-reset frame payload (sent on [`COMMAND_REPORT`]).
// VERIFIED: primary `resetDevice()` -> `[0,0,0,0,67,0,0,0,0,0]`.
pub fn factory_reset_frame() -> [u8; 10] {
    register_frame(0, CMD_RESET, [0, 0, 0, 0])
}

/// "Flush cached registers to volatile memory" command.
// VERIFIED: `refereshToMemery()` (sic) -> `[1,10,4,0,0,255,255]`.
pub fn flush_to_memory_frame() -> [u8; 7] {
    [1, 10, 4, 0, 0, 255, 255]
}

/// "Persist registers to flash" command.
// VERIFIED: `refereshToFlash()` -> `[1,1,0]`.
pub fn flush_to_flash_frame() -> [u8; 3] {
    [1, 1, 0]
}

/// "Get chip id" firmware frame (Report ID 75). Confirmed sample.
// VERIFIED: `sendReport(75, new Uint8Array([128,14,0]))` -> get chip id.
pub fn get_chip_id_frame() -> [u8; 3] {
    [128, 14, 0]
}

/// Whether a given vendor id is on the compatible whitelist.
pub fn is_supported_vid(vid: u16) -> bool {
    VID_WHITELIST.contains(&vid)
}

/// Whether (vid, pid) is the primary device.
pub fn is_primary(vid: u16, pid: u16) -> bool {
    vid == PRIMARY_VID && pid == PRIMARY_PID
}

// ---------------------------------------------------------------------------
// CB1100AU (calcCoeff) helpers — secondary path
// ---------------------------------------------------------------------------

/// CRC-16 as used by the `calcCoeff` `"EQ1#"` packet trailer.
///
/// Parameters: poly `0x1021`, init `0xFFFF`, no reflection, xorout `0x0000`
/// (this is CRC-16/CCITT-FALSE; the bundle starts the accumulator at 0xFFFF,
/// not the textbook XMODEM 0x0000). The trailer is appended low byte first.
// VERIFIED: bundle inlines exactly this loop (`n = 65535; n ^= e[r]<<8; ... ^ 4129`).
pub fn crc16_xmodem(data: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for &b in data {
        crc ^= (b as u16) << 8;
        for _ in 0..8 {
            if crc & 0x8000 != 0 {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }
    crc
}

/// Linearised preamp coefficient for the `calcCoeff` path:
/// `round(10^(preamp_db/20) * scale)`.
///
/// The bundle multiplies the linear gain by a per-coefficient Q scale; pass the
/// observed scale ([`COEFF_Q`]) or another as needed.
// VERIFIED: `d = Math.round(Math.pow(10, r/20) * scale)`.
pub fn preamp_linear(preamp_db: f32, scale: i64) -> i64 {
    (10f64.powf(preamp_db as f64 / 20.0) * scale as f64).round() as i64
}

// ---------------------------------------------------------------------------
// Codec / readback
// ---------------------------------------------------------------------------

/// Stateful codec for framing/deframing a stream of device messages.
#[derive(Debug, Default)]
pub struct Codec {
    /// EQ band base address for the connected device variant.
    pub eq_base: u8,
}

impl Codec {
    /// Create a codec for the primary device (EQ base 32).
    pub fn new() -> Self {
        Self {
            eq_base: EQ_BASE_ADDR,
        }
    }

    /// Create a codec for a device variant with a non-default EQ base address.
    pub fn with_base(eq_base: u8) -> Self {
        Self { eq_base }
    }

    /// Encode a full EQ program: optional tag id, then all bands, in the exact
    /// frame order the web app emits. Returns a flat list of 10-byte HID
    /// payloads to send on [`COMMAND_REPORT`].
    ///
    /// Each inner `Vec<u8>` is one HID Output Report payload.
    pub fn encode_eq_program(&self, tag_id: Option<u32>, bands: &[EqBandWire]) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        if let Some(tag) = tag_id {
            out.push(encode_eq_tag(tag).to_vec());
        }
        for band in bands {
            let frames = encode_band_at(band, self.eq_base);
            out.push(frames[..10].to_vec());
            out.push(frames[10..].to_vec());
        }
        out
    }

    /// Decode an EQ-readback report into bands.
    ///
    /// The expected layout reverses [`encode_band_at`]: the buffer is a
    /// concatenation of 10-byte register frames where byte 0 = register
    /// address, bytes 6..10 = data. A "frame A" (even addr offset) carries
    /// gain+freq, the following "frame B" (odd addr offset) carries Q+type.
    // INFERRED: the bundle's primary class leaves the EQ readback handler empty
    // (`readFilterInfo(){}`), so the device's *response* layout is not proven by
    // the bundle. This mirrors the write layout (the most likely response
    // shape) but MUST be confirmed against real hardware.
    pub fn decode_eq(&self, report: &[u8]) -> Option<Vec<EqBandWire>> {
        if report.len() < 20 || report.len() % 10 != 0 {
            return None;
        }
        let base = self.eq_base as i32;
        let mut bands: Vec<EqBandWire> = Vec::new();
        for chunk in report.chunks_exact(10) {
            let addr = chunk[0] as i32;
            let rel = addr - base;
            if rel < 0 {
                continue;
            }
            let index = (rel / 2) as u8;
            let d = [chunk[6], chunk[7], chunk[8], chunk[9]];
            if rel % 2 == 0 {
                // Frame A: gain (int16 LE) + freq (int16 LE)
                let gain_raw = i16::from_le_bytes([d[0], d[1]]) as i32;
                let freq_raw = i16::from_le_bytes([d[2], d[3]]) as i32;
                bands.push(EqBandWire {
                    index,
                    freq: decode_freq(freq_raw),
                    q: 0.0,
                    gain: decode_gain(gain_raw),
                    filter: FilterType::Peaking,
                    enabled: true,
                });
            } else {
                // Frame B: Q (int16 LE) + type byte
                let q_raw = i16::from_le_bytes([d[0], d[1]]) as i32;
                let filter = FilterType::from_wire_code(d[2]).unwrap_or(FilterType::Peaking);
                if let Some(b) = bands.iter_mut().find(|b| b.index == index) {
                    b.q = decode_q(q_raw);
                    b.filter = filter;
                }
            }
        }
        if bands.is_empty() {
            None
        } else {
            Some(bands)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Handshake / identity (VERIFIED) ---

    #[test]
    fn handshake_payload_is_ascii_12345678_padded() {
        assert_eq!(&HANDSHAKE_PAYLOAD[..8], b"12345678");
        assert_eq!(&HANDSHAKE_PAYLOAD[8..], &[0, 0]);
        assert_eq!(handshake_frame(), HANDSHAKE_PAYLOAD.to_vec());
    }

    #[test]
    fn primary_vid_pid() {
        assert_eq!(PRIMARY_VID, 0x0666);
        assert_eq!(PRIMARY_PID, 0x0888);
        assert!(is_primary(PRIMARY_VID, PRIMARY_PID));
        assert!(!is_primary(0x0666, 0x0001));
    }

    #[test]
    fn whitelist_contains_primary() {
        assert!(is_supported_vid(PRIMARY_VID));
        assert!(is_supported_vid(0x0D8C)); // C-Media
        assert!(!is_supported_vid(0x1234));
    }

    #[test]
    fn command_ascii_bytes() {
        assert_eq!(CMD_WRITE, 87);
        assert_eq!(CMD_READ, 82);
        assert_eq!(CMD_SAVE, 83);
        assert_eq!(CMD_RESET, 67);
    }

    // --- Scaling (VERIFIED) ---

    #[test]
    fn freq_scaling_is_div2() {
        // bundle: i = freqs[s] / 2
        assert_eq!(encode_freq(1000.0), 500);
        assert_eq!(encode_freq(20000.0), 10000);
        assert_eq!(decode_freq(500), 1000.0);
    }

    #[test]
    fn q_scaling_is_x1000() {
        // bundle: u = parseInt(1e3 * qs[s])
        assert_eq!(encode_q(0.707), 707);
        assert_eq!(encode_q(1.41), 1410);
        assert_eq!(decode_q(707), 0.707);
    }

    #[test]
    fn gain_scaling_is_x10_signed() {
        // bundle: c = parseInt(10 * gains[s])
        assert_eq!(encode_gain(6.0), 60);
        assert_eq!(encode_gain(-3.5), -35);
        assert_eq!(decode_gain(-35), -3.5);
    }

    // --- Band encoding (VERIFIED layout) ---

    #[test]
    fn band_zero_layout_matches_bundle() {
        // Band 0: 1 kHz, Q 0.707, +6 dB, Peaking.
        // Expected per bundle setEqInfo with base 32:
        //   Frame A addr = 32, cmd 'W', gain(60)=[60,0], freq(500)=[244,1]
        //   Frame B addr = 33, cmd 'W', q(707)=[195,2], type=8+0=8, 0
        let band = EqBandWire {
            index: 0,
            freq: 1000.0,
            q: 0.707,
            gain: 6.0,
            filter: FilterType::Peaking,
            enabled: true,
        };
        let bytes = encode_band(&band);
        // 500 = 0x01F4 -> [0xF4=244, 0x01=1]
        assert_eq!(&bytes[..10], &[32, 0, 0, 0, 87, 0, 60, 0, 244, 1]);
        // 707 = 0x02C3 -> [0xC3=195, 0x02=2]
        assert_eq!(&bytes[10..], &[33, 0, 0, 0, 87, 0, 195, 2, 8, 0]);
    }

    #[test]
    fn band_negative_gain_is_twos_complement() {
        // -3.5 dB -> -35 -> 0xFFDD -> [0xDD=221, 0xFF=255]
        let band = EqBandWire {
            index: 1,
            freq: 200.0,
            q: 1.0,
            gain: -3.5,
            filter: FilterType::LowShelf,
            enabled: true,
        };
        let bytes = encode_band(&band);
        // addr A = 32 + 2*1 = 34
        assert_eq!(bytes[0], 34);
        assert_eq!(bytes[6], 221); // -35 low byte
        assert_eq!(bytes[7], 255); // -35 high byte
                                   // freq 200 -> /2 = 100 -> [100, 0]
        assert_eq!(bytes[8], 100);
        assert_eq!(bytes[9], 0);
        // addr B = 35, Q 1.0 -> 1000 = 0x03E8 -> [0xE8=232, 0x03=3]
        assert_eq!(bytes[10], 35);
        assert_eq!(bytes[16], 232);
        assert_eq!(bytes[17], 3);
        // type LS = 3 -> 8 + 3 = 11
        assert_eq!(bytes[18], 11);
        assert_eq!(bytes[19], 0);
    }

    #[test]
    fn type_byte_is_8_plus_code() {
        for (ft, code) in [
            (FilterType::Peaking, 0u8),
            (FilterType::LowPass, 1),
            (FilterType::HighPass, 2),
            (FilterType::LowShelf, 3),
            (FilterType::HighShelf, 4),
        ] {
            assert_eq!(ft.wire_code(), code);
            let band = EqBandWire {
                index: 0,
                freq: 1000.0,
                q: 1.0,
                gain: 0.0,
                filter: ft,
                enabled: true,
            };
            let bytes = encode_band(&band);
            assert_eq!(bytes[18], 8 + code);
        }
    }

    #[test]
    fn band_index_addresses() {
        // base 32, band index 4 -> A=40, B=41
        let band = EqBandWire {
            index: 4,
            freq: 4000.0,
            q: 0.7,
            gain: 0.0,
            filter: FilterType::Peaking,
            enabled: true,
        };
        let bytes = encode_band(&band);
        assert_eq!(bytes[0], 40);
        assert_eq!(bytes[10], 41);
    }

    // --- Preamp (VERIFIED) ---

    #[test]
    fn preamp_is_negated_x10_int32() {
        // +6 dB -> a = -60 -> int32 LE 0xFFFFFFC4 -> [196,255,255,255]
        let f = encode_preamp(6.0);
        assert_eq!(f[0], 87); // addr
        assert_eq!(f[4], 87); // 'W'
        assert_eq!(&f[6..], &[196, 255, 255, 255]);

        // -16 dB -> a = 160 -> [160,0,0,0]
        let f = encode_preamp(-16.0);
        assert_eq!(&f[6..], &[160, 0, 0, 0]);

        // 0 dB -> a = 0
        let f = encode_preamp(0.0);
        assert_eq!(&f[6..], &[0, 0, 0, 0]);
    }

    // --- Tag / reset / flush (VERIFIED) ---

    #[test]
    fn eq_tag_frame_layout() {
        let f = encode_eq_tag(0x1234);
        assert_eq!(f, [22, 0, 0, 0, 87, 0, 0x34, 0x12, 0, 0]);
    }

    #[test]
    fn factory_reset_layout() {
        assert_eq!(factory_reset_frame(), [0, 0, 0, 0, 67, 0, 0, 0, 0, 0]);
    }

    #[test]
    fn flush_frames() {
        assert_eq!(flush_to_memory_frame(), [1, 10, 4, 0, 0, 255, 255]);
        assert_eq!(flush_to_flash_frame(), [1, 1, 0]);
        assert_eq!(get_chip_id_frame(), [128, 14, 0]);
    }

    // --- CRC16/XMODEM (VERIFIED algorithm) ---

    #[test]
    fn crc16_xmodem_known_vector() {
        // The bundle's CRC uses poly 0x1021 with init 0xFFFF (CRC-16/CCITT-FALSE),
        // NOT textbook XMODEM (init 0x0000). Check value for "123456789" is 0x29B1.
        assert_eq!(crc16_xmodem(b"123456789"), 0x29B1);
        assert_eq!(crc16_xmodem(&[]), 0xFFFF);
    }

    #[test]
    fn preamp_linear_unity_at_0db() {
        assert_eq!(preamp_linear(0.0, COEFF_Q), COEFF_Q);
    }

    // --- Round trip via Codec (INFERRED readback shape) ---

    #[test]
    fn encode_eq_program_orders_frames() {
        let codec = Codec::new();
        let bands = vec![
            EqBandWire {
                index: 0,
                freq: 1000.0,
                q: 0.707,
                gain: 6.0,
                filter: FilterType::Peaking,
                enabled: true,
            },
            EqBandWire {
                index: 1,
                freq: 2000.0,
                q: 1.0,
                gain: -2.0,
                filter: FilterType::HighShelf,
                enabled: true,
            },
        ];
        let frames = codec.encode_eq_program(Some(7), &bands);
        // tag + 2 frames per band
        assert_eq!(frames.len(), 1 + 2 * 2);
        assert_eq!(frames[0][0], EQ_TAG_ADDR);
        assert_eq!(frames[1][0], 32); // band0 A
        assert_eq!(frames[2][0], 33); // band0 B
        assert_eq!(frames[3][0], 34); // band1 A
        assert_eq!(frames[4][0], 35); // band1 B
    }

    #[test]
    fn decode_eq_reverses_encode() {
        let codec = Codec::new();
        let band = EqBandWire {
            index: 0,
            freq: 1000.0,
            q: 0.707,
            gain: 6.0,
            filter: FilterType::HighShelf,
            enabled: true,
        };
        let bytes = encode_band(&band);
        let decoded = codec.decode_eq(&bytes).expect("decode");
        assert_eq!(decoded.len(), 1);
        let d = decoded[0];
        assert_eq!(d.index, 0);
        assert_eq!(d.freq, 1000.0);
        assert_eq!(d.gain, 6.0);
        assert_eq!(d.q, 0.707);
        assert_eq!(d.filter, FilterType::HighShelf);
    }
}
