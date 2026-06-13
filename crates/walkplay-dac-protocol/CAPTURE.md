# WalkPlay T02 (VID 0x3302 / PID 0x12CB) — REAL protocol, captured live

Captured 2026-06-14 by hooking `HIDDevice.prototype.sendReport` of the official
web app (peq.szwalkplay.com) via CDP, while moving an EQ slider on the real device.

## THIS INVALIDATES the register-based protocol in lib.rs for the 0x3302 family.

Our reverse-engineered `[addr,0,0,0,'W'(87)...]` register protocol is for the
**primary 0x0666 family**. The 0x3302 "T02" device uses a **computed-biquad-coefficient**
protocol below. Writing register frames to a T02 has NO effect — this is why
"EQ写入不生效".

## Wire format (HID Output Report, report id 75)

On ANY EQ change the app re-sends the FULL program: 8 band frames + 1 commit.

```
Band frame (36 bytes):
  01 09 18 00 <band:1> 00 00 | <20 bytes: 5×int32 LE coeffs> | <gain:2 LE> <flags> | <CRC16:2>
    01      = device/channel prefix
    09      = opcode "write EQ band coefficients"
    18 (24) = payload length
    band    = 0..7  (this device has 8 bands)
  coeffs order = [b0, b1, b2, -a1, -a2], each = round(coef * (1<<30)) as int32 LE  (Q30)
  trailing  = 2-byte gain word + flag bytes (…02 00 01 seen on defaults) + CRC16 (0x6dfd-style)

Commit frame (7 bytes):
  01 0a 04 00 00 ff ff      // opcode 0x0a = "flush to register/RAM", applies the program
  (flush to flash = 01 01 0;  flush-to-memory variant = 01 0a 04 00 00 ff ff)

Pre-amp / pre-gain frame (5 bytes), report 75 — applied immediately, NO commit:
  01 03 02 00 <dB:i8>       // captured fc=-4, fb=-5, fa=-6; range -16..6 dB
```

## Coefficient math (RBJ cookbook, fs read from device; ported verbatim from bundle ~line 57700)

```
PEAKING:
  A  = sqrt(10^(gainDb/20))          // note: /20 then sqrt == 10^(gain/40)
  w  = 2*PI*freq/fs
  alpha = sin(w) / (2*Q)
  a0 = 1 + alpha/A
  b  = [ (1+alpha*A)/a0, -2*cos(w)/a0, (1-alpha*A)/a0 ]
  a  = [ 1,              -2*cos(w)/a0, (1-alpha/A)/a0 ]
  out5 = [b0, b1, b2, -a1, -a2] each *2^30 rounded to int32

LOW/HIGH SHELF + LOW/HIGH PASS variants also present in bundle (same packing).
```

## Captured reference frames (one full program, band0 = 105Hz after a +step)

```
01 09 18 00 00 00 00 30 9b 1f 40 8c 6b 96 80 67 11 4b 3f 20 db 69 7f 15 9a 95 c0 69 00 b6 00 1a 06 01 fd 6d
01 09 18 00 01 00 00 fa 58 af 3f f0 e3 26 81 f1 20 2d 3f 10 1c d9 7e 16 86 23 c1 dc 00 33 01 00 f9 02 fd 6d
01 09 18 00 02 00 00 e9 85 43 40 5b b6 86 82 7c 2c 94 3d a5 49 79 7d 9a 4d 28 c2 92 04 00 02 e6 01 02 fd 6d
01 09 18 00 03 00 00 26 28 bb 3f f1 0f 9b 83 61 0e 88 3d 0f f0 64 7c 79 c9 bc c2 08 07 00 03 1a fe 02 fd 6d
01 09 18 00 04 00 00 5f 7e 4c 42 b7 de d3 85 06 bf 2f 39 49 21 2c 7a 9b c2 83 c4 b6 08 66 01 1a 06 02 fd 6d
01 09 18 00 05 00 00 e9 48 99 3f 9f cf 03 8a 09 af 05 39 61 30 fc 75 0f 08 61 c7 80 0c cd 01 00 ff 02 fd 6d
01 09 18 00 06 00 00 80 5c 56 3f 49 f3 a1 91 69 f7 c8 38 b7 0c 5e 6e 17 ac e0 c7 38 18 4d 03 66 fe 02 fd 6d
01 09 18 00 07 00 00 8d 61 f2 45 3b d1 a4 ab 42 c0 61 24 c5 2e 5b 54 31 de ab d5 10 27 33 01 cd 03 02 fd 6d
01 0a 04 00 00 ff ff
```

Default/factory program (hardcoded in bundle ~line 58299), useful to validate the encoder:
band0 default = `01 09 18 00 00 00 00 00 40 0d 82 47 80 c5 aa b8 3f f3 7d b8 7f 3b 55 47 c0 32 00 c0 00 00 00 02 00 01`

## Recommended implementation
Port the bundle's coeff+frame builder verbatim. Cleanest: compute the 9 frames in the
TS frontend (we have the exact JS), add a Rust `hid_send_raw(report_id, bytes)` passthrough,
send all 8 band frames + commit on every EQ change (debounced). Validate the encoder by
reproducing the captured reference frames byte-for-byte before touching hardware.
```
