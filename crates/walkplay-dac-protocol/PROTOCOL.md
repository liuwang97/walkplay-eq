# Walkplay DAC HID Protocol (reverse-engineered)

Source of truth: the obfuscated web bundle `peq-bundle.js` (Vue3 + Element Plus),
de-obfuscated to `peq-bundle.beauty.js`. Confidence tags:

- **VERIFIED** — byte layout read directly from the bundle source.
- **INFERRED** — reasoned from the bundle; needs confirmation on real hardware.

The primary device is **VID 0x0666 / PID 0x0888**. The web app talks to it via
WebHID; we replace that with the native `hidapi` crate (Web Serial / `serialport`
is the fallback at 115200 baud for VID 0x31B2/PID 0xFFF8 and VID 0x8888/PID 0xCDC0).

---

## 1. Transport framing

A HID Output Report is `(reportId, payload[])`. Two report IDs carry everything:

| Report ID | Decimal | Role | Confidence |
|-----------|---------|------|------------|
| `0x54` | **84** | Handshake / auth — payload `"12345678"` + `[0,0]` (10 bytes) | VERIFIED |
| `0x4B` | **75** | All EQ / register / firmware command + read-back frames | VERIFIED |

Connect sequence the web app performs (HID + CDC hybrid):
1. `sendReport(84, [49,50,51,52,53,54,55,56,0,0])` — handshake.
2. (CDC fallback only) `navigator.serial.requestPort(...)` then a serial wake-up.
3. Begin issuing report-75 command frames.

---

## 2. Primary register protocol (Report ID 75) — the EQ path

All command frames on report 75 are **10 bytes**:

```
[ addr, 0, 0, 0, cmd, 0, d0, d1, d2, d3 ]
   ^byte0          ^byte4   ^bytes 6..9 = 4-byte little-endian data
```

`cmd` is an ASCII letter:

| cmd | ASCII | Meaning | Confidence |
|-----|-------|---------|------------|
| 0x52 | `R` (82) | read register `addr` | VERIFIED |
| 0x57 | `W` (87) | write register `addr` | VERIFIED |
| 0x53 | `S` (83) | save register | INFERRED |
| 0x43 | `C` (67) | reset/clear | VERIFIED |

### 2.1 EQ band block

Per band `s` (0-based) the web app (`setEqInfo`) writes **two** frames. Base
register address differs per device variant; the **primary device uses base 32**.

| Frame | addr | byte6 | byte7 | byte8 | byte9 | Meaning |
|-------|------|-------|-------|-------|-------|---------|
| A | `base + 2*s` | `gain & 0xFF` | `(gain>>8) & 0xFF` | `freq & 0xFF` | `(freq>>8) & 0xFF` | gain (int16 LE), freq (int16 LE) |
| B | `base + 2*s + 1` | `q & 0xFF` | `(q>>8) & 0xFF` | `8 + (type & 7)` | `0` | Q (int16 LE), type byte |

**Scaling (VERIFIED):**

| Field | Encoding | Range note |
|-------|----------|------------|
| `freq` | `round(freqHz / 2)`, int16 LE | freq is stored halved |
| `q` | `parseInt(1000 * q)`, int16 LE | 3 decimal places |
| `gain` | `parseInt(10 * gainDb)`, int16 LE signed | 1 decimal, two's-complement for negatives |
| `type` | `8 + (code & 7)`, single byte | code map below |

**Filter type codes (VERIFIED, primary device):**

| Type | code | wire byte (`8+code`) |
|------|------|----------------------|
| PK (Peaking)  | 0 | 8 |
| LP (Lowpass)  | 1 | 9 |
| HP (Highpass) | 2 | 10 |
| LS (Lowshelf) | 3 | 11 |
| HS (Highshelf)| 4 | 12 |

Worked example — band 0: 1000 Hz, Q 0.707, +6 dB, Peaking:
- A = `[32,0,0,0, 87, 0, 60,0, 244,1]`  (gain 60=0x3C, freq 500=0x01F4)
- B = `[33,0,0,0, 87, 0, 195,2, 8, 0]`  (Q 707=0x02C3, type 8)

### 2.2 EQ tag id (preset id)

Written **before** the band block (`saveEqTagId`):

`[22, 0,0,0, 87, 0, tag&0xFF, tag>>8, tag>>16, tag>>24]` — addr 22, int32 LE. **VERIFIED.**

### 2.3 Preamp / DAC pre-gain

`setDacOffset(preDb)` (VERIFIED):

```
a = round(-10 * preDb)                  // NOTE the negation
[87, 0,0,0, 87('W'), 0, a&0xFF, a>>8, a>>16, a>>24]   // addr 87, int32 LE signed
```

- +6 dB → a = -60 → bytes `[196,255,255,255]`
- -16 dB → a = 160 → bytes `[160,0,0,0]`

### 2.4 Other register writes (VERIFIED addresses)

| Function | addr | cmd | Notes |
|----------|------|-----|-------|
| factory reset (`resetDevice`) | 0 | `C` (67) | `[0,0,0,0,67,0,0,0,0,0]` |
| read device version | 4, 5 | `R` | two reads |
| save eq tag | 22 | `W` | int32 LE |
| ADC gain offset | 86 | `W` | int32 LE |
| mic/ADC offset | 58 | `W`/`R` | int32 LE |
| DAC pre-gain | 87 | `W` | int32 LE, ×-10 |

### 2.5 Commit/persist helpers (separate small frames)

These are **not** 10-byte register frames; they are short command frames sent on
report 75:

