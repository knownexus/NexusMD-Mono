'use strict';
// Gives each app its own icon (modules/<id>/assets/icon.png and icon.ico), for the shortcut, window and
// tray of an install that holds just that app. They are the NexusMD mark turned to a hue of the app's
// own, so they read as one family; replace a file with real artwork whenever there is some.
//
//   node scripts/create-app-icons.cjs
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.join(__dirname, '..', '..', '..');
const base = path.join(__dirname, '..', 'assets', 'icon.png');
const SIZES = [16, 32, 48, 256];

// PNG-in-ICO, as create-icons.js writes it.
function makeICO(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(png => {
    const w = png.readUInt32BE(16);
    const e = Buffer.alloc(16);
    e[0] = w >= 256 ? 0 : w;
    e[1] = w >= 256 ? 0 : w;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs]);
}

async function main() {
  const ids = fs.readdirSync(path.join(root, 'modules')).filter(id => fs.existsSync(path.join(root, 'modules', id, 'app.manifest.json'))).sort();
  for (const [i, id] of ids.entries()) {
    const hue = Math.round((i * 360) / ids.length);
    const tinted = sharp(base).modulate({ hue, saturation: 1.6 });
    const pngs = [];
    for (const size of SIZES) pngs.push(await tinted.clone().resize(size, size).png().toBuffer());
    const dir = path.join(root, 'modules', id, 'assets');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'icon.png'), pngs[SIZES.length - 1]);
    fs.writeFileSync(path.join(dir, 'icon.ico'), makeICO(pngs));
    console.log(`${id.padEnd(12)} hue ${hue}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
