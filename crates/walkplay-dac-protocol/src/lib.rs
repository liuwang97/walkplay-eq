//! Which USB devices are Walkplay EQ devices.
//!
//! The EQ wire protocol itself lives with the editor, in
//! `src/features/eq/t02-protocol.ts`; the native side only has to recognise a
//! device it may open and then passes frames through.

/// The vendor ids the official app asks the browser for when connecting an EQ
/// device. `0x0D8C` is C-Media.
pub const VID_WHITELIST: &[u16] = &[
    0x3302, 0x0762, 0x35D8, 0x2FC6, 0x0104, 0xB44D, 0x0661, 0x0666, 0x0D8C, 0x0663, 0x011D, 0x0909,
    0x34BE, 0x36A7, 0x373B,
];

/// The identity a device takes on while its firmware is being upgraded: the
/// official app looks for exactly this id inside its upgrade flow. A device in
/// that state is not an EQ device and must be left alone.
pub const UPGRADE_MODE_ID: (u16, u16) = (0x0666, 0x0888);

/// Whether a device with this identity can be driven as an EQ device.
pub fn is_eq_device(vid: u16, pid: u16) -> bool {
    VID_WHITELIST.contains(&vid) && (vid, pid) != UPGRADE_MODE_ID
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_a_t02_but_never_a_device_in_upgrade_mode() {
        assert!(is_eq_device(0x3302, 0x12CB)); // the T02 this app is built against
        assert!(!is_eq_device(0x0666, 0x0888)); // any device, mid firmware upgrade
        assert!(!is_eq_device(0x046D, 0xC52B)); // someone else's HID device
    }
}
