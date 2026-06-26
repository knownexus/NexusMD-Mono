#!/usr/bin/env node
'use strict';
// Renders the Nexus mark SVG as dark blue on transparent background,
// then writes all required icon files to assets/.
// Run: node scripts/create-icons.js

const fs   = require('fs');
const path = require('path');
const sharp = require('sharp');

const ASSETS     = path.join(__dirname, '..', 'assets');
const SVG_PATH   = path.join(__dirname, '..', '..', 'Nexus Design System', 'assets', 'logo', 'nexus-mark.svg');
const DARK_BLUE  = '#1e3a5f';
const WHITE      = '#ffffff';

// Render small icons from this size for better downsampling quality
const HI_RES = 512;

// ── Build an SVG string at the target size ───────────────────────────────────
// boostRings: for small sizes — increase ring opacity and stroke so they survive downscaling
// tightCrop:  use viewBox="3 3 58 58" to trim padding → mark fills ~93% of icon
function buildSvg(px, color = DARK_BLUE, { boostRings = false, tightCrop = true } = {}) {
  let src = fs.readFileSync(SVG_PATH, 'utf8');
  src = src.replace(/currentColor/g, color);

  if (boostRings) {
    src = src
      .replace(/opacity="0\.55"/, 'opacity="1"')
      .replace(/opacity="0\.45"/, 'opacity="0.85"')
      .replace(/stroke-width="1\.5"/, 'stroke-width="2.5"')
      .replace(/stroke-width="1\.2"/, 'stroke-width="2"');
  }

  const vb = tightCrop ? '3 3 58 58' : '0 0 64 64';

  src = src
    .replace(/(<svg[^>]*)\swidth="[^"]*"/, '$1')
    .replace(/(<svg[^>]*)\sheight="[^"]*"/, '$1')
    .replace(/(<svg[^>]*)\sviewBox="[^"]*"/, '$1')
    .replace('<svg ', `<svg width="${px}" height="${px}" viewBox="${vb}" `);
  return src;
}

// ── CRC32 (for the ICO/PNG wrapper) ─────────────────────────────────────────
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

// ── ICO builder — wraps one or more PNG buffers as a multi-size ICO ─────────
// images: single PNG buffer or array of PNG buffers (sorted smallest first)
function makeICO(images) {
  if (!Array.isArray(images)) images = [images];
  const count = images.length;
  const ENTRY_SIZE = 16;
  let dataOffset = 6 + ENTRY_SIZE * count;

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);  // reserved
  header.writeUInt16LE(1, 2);  // type: icon
  header.writeUInt16LE(count, 4);

  const entries = [];
  for (const png of images) {
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    const entry = Buffer.alloc(ENTRY_SIZE);
    entry[0] = w >= 256 ? 0 : w;  // 0 means 256
    entry[1] = h >= 256 ? 0 : h;
    entry[2] = 0; entry[3] = 0;
    entry.writeUInt16LE(1, 4);               // colour planes
    entry.writeUInt16LE(32, 6);              // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(dataOffset, 12);
    dataOffset += png.length;
    entries.push(entry);
  }

  return Buffer.concat([header, ...entries, ...images]);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(SVG_PATH)) {
    console.error(`SVG not found: ${SVG_PATH}`);
    process.exit(1);
  }

  console.log(`Reading mark from: ${SVG_PATH}`);
  console.log(`Writing icons to:  ${ASSETS}`);

  // ── App icon (256×256) — dark blue and white ────────────────────────────
  const png256 = await sharp(Buffer.from(buildSvg(256)), { density: 96 })
    .resize(256, 256).png().toBuffer();
  const png256Light = await sharp(Buffer.from(buildSvg(256, WHITE)), { density: 96 })
    .resize(256, 256).png().toBuffer();

  // ── Hi-res render sources for small icons (better downsampling) ─────────
  // boostRings=true: rings at opacity 1 / wider stroke so they survive 32→16 downscale
  const hiDark  = Buffer.from(buildSvg(HI_RES, DARK_BLUE, { boostRings: true }));
  const hiWhite = Buffer.from(buildSvg(HI_RES, WHITE,     { boostRings: true }));

  // ── Tray icons (32×32) ──────────────────────────────────────────────────
  const png32      = await sharp(hiDark,  { density: 96 }).resize(32, 32).png().toBuffer();
  const png32Light = await sharp(hiWhite, { density: 96 }).resize(32, 32).png().toBuffer();

  // ── ICO sizes — multi-size for exe and Windows file explorer ────────────
  const png16 = await sharp(hiDark, { density: 96 }).resize(16, 16).png().toBuffer();
  const png32ico = await sharp(hiDark, { density: 96 }).resize(32, 32).png().toBuffer();
  const png48 = await sharp(hiDark, { density: 96 }).resize(48, 48).png().toBuffer();

  // ── Write files ─────────────────────────────────────────────────────────
  fs.writeFileSync(path.join(ASSETS, 'icon.png'),               png256);
  fs.writeFileSync(path.join(ASSETS, 'icon-light.png'),         png256Light);
  fs.writeFileSync(path.join(ASSETS, 'icon.ico'),               makeICO([png16, png32ico, png48, png256]));
  fs.writeFileSync(path.join(ASSETS, 'tray-icon.png'),          png32);
  fs.writeFileSync(path.join(ASSETS, 'tray-icon-light.png'),    png32Light);
  // electron-builder uses icon.png as the ICNS source on Mac when .icns is absent;
  // writing the PNG here so the builder can convert it via its own toolchain.
  fs.writeFileSync(path.join(ASSETS, 'icon.icns'),              png256);

  console.log('Done:');
  console.log('  assets/icon.png            (256×256 dark — app/window icon)');
  console.log('  assets/icon-light.png      (256×256 white — window icon in dark OS mode)');
  console.log('  assets/icon.ico            (multi-size: 16, 32, 48, 256 — exe/installer)');
  console.log('  assets/tray-icon.png       (32×32 dark — system tray on light taskbar)');
  console.log('  assets/tray-icon-light.png (32×32 white — system tray on dark taskbar)');
  console.log('  assets/icon.icns           (256×256 PNG — builder converts on Mac)');
}

main().catch(err => { console.error(err); process.exit(1); });
