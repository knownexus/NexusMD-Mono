'use strict';

// App updates: downloads newer versions of the installed apps into updatesDir, where resolveApps
// (app-registry.cjs) picks them up at the next launch, or sooner when the user applies them
// (app-apply.cjs). The shell itself still updates through electron-updater (updater.cjs); this only
// ever replaces app folders.
//
// The index (apps-index.json, published with each app release by build/app-release.mjs) is trusted
// only with a valid signature from the key built into the app, and each package only if it is the
// size and SHA-256 the index says. A download is unpacked beside the others as .tmp-<version> and
// renamed into place once it checks out, so a half-written version is never mistaken for one.

const path = require('path');
const nodeFs = require('fs');
const { sha256, unpackApp, verifyIndex } = require('./app-package.cjs');
const { compareVersions, readApp, readUpdateState, VERSION } = require('./app-registry.cjs');
const { SHELL_API } = require('./shell-api.cjs');
const { PUBLIC_KEY } = require('./app-update-key.cjs');

const INDEX_URL = 'https://github.com/knownexus/NexusMD-Mono/releases/download/apps-latest/apps-index.json';
const PACKAGE_FILE = /^[a-z][a-z0-9-]*-\d+\.\d+\.\d+\.nxapp$/;

async function download(fetch, url, as) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return as === 'text' ? res.text() : Buffer.from(await res.arrayBuffer());
}

// The index, or an error if it is missing, unsigned or signed by anyone else.
async function fetchIndex(fetch, indexUrl, publicKey) {
  const [bytes, signature] = await Promise.all([download(fetch, indexUrl, 'text'), download(fetch, `${indexUrl}.sig`, 'text')]);
  if (!verifyIndex(bytes, signature, publicKey)) throw new Error('the app index is not signed by the NexusMD release key');
  const index = JSON.parse(bytes);
  if (index?.schema !== 1 || typeof index.apps !== 'object') throw new Error('the app index is not one this version understands');
  return index;
}

async function fetchVersion({ fetch, indexUrl, updatesDir, app, entry, fs }) {
  if (!PACKAGE_FILE.test(entry.file)) throw new Error(`its package name "${entry.file}" is not valid`);
  const data = await download(fetch, new URL(entry.file, indexUrl).href);
  if (data.length !== entry.size || sha256(data) !== entry.sha256) throw new Error('the download is not the package the index lists');
  const dir = path.join(updatesDir, app.id);
  const tmp = path.join(dir, `.tmp-${entry.version}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  try {
    unpackApp(data, tmp, { fs });
    const unpacked = readApp(tmp, app.id, fs);
    if (unpacked.version !== entry.version) throw new Error(`the package holds version ${unpacked.version}`);
    fs.renameSync(tmp, path.join(dir, entry.version));
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

// Removes downloads no longer needed. For each installed app it keeps the version running, anything
// newer (waiting for the next launch) and the newest version between the installed and the running
// one, to go back to if the running one turns out bad. Downloads of an app that isn't installed, and
// unfinished .tmp- folders, go too.
function pruneDownloads({ apps, updatesDir, fs = nodeFs, log = console }) {
  let ids;
  try { ids = fs.readdirSync(updatesDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { return; }
  const byId = new Map(apps.map(app => [app.id, app]));
  const remove = (dir, why) => {
    try { fs.rmSync(dir, { recursive: true, force: true }); log.info(`removed ${path.relative(updatesDir, dir)}: ${why}`); } catch (err) {
      log.error(`couldn't remove ${dir}: ${err.message}`);
    }
  };
  for (const id of ids) {
    const app = byId.get(id);
    if (!app) { remove(path.join(updatesDir, id), 'the app is not installed'); continue; }
    const names = fs.readdirSync(path.join(updatesDir, id));
    for (const name of names.filter(n => n.startsWith('.tmp-'))) remove(path.join(updatesDir, id, name), 'an unfinished download');
    // No longer of use: anything not newer than the installed copy (which always wins a tie), and
    // anything older than the one running, except the newest of those to go back to.
    const stale = names.filter(n => VERSION.test(n)
      && (compareVersions(n, app.installedVersion) <= 0 || compareVersions(n, app.version) < 0));
    const previous = stale.filter(v => compareVersions(v, app.installedVersion) > 0).sort((a, b) => compareVersions(b, a))[0];
    for (const version of stale.filter(v => v !== previous)) remove(path.join(updatesDir, id, version), 'superseded');
  }
}

// One check: downloads what's new for the installed apps (`apps`, as resolveApps returned them) and
// tidies up. Never throws; says what it did.
async function checkAppUpdates({
  apps, updatesDir, fetch, indexUrl = INDEX_URL, publicKey = PUBLIC_KEY, shellApi = SHELL_API, fs = nodeFs, log = console,
}) {
  const result = { downloaded: [], needsShell: [], failed: [] };
  let index;
  try { index = await fetchIndex(fetch, indexUrl, publicKey); } catch (err) {
    log.warn(`couldn't check for app updates: ${err.message}`);
    return { ...result, error: err.message };
  }
  const state = readUpdateState(updatesDir, fs, log);
  for (const app of apps) {
    const entry = index.apps[app.id];
    if (!entry || !VERSION.test(entry.version ?? '') || compareVersions(entry.version, app.version) <= 0) continue;
    if ((state.apps?.[app.id]?.bad || []).includes(entry.version)) continue;
    if ((entry.requires?.shellApi ?? 1) > shellApi) {
      log.info(`app "${app.id}" ${entry.version} needs shell API ${entry.requires.shellApi}; it arrives with the next NexusMD update`);
      result.needsShell.push({ id: app.id, version: entry.version });
      continue;
    }
    if (fs.existsSync(path.join(updatesDir, app.id, entry.version))) continue;     // downloaded, waiting for a restart
    try {
      await fetchVersion({ fetch, indexUrl, updatesDir, app, entry, fs });
      log.info(`app "${app.id}" ${entry.version} downloaded; it runs from the next launch`);
      result.downloaded.push({ id: app.id, version: entry.version });
    } catch (err) {
      log.error(`app "${app.id}" ${entry.version} couldn't be downloaded: ${err.message}`);
      result.failed.push({ id: app.id, version: entry.version, error: err.message });
    }
  }
  pruneDownloads({ apps, updatesDir, fs, log });
  return result;
}

// Checks shortly after launch, then every few hours. Returns { stop, check }: check() checks now
// (Settings' "Check for app updates"), sharing a check already under way, and resolves to its result.
function startAppUpdater({ delayMs = 30_000, everyMs = 6 * 60 * 60_000, onChecked = () => {}, ...options }) {
  let current = null;
  const check = () => {
    current ??= (async () => {
      try {
        const result = await checkAppUpdates(options);
        onChecked(result);
        return result;
      } finally { current = null; }
    })();
    return current;
  };
  const first = setTimeout(check, delayMs);
  const every = setInterval(check, everyMs);
  first.unref?.();
  every.unref?.();
  return { stop: () => { clearTimeout(first); clearInterval(every); }, check };
}

module.exports = { INDEX_URL, checkAppUpdates, pruneDownloads, startAppUpdater };
