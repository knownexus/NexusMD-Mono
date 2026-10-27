'use strict';

// What an app update travels as, and how its index is signed. Used by both ends, so they can't drift:
// the release (build/app-release.mjs) packs and signs, the app (app-updater.cjs) checks and unpacks.
//
// A package (.nxapp) is one app folder, gzipped JSON: { format, files: { "<relative path>": base64 } }.
// The index (apps-index.json) lists the newest package of each app with its SHA-256, and is signed
// with an ed25519 key whose public half is built into the app (app-update-key.cjs).

const path = require('path');
const nodeFs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');

const FORMAT = 'nexusmd-app/1';

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

function filesUnder(dir, fs) {
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter(entry => entry.isFile())
    .map(entry => path.relative(dir, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'))
    .sort();
}

function packApp(dir, { fs = nodeFs } = {}) {
  const files = {};
  for (const file of filesUnder(dir, fs)) files[file] = fs.readFileSync(path.join(dir, file)).toString('base64');
  return zlib.gzipSync(JSON.stringify({ format: FORMAT, files }));
}

// Writes a package's files into dest (which must not exist yet). A path that would land outside dest
// is refused, so a package can only ever write inside its own folder.
function unpackApp(buffer, dest, { fs = nodeFs } = {}) {
  let parsed;
  try { parsed = JSON.parse(zlib.gunzipSync(buffer).toString('utf8')); } catch (err) {
    throw new Error(`not an app package: ${err.message}`);
  }
  if (parsed?.format !== FORMAT || typeof parsed.files !== 'object' || !parsed.files) {
    throw new Error(`not an app package of format ${FORMAT}`);
  }
  const root = path.resolve(dest);
  const targets = Object.entries(parsed.files).map(([file, data]) => {
    const target = path.resolve(root, file);
    if (typeof data !== 'string' || path.isAbsolute(file) || !target.startsWith(root + path.sep)) {
      throw new Error(`the package names a file outside its folder: ${file}`);
    }
    return [target, data];
  });
  for (const [target, data] of targets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(data, 'base64'));
  }
}

// ed25519 over the index's exact bytes; the signature is sent beside it, base64.
const signIndex = (bytes, privateKeyPem) => crypto.sign(null, Buffer.from(bytes), privateKeyPem).toString('base64');

function verifyIndex(bytes, signature, publicKeyPem) {
  try { return crypto.verify(null, Buffer.from(bytes), publicKeyPem, Buffer.from(String(signature).trim(), 'base64')); } catch {
    return false;
  }
}

module.exports = { FORMAT, sha256, packApp, unpackApp, signIndex, verifyIndex };
