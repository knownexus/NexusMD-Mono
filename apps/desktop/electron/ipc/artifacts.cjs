'use strict';

// artifacts:save — download a build artifact (an Azure DevOps or GitHub Actions zip) and save it where
// the user picks in the save dialog. Mirrors the mobile ArtifactDownload plugin.
//
// What the renderer may send: the artifact item ({ provider, url, filename }) and that provider's token
// ({ pat }, plus { org } for Azure DevOps), the same way the Jira proxy and the renderer's own ADO
// client get theirs. It can't send headers: the main process builds them here, and:
//   - only https URLs on the provider's own API origin are accepted (https://dev.azure.com/{org}/ or
//     https://api.github.com; ADO here is always cloud, so there is no http on-prem case);
//   - redirects are followed by hand, and the token goes only to a URL on that same origin (GitHub
//     redirects to a pre-signed storage host, which gets no Authorization header); every hop is https;
//   - the file is written only where the save dialog says, streamed to a temporary file next to it
//     and renamed into place once complete, so a failed download leaves nothing (and keeps a file it
//     would have replaced); a non-2xx answer is thrown, never saved;
//   - nothing here logs the token or the headers.

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const { moduleLogger, ignore, ignored } = require('@nexusmd/main-kit/logging');
const modLog = moduleLogger('core');

const API_ORIGINS = { ado: 'https://dev.azure.com', github: 'https://api.github.com' };
const MAX_REDIRECTS = 5;
const MAX_BYTES = 1024 * 1024 * 1024;
const RESPONSE_TIMEOUT_MS = 30000;
const MAX_NAME = 120;

function isApiUrl(provider, url, org) {
  const origin = API_ORIGINS[provider];
  if (!origin || typeof url !== 'string') return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.origin !== origin) return false;
  if (provider === 'ado') return !!org && u.pathname.startsWith(`/${encodeURIComponent(org)}/`);
  return true;
}

function authHeaders(provider, pat) {
  if (provider === 'github') {
    return { Authorization: 'Bearer ' + pat, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  }
  return { Authorization: 'Basic ' + Buffer.from(':' + pat).toString('base64'), Accept: '*/*' };
}

// A file name with no folders in it: control characters go, path separators and the characters
// Windows won't allow become "_", no leading dots (so never "." or ".."), and the extension is kept
// when the name is shortened.
function sanitizeFilename(name) {
  let s = String(name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^[\s._]+/, '')
    .replace(/[\s.]+$/, '');
  if (!s) return 'artifact.zip';
  if (s.length > MAX_NAME) {
    const ext = path.extname(s).slice(0, 16);
    s = s.slice(0, MAX_NAME - ext.length) + ext;
  }
  return s;
}

// One GET with redirects not followed, through Chromium's network stack (system proxy and certificate
// store, like the Jira proxy) and without the session's cookies.
// -> { status, location?, body? } (body: a readable stream of the answer)
function netRequest(url, headers) {
  const { net } = require('electron');
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method: 'GET', redirect: 'manual', credentials: 'omit', useSessionCookies: false });
    const timer = setTimeout(() => { req.abort(); reject(new Error('The download did not start in time.')); }, RESPONSE_TIMEOUT_MS);
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v);
    req.on('redirect', (status, _method, location) => {
      clearTimeout(timer);
      resolve({ status, location });
      req.abort();
    });
    req.on('response', (res) => {
      clearTimeout(timer);
      const loc = res.headers.location;
      resolve({ status: res.statusCode, location: Array.isArray(loc) ? loc[0] : loc, body: res });
    });
    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    req.end();
  });
}

function discard(body) {
  try { body?.destroy?.(); } catch (err) { ignore(modLog, 'closing a response body that may already be closed', err) }
}

function sizeLimit() {
  let total = 0;
  const counter = new Transform({
    transform(chunk, _enc, done) {
      total += chunk.length;
      if (total > MAX_BYTES) done(new Error('The artifact is too large (over 1 GB).'));
      else done(null, chunk);
    },
  });
  return { counter, bytes: () => total };
}

async function writeTo(target, body) {
  const tmp = `${target}.${process.pid}-${Date.now()}.part`;
  const { counter, bytes } = sizeLimit();
  try {
    await pipeline(body, counter, fs.createWriteStream(tmp, { flags: 'wx' }));
    await fs.promises.rename(tmp, target);
    return bytes();
  } catch (err) {
    await fs.promises.rm(tmp, { force: true }).catch(ignored(modLog, 'removing the partial download'));
    throw err;
  }
}

async function saveArtifact(req, { dialog, request = netRequest, getWin = () => null } = {}) {
  const item = req?.item || {};
  const provider = item.provider;
  const org = req?.credentials?.org;
  const pat = req?.credentials?.pat;
  if (!isApiUrl(provider, item.url, org)) throw new Error('Not a build artifact URL.');

  const options = {
    defaultPath: sanitizeFilename(item.filename),
    filters: [{ name: 'Zip archive', extensions: ['zip'] }, { name: 'All files', extensions: ['*'] }],
  };
  const win = getWin();
  const { canceled, filePath } = await (win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options));
  if (canceled || !filePath) return { saved: false };

  let url = item.url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (new URL(url).protocol !== 'https:') throw new Error('The download was redirected to a non-https address.');
    // The token only goes to the provider's own API origin (and org), never to where it redirects.
    const headers = isApiUrl(provider, url, org) && pat ? authHeaders(provider, pat) : {};
    const res = await request(url, headers);
    if (res.status >= 300 && res.status < 400) {
      discard(res.body);
      if (!res.location) throw new Error('The download was redirected without an address.');
      url = new URL(res.location, url).toString();
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      discard(res.body);
      throw new Error(`Download failed: HTTP ${res.status}`);
    }
    const written = await writeTo(filePath, res.body);
    return { saved: true, path: filePath, bytes: written };
  }
  throw new Error('The download was redirected too many times.');
}

function register(ipcMain, getMainWindow, deps = {}) {
  const dialog = deps.dialog || require('electron').dialog;
  ipcMain.handle('artifacts:save', (_e, req) => saveArtifact(req, {
    dialog,
    request: deps.request,
    getWin: deps.getWin || getMainWindow,
  }));
}

module.exports = { register, saveArtifact, sanitizeFilename, isApiUrl, netRequest };
