/* Gera os PNGs do PWA sem nenhuma dependencia externa (usa zlib do Node).
   Rode:  node make-icons.js   */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ---- encoder PNG minimo ----------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filtro none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw[p++] = r; raw[p++] = g; raw[p++] = b; raw[p++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- desenho ---------------------------------------------------------------
const BG = [5, 150, 105];       // #059669
const BG2 = [4, 120, 87];       // #047857 (degrade suave)
const FG = [255, 255, 255];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function sdRoundBox(px, py, hw, hh, r) {
  const qx = Math.abs(px) - hw + r;
  const qy = Math.abs(py) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const t = clamp01((wx * vx + wy * vy) / (vx * vx + vy * vy));
  return Math.hypot(wx - vx * t, wy - vy * t);
}

/* Glifo: um "check" grosso com cantos redondos, escala em fracao do tamanho.
   scale = 1 usa a area padrao; menor deixa margem (icone maskable). */
function glyphDistance(nx, ny, scale) {
  const x = (nx - 0.5) / scale + 0.5;
  const y = (ny - 0.5) / scale + 0.5;
  const d1 = sdSegment(x, y, 0.255, 0.545, 0.435, 0.715);
  const d2 = sdSegment(x, y, 0.435, 0.715, 0.755, 0.315);
  return Math.min(d1, d2) - 0.055; // 0.055 = metade da espessura
}

function makeIcon(size, { rounded = true, glyphScale = 1 } = {}) {
  const aa = 1 / size; // ~1px em coordenadas normalizadas
  return encodePng(size, (px, py) => {
    const nx = (px + 0.5) / size;
    const ny = (py + 0.5) / size;

    // fundo
    let bgA = 1;
    if (rounded) {
      const d = sdRoundBox(nx - 0.5, ny - 0.5, 0.5, 0.5, 0.22);
      bgA = clamp01(0.5 - d / aa);
    }
    const base = mix(BG, BG2, clamp01((nx + ny) / 2));

    // glifo
    const gd = glyphDistance(nx, ny, glyphScale);
    const gA = clamp01(0.5 - gd / aa);

    const rgb = mix(base, FG, gA);
    return [rgb[0], rgb[1], rgb[2], Math.round(bgA * 255)];
  });
}

const out = path.join(__dirname, 'icons');
fs.mkdirSync(out, { recursive: true });

const files = [
  ['icon-32.png',            makeIcon(32,  { rounded: true,  glyphScale: 1 })],
  ['icon-192.png',           makeIcon(192, { rounded: true,  glyphScale: 1 })],
  ['icon-512.png',           makeIcon(512, { rounded: true,  glyphScale: 1 })],
  ['icon-maskable-512.png',  makeIcon(512, { rounded: false, glyphScale: 0.62 })],
];

for (const [name, buf] of files) {
  fs.writeFileSync(path.join(out, name), buf);
  console.log(name, buf.length + ' bytes');
}
