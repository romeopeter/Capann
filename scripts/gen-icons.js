// One-off generator for extension toolbar icons (no build dependency on external
// image libraries). Produces solid PNGs with a simple pencil-nib glyph.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgbaPixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = chunk('IHDR', ihdrData);

  const raw = Buffer.alloc((width * 4 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // no filter
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = rgbaPixels(x, y);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
      raw[offset++] = a;
    }
  }
  const idat = chunk('IDAT', zlib.deflateSync(raw));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, idat, iend]);
}

// Brand colors
const BG = [124, 58, 237]; // violet-600
const NIB = [255, 255, 255];
const TIP = [251, 191, 36]; // amber-400 (pointer tip accent)

function pixelAt(size) {
  const cx = size / 2;
  const cy = size / 2;
  return (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const radius = size * 0.48;

    // Rounded-square background via circle mask for simplicity at small sizes.
    if (dist > radius) return [0, 0, 0, 0];

    // Diagonal "pencil" stroke from top-left-ish to bottom-right-ish.
    // Line from (0.28, 0.22)*size to (0.72, 0.78)*size, thickness scales with size.
    const x1 = size * 0.26, y1 = size * 0.24;
    const x2 = size * 0.74, y2 = size * 0.76;
    const px = x2 - x1, py = y2 - y1;
    const len2 = px * px + py * py;
    let t = ((x - x1) * px + (y - y1) * py) / len2;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * px;
    const projY = y1 + t * py;
    const lineDist = Math.sqrt((x - projX) ** 2 + (y - projY) ** 2);
    const thickness = Math.max(1.4, size * 0.09);

    if (lineDist <= thickness) {
      // Tip highlight near the end point (pencil point).
      const distToTip = Math.sqrt((x - x2) ** 2 + (y - y2) ** 2);
      if (distToTip <= thickness * 1.6) return [...TIP, 255];
      return [...NIB, 255];
    }

    return [...BG, 255];
  };
}

const outDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const png = encodePNG(size, size, pixelAt(size));
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), png);
  console.log(`wrote icon${size}.png (${png.length} bytes)`);
}