| Helper | Bytes | Meaning | Confidence |
|--------|-------|---------|------------|
| `refereshToMemery()` | `[1,10,4,0,0,255,255]` | flush cached regs to volatile memory | VERIFIED |
| `refereshToFlash()`  | `[1,1,0]` | persist regs to flash | VERIFIED |

Write order the app uses for a full EQ apply: `tag` → per-band A/B frames →
`refereshToMemery()`; "save to device" additionally calls `refereshToFlash()`.

---

## 3. Variant: `0x3F 0x5A 0xA5` register protocol

A second device class (also report 75) frames each register write with a magic
header and an explicit sub-register offset. Same scaling as §2.1
(`freq/2`, `q*1000`, `gain*10`).

```
[0x3F, 0x5A, 0xA5, seq, len, 0x46, 0x80, regOffset, 0, data...]
 seq = [0x01,0x41,0x81,0xC1] cycling   (l[s%4] + 1, l=[0,64,128,192])
```

Per band `i`, `u = 10*i`; sub-offsets:

| regOffset | len | data | Meaning |
|-----------|-----|------|---------|
| `u+0` | 8 | 4 bytes LE | `freq/2` |
| `u+4` | 6 | 2 bytes LE | `q*1000` |
| `u+6` | 6 | 2 bytes LE | `gain*10` |
| `u+8` | 5 | 1 byte | filter type code |
| `u+9` | 5 | 1 byte | enable (`1`) |

Confidence: VERIFIED layout, but it belongs to a non-primary device class. Our
crate implements §2 (the primary class). Documented here for completeness.

---

## 4. Variant: `calcCoeff` / "EQ1#" packet protocol (CB1100AU class)

A third class computes **raw RBJ biquad coefficients host-side** and ships them
as a single blob, chunked across HID reports. Not the primary path; helpers
exposed (`crc16_xmodem`, `preamp_linear`) for when we add CB1100AU support.

Blob header (VERIFIED): `"EQ1#"` = `[69,81,49,35]`, then a 16-bit length, then
`[0, count, 4, 5, 1, count, 0, 0]`, then the preamp coefficient (int32 LE), then
`count × 20` bytes of biquad coefficients (`b0,b1*,a1,a2*,…` each int32 LE,
scaled by `COEFF_Q = 1<<27`), then a CRC-16 trailer.

- **Preamp**: `round(10^(preDb/20) * scale)` — linear gain × Q scale. VERIFIED.
- **Biquad math**: standard Audio-EQ-Cookbook (RBJ) for PK/LS/HS/LP/HP. VERIFIED.
- **CRC**: poly 0x1021, init 0xFFFF, no reflect, xorout 0 (CRC-16/CCITT-FALSE),
  appended low byte first. VERIFIED. (Check value "123456789" → 0x29B1.)
- **GAIN_Q** = `1<<23`, **COEFF_Q** = `1<<27`. VERIFIED.

---

## 5. Firmware / DFU sub-protocol (Report ID 75 + serial)

Used only for firmware update, not EQ. Documented so it is not mistaken for EQ.

| Frame | Meaning | Confidence |
|-------|---------|------------|
| `[128,14,0]` | get chip id (the confirmed `sendReport(75,[128,14,0])` sample) | VERIFIED |
| `[128,13,0, addr(4 LE)]` | read flash @ addr | VERIFIED |
| `[1,13,8, addr(4), len/val(4)]` | write flash | VERIFIED |
| DFU packet header magic | `1482184002` (0x585451C2) | VERIFIED |

Serial-side firmware handshake strings (ASCII, CDC fallback): `EKTM`
`[30,75,84,77]`, `RCHP` `[210,67,72,80]`, `<PWO` `[60,80,87,79]`, `KSTA`
`[75,83,84,65]`; stop `[150,83,84,80]`, reset `[90,82,83,84]`; **ACK = 0xA5 (165)**.

---

## 6. Read-back (device → host)

The bundle's primary class leaves the EQ read handler empty (`readFilterInfo(){}`),
and other handlers key off `report[0]` (the register address / opcode echo):
e.g. `report[0]==2` → tag id in `report[6]`; `report[0]==4/5` → version string
bytes in `report[6..10]`; `report[0]==58` → ADC offset in `report[6]`.

`Codec::decode_eq` reverses the §2.1 write layout (addr in byte0, data in
bytes 6..10). This is **INFERRED** — the device's actual EQ response framing is
not proven by the bundle and must be captured from hardware.

---

## 7. Needs-hardware-verification checklist

- [ ] **EQ base address for 0x0666/0x0888.** Code assumes 32; the bundle also
      has variants at 53 and 66. Confirm which class binds to the primary PID.
- [ ] **Save semantics.** Is `CMD_SAVE` ('S') used, or only
      `refereshToMemery`/`refereshToFlash`? Confirm the exact "save to device"
      sequence and whether flash-write needs a delay between frames.
- [ ] **EQ read-back framing.** `decode_eq` mirrors the write layout; capture a
      real read response and confirm address echo + data offsets.
- [ ] **Per-band enable on the primary device.** §2 has no enable byte (only the
      0x3F5AA5 variant does). Confirm how a disabled band is represented
      (flatten to 0 dB / PK, or skipped).
- [ ] **Preamp range & sign.** Confirm `-10 * dB` int32 and that the device
      clamps to roughly -16..+6 dB.
- [ ] **Q / gain saturation.** Values are int16; confirm device clamping for
      Q > 32.767 or |gain| beyond ±10 dB (×10 keeps it well within int16).
- [ ] **Report length / padding.** Confirm whether report 75 expects a fixed
      report length (e.g. always 10/64 bytes) or accepts variable-length
      payloads; pad if the HID descriptor requires it.
- [ ] **Handshake response.** Confirm whether report 84 expects a reply before
      command frames are accepted.
