#!/usr/bin/env node
'use strict';
// Generates valid placeholder icons in assets/.
// Run: node scripts/create-placeholder-icons.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ASSETS = path.join(__dirname, '..', 'assets');

// ── CRC32 (needed for PNG chunks) ──────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF];
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crcVal = Buffer.alloc(4); crcVal.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcVal]);
}

// ── PNG builder ─────────────────────────────────────────────────────────────
function makePNG(size, r, g, b) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB

  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b;
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── ICO builder (wraps a 256x256 PNG as an ICO entry) ──────────────────────
function makeICO(png256) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry[0] = 0; entry[1] = 0; // 0 = 256px
  entry[2] = 0; entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png256.length, 8);
  entry.writeUInt32LE(22, 12); // offset: 6 + 16

  return Buffer.concat([header, entry, png256]);
}

// Brand colour: #2563EB (blue)
const [R, G, B] = [37, 99, 235];

const png256 = makePNG(256, R, G, B);
const png16  = makePNG(16,  R, G, B);

fs.writeFileSync(path.join(ASSETS, 'icon.png'),      png256);
fs.writeFileSync(path.join(ASSETS, 'icon.ico'),      makeICO(png256));
fs.writeFileSync(path.join(ASSETS, 'tray-icon.png'), png16);
fs.writeFileSync(path.join(ASSETS, 'icon.icns'),     png256); // electron-builder uses PNG fallback on mac

console.log('Icons written to assets/ (256x256 blue placeholder — replace before shipping)');
