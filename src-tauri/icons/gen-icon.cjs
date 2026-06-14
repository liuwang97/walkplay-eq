// One-off icon generator for WalkPlay EQ.
// Renders an azure->violet rounded-square logo with white EQ pill-bars to PNG,
// fully anti-aliased (3x3 supersampling), no external deps. Run with `node`.
//
//   node gen-icon.cjs
//
// Produces master.png (1024, app icon source) + tray.png (256, bolder bars).
// Then: `npx tauri icon icons/master.png` regenerates every bundle size.

const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const A = [0x2f, 0x6b, 0xff]; // azure  #2f6bff
const D = [0x6a, 0x4c, 0xff]; // violet #6a4cff
const WHITE = [255, 255, 255];

/** Signed distance to a rounded rect centered at (cx,cy), half-size (hw,hh), corner r. */
function rrSDF(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ox, oy) - r;
}

function lerp(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * Render an icon of side `S`. `bars` is an array of {cx,w,h} in S-space (pill bars).
 * `radius` is the outer corner radius. Returns an RGBA Buffer.
 */
function render(S, bars, radius) {
  const buf = Buffer.alloc(S * S * 4);
  const SS = [1 / 6, 3 / 6, 5 / 6]; // 3x3 subpixel offsets
  const cx = S / 2;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let outer = 0;
      let bar = 0;
      for (const oy of SS) {
        for (const ox of SS) {
          const px = x + ox;
          const py = y + oy;
          if (rrSDF(px, py, cx, cx, S / 2, S / 2, radius) < 0) outer++;
          for (const b of bars) {
            const hw = b.w / 2;
            if (rrSDF(px, py, b.cx, S / 2, hw, b.h / 2, hw) < 0) {
              bar++;
              break;
            }
          }
        }
      }
      const n = 9;
      const outerCov = outer / n;
      const barCov = bar / n;

      const i = (y * S + x) * 4;
      if (outerCov === 0) {
        buf[i] = buf[i + 1] = buf[i + 2] = buf[i + 3] = 0;
        continue;
      }
      // Diagonal gradient (top-left -> bottom-right).
      const t = (x + y) / (2 * S - 2);
      const base = lerp(A, D, t);
      const col = lerp(base, WHITE, barCov);
      buf[i] = col[0];
      buf[i + 1] = col[1];
      buf[i + 2] = col[2];
      buf[i + 3] = Math.round(outerCov * 255);
    }
  }
  return buf;
}

/** Encode an RGBA buffer as a PNG (8-bit, no interlace). */
function encodePNG(rgba, S) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const tb = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([tb, data])) >>> 0, 0);
    return Buffer.concat([len, tb, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0);
  ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // Filtered scanlines (filter byte 0 per row).
  const raw = Buffer.alloc(S * (S * 4 + 1));
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0;
    rgba.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// CRC32 (PNG)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

// --- App icon: 5 pill bars forming an EQ silhouette (1024) ---
const S1 = 1024;
const appBars = [
  { cx: 232, w: 78, h: 320 },
  { cx: 372, w: 78, h: 500 },
  { cx: 512, w: 78, h: 250 },
  { cx: 652, w: 78, h: 560 },
  { cx: 792, w: 78, h: 400 },
];
fs.writeFileSync(path.join(__dirname, "master.png"), encodePNG(render(S1, appBars, 228), S1));

// --- Tray icon: 4 bolder bars, less padding, legible at 16px (256) ---
const S2 = 256;
const k = S2 / 1024;
const trayBars = [
  { cx: 227 * k, w: 120 * k, h: 380 * k },
  { cx: 417 * k, w: 120 * k, h: 580 * k },
  { cx: 607 * k, w: 120 * k, h: 300 * k },
  { cx: 797 * k, w: 120 * k, h: 500 * k },
];
fs.writeFileSync(path.join(__dirname, "tray.png"), encodePNG(render(S2, trayBars, 52 * k), S2));

console.log("wrote master.png (1024) + tray.png (256)");
