'use strict';

// Which apps are installed on this machine, and the main-process side of each app that has been
// split out into its own modules/<id> package.
//
// For now every app is still bundled in the one renderer, so the installed set is "all" unless
// NEXUSMD_APPS narrows it (dev and testing):
//   NEXUSMD_APPS=git,editor npm start
// A null installed set means "everything"; the renderer holds the manifests and applies it.

// Apps split into their own package. Loaded lazily, so an app that isn't installed is never even
// required. Each app's manifest names the preload bridge it needs (ipc.preload) and its main-process
// register(ctx) is called once at startup.
const MODULES = {
  'api-client': {
    manifest: () => require('@nexusmd/app-api-client/manifest'),
    main: () => require('@nexusmd/app-api-client/main'),
  },
  database: {
    manifest: () => require('@nexusmd/app-database/manifest'),
    main: () => require('@nexusmd/app-database/main'),
  },
  devenv: {
    manifest: () => require('@nexusmd/app-devenv/manifest'),
    main: () => require('@nexusmd/app-devenv/main'),
  },
  editor: {
    manifest: () => require('@nexusmd/app-editor/manifest'),
    main: () => require('@nexusmd/app-editor/main'),
  },
  work: {
    manifest: () => require('@nexusmd/app-work/manifest'),
    main: () => require('@nexusmd/app-work/main'),
  },
  git: {
    manifest: () => require('@nexusmd/app-git/manifest'),
    main: () => require('@nexusmd/app-git/main'),
  },
};

const path = require('path');
const nodeFs = require('fs');
const { pathToFileURL } = require('url');
const { SHELL_API } = require('./shell-api.cjs');

function parseInstalledIds(raw) {
  if (typeof raw !== 'string') return null;
  const ids = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return ids.length ? [...new Set(ids)] : null;
}

// ---------------------------------------------------------------------------
// The split layout: every app is a folder of its own, so an app that isn't ticked in the installer
// isn't on the disk at all.
//
//   <appsDir>/<id>/app.manifest.json
//   <appsDir>/<id>/renderer/index.js   (+ any .css)     loaded by the window
//   <appsDir>/<id>/main/index.cjs      (optional)       started here, bundled with its own dependencies
//
// appsDir is NEXUSMD_APPS_DIR, or resources/apps in an installed build that has one. Without either
// the build is all-in-one and the apps are the bundled MODULES above. updatesDir is where newer
// versions of those apps are downloaded (see resolveApps): NEXUSMD_APP_UPDATES_DIR, or userData/apps
// in an installed split build.
// ---------------------------------------------------------------------------
const APP_ID = /^[a-z][a-z0-9-]*$/;
const VERSION = /^\d+\.\d+\.\d+$/;

function getLayout(env = process.env, { isPackaged = false, resourcesPath = '', userDataPath = '', exists = nodeFs.existsSync } = {}) {
  const installedApps = isPackaged && resourcesPath ? path.join(resourcesPath, 'apps') : null;
  const appsDir = env.NEXUSMD_APPS_DIR || (installedApps && exists(installedApps) ? installedApps : null);
  const shellDir = env.NEXUSMD_SHELL_DIR || (appsDir && isPackaged && resourcesPath ? path.join(resourcesPath, 'renderer') : null);
  const updatesDir = env.NEXUSMD_APP_UPDATES_DIR || (appsDir && isPackaged && userDataPath ? path.join(userDataPath, 'apps') : null);
  return { appsDir, shellDir, updatesDir };
}

// One app folder, or an error saying why it isn't a usable app.
function readApp(dir, id, fs) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'app.manifest.json'), 'utf8'));
  if (manifest.id !== id) throw new Error(`its manifest says it is "${manifest.id}"`);
  const renderer = path.join(dir, 'renderer');
  if (!fs.existsSync(path.join(renderer, 'index.js'))) throw new Error('it has no renderer/index.js');
  const mainFile = path.join(dir, 'main', 'index.cjs');
  return {
    id,
    dir,
    manifest,
    version: manifest.version ?? null,
    rendererUrl: pathToFileURL(path.join(renderer, 'index.js')).href,
    styles: fs.readdirSync(renderer).filter(f => f.endsWith('.css')).sort().map(f => pathToFileURL(path.join(renderer, f)).href),
    mainFile: fs.existsSync(mainFile) ? mainFile : null,
    iconPath: fs.existsSync(path.join(dir, 'assets', 'icon.png')) ? path.join(dir, 'assets', 'icon.png') : null,
  };
}

// The apps found in appsDir. A folder that isn't a valid app (no manifest, a manifest naming another
// app, no renderer code) is skipped, so a half-copied or stray folder can't stop the others.
function scanApps(appsDir, { fs = nodeFs, log = console } = {}) {
  let names;
  try { names = fs.readdirSync(appsDir); } catch { return []; }
  const apps = [];
  for (const id of names.sort()) {
    if (!APP_ID.test(id)) continue;
    const dir = path.join(appsDir, id);
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      apps.push(readApp(dir, id, fs));
    } catch (err) {
      log.error(`app folder "${id}" is not a usable app, so it is skipped: ${err.message}`);
    }
  }
  return apps;
}

// ---------------------------------------------------------------------------
// App updates: newer versions of an installed app, each a complete app folder of its own, kept apart
// from appsDir (which an installer may have made read-only):
//
//   <updatesDir>/<id>/<version>/...   laid out like <appsDir>/<id>/ above
//   <updatesDir>/state.json           { "apps": { "<id>": { "bad": ["<version>", ...] } } }
//
// Anything else there (a download still being unpacked, say) is ignored.
// ---------------------------------------------------------------------------

// Compares x.y.z versions by number; a missing version is older than any other.
function compareVersions(a, b) {
  const parts = v => (v ? String(v).split('.').map(Number) : [-1]);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

function readUpdateState(updatesDir, fs, log) {
  const file = path.join(updatesDir, 'state.json');
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (err) {
    log.error(`app updates' state.json can't be read, so no version is treated as bad: ${err.message}`);
    return {};
  }
}

// The downloaded versions of one app, newest first. A folder that isn't a usable app, or holds a
// version other than the one it is named for, is skipped.
function downloadedVersions(updatesDir, id, fs, log) {
  let names;
  try { names = fs.readdirSync(path.join(updatesDir, id)); } catch { return []; }
  const apps = [];
  for (const version of names.filter(name => VERSION.test(name))) {
    try {
      const app = readApp(path.join(updatesDir, id, version), id, fs);
      if (app.version !== version) throw new Error(`its manifest says it is version ${app.version}`);
      apps.push(app);
    } catch (err) {
      log.error(`downloaded version ${version} of app "${id}" is not usable, so it is skipped: ${err.message}`);
    }
  }
  return apps.sort((a, b) => compareVersions(b.version, a.version));
}

// The apps to run: those in appsDir (as scanApps), each swapped for its newest downloaded version
// when that is newer, needs no newer shell than this one (manifest requires.shellApi), and hasn't
// been marked bad. Only installed apps are updated: an app that is only downloaded never starts.
// Each carries installedVersion, the version in appsDir, whichever version it runs.
function resolveApps(appsDir, { updatesDir = null, shellApi = SHELL_API, fs = nodeFs, log = console } = {}) {
  const installed = scanApps(appsDir, { fs, log }).map(app => ({ ...app, installedVersion: app.version }));
  if (!updatesDir) return installed;
  const state = readUpdateState(updatesDir, fs, log);
  return installed.map(app => {
    const bad = state.apps?.[app.id]?.bad || [];
    const update = downloadedVersions(updatesDir, app.id, fs, log).find(candidate => {
      if (compareVersions(candidate.version, app.version) <= 0 || bad.includes(candidate.version)) return false;
      // A manifest without the field was built before it existed, against the first shell API.
      const needs = candidate.manifest.requires?.shellApi ?? 1;
      if (needs > shellApi) {
        log.warn(`app "${app.id}" ${candidate.version} needs shell API ${needs} and this shell has ${shellApi}, so it waits for a NexusMD update`);
        return false;
      }
      return true;
    });
    if (!update) return app;
    log.info(`app "${app.id}" runs downloaded version ${update.version} (installed: ${app.version ?? 'unversioned'})`);
    return { ...update, installedVersion: app.version };
  });
}

// The MODULES table for scanned apps: the same shape, with the code coming from each app's folder.
function modulesFromScan(scanned) {
  return Object.fromEntries(scanned.map(app => [app.id, {
    manifest: () => app.manifest,
    main: app.mainFile ? () => require(app.mainFile) : null,
  }]));
}

// Which apps run: NEXUSMD_APPS narrows the set (dev and testing), and the apps the user has switched
// off in Settings (`disabled`, from prefs.json) are left out.
function installedModuleIds(env = process.env, modules = MODULES, disabled = []) {
  const installed = parseInstalledIds(env.NEXUSMD_APPS);
  return Object.keys(modules).filter(id => (!installed || installed.includes(id)) && !disabled.includes(id));
}

// What the window is told at startup. In the all-in-one build that is only the installed ids (null =
// all); in the split layout it also carries each installed app's manifest, code URL and stylesheets.
// disabledIds are installed apps switched off in Settings: the window leaves them out but lists them in
// Settings so they can be switched back on. In the split layout their code isn't loaded at all, so only
// their manifests are sent (split.disabled).
function getRegistryInfo(env = process.env, scanned = null, disabled = []) {
  const wanted = parseInstalledIds(env.NEXUSMD_APPS);
  if (!scanned) return { installedIds: wanted, disabledIds: disabled, split: null };
  const installed = scanned.filter(app => !wanted || wanted.includes(app.id));
  const off = installed.filter(app => disabled.includes(app.id));
  // Never all of them, or the window would have nothing to show (createRegistry does the same).
  const running = off.length === installed.length ? installed : installed.filter(app => !off.includes(app));
  return {
    installedIds: installed.map(app => app.id),
    disabledIds: running === installed ? [] : off.map(app => app.id),
    split: {
      apps: running.map(({ id, manifest, rendererUrl, styles }) => ({ id, manifest, rendererUrl, styles })),
      disabled: running === installed ? [] : off.map(app => app.manifest),
    },
  };
}

// The preload bridge the installed apps ask for: { namespace: { method: { invoke | send | on | webUtils } } }.
function getPreloadDescriptors(env = process.env, modules = MODULES, disabled = []) {
  const out = {};
  for (const id of installedModuleIds(env, modules, disabled)) {
    const namespaces = modules[id].manifest().ipc?.preload || {};
    for (const [ns, methods] of Object.entries(namespaces)) out[ns] = { ...out[ns], ...methods };
  }
  return out;
}

// The preload asks synchronously (it builds the renderer's startup state), so these are sendSync
// handlers: whatever is assigned to event.returnValue is the reply. Register before any window opens.
// `scanned` is the split layout's apps (from scanApps), or null for the all-in-one build. `disabled` is
// fixed for the session: switching an app on or off takes a restart.
function register(ipcMain, env = process.env, modules = MODULES, scanned = null, disabled = []) {
  ipcMain.on('registry:get', (event) => { event.returnValue = getRegistryInfo(env, scanned, disabled); });
  ipcMain.on('registry:preload-descriptors', (event) => { event.returnValue = getPreloadDescriptors(env, modules, disabled); });
}

// One app's view of ctx: the IPC it registers and the windows it opens are noted, so that stopping
// the app (to run a newer version without restarting NexusMD) can take them away again.
function scopeContext(ctx) {
  const handled = new Set();
  const listening = [];
  const windows = new Set();
  const scoped = { ...ctx };
  if (ctx.ipcMain) {
    const ipc = ctx.ipcMain;
    scoped.ipcMain = {
      handle: (channel, fn) => { ipc.handle(channel, fn); handled.add(channel); },
      handleOnce: (channel, fn) => { ipc.handleOnce(channel, fn); handled.add(channel); },
      removeHandler: (channel) => { ipc.removeHandler(channel); handled.delete(channel); },
      on: (channel, fn) => { ipc.on(channel, fn); listening.push([channel, fn]); return scoped.ipcMain; },
      once: (channel, fn) => { ipc.once(channel, fn); listening.push([channel, fn]); return scoped.ipcMain; },
      removeListener: (channel, fn) => { ipc.removeListener(channel, fn); return scoped.ipcMain; },
    };
  }
  if (ctx.BrowserWindow) {
    scoped.BrowserWindow = class extends ctx.BrowserWindow {
      constructor(...args) {
        super(...args);
        windows.add(this);
        this.on('closed', () => windows.delete(this));
      }
    };
  }
  return {
    ctx: scoped,
    windows: () => [...windows].filter(w => !w.isDestroyed()),
    release() {
      for (const channel of handled) ctx.ipcMain.removeHandler(channel);
      for (const [channel, fn] of listening) ctx.ipcMain.removeListener(channel, fn);
      for (const win of windows) if (!win.isDestroyed()) win.close();
      handled.clear();
      listening.length = 0;
    },
  };
}

// Starts each installed app's main-process side. One app failing to start never stops the others,
// and an app with no main-process side (most of them) simply has nothing to start.
// Returns { disposeAll } for shutdown, busy(id) and restart(id, module) for applying an update.
function registerModules(ctx, env = process.env, modules = MODULES, log = console, disabled = []) {
  const started = new Map();
  const start = (id, mod) => {
    const scope = scopeContext(ctx);
    try {
      started.set(id, { scope, handle: mod.main().register(scope.ctx) || null });
    } catch (err) {
      scope.release();
      throw err;
    }
  };
  const stop = async id => {
    const entry = started.get(id);
    if (!entry) return;
    started.delete(id);
    try { await entry.handle?.dispose?.(); } catch (err) { log.error(`app "${id}" failed to shut down`, err); }
    entry.scope.release();
  };
  for (const id of installedModuleIds(env, modules, disabled)) {
    if (!modules[id].main) continue;
    try { start(id, modules[id]); } catch (err) { log.error(`app "${id}" failed to start`, err); }
  }
  return {
    disposeAll: () => Promise.allSettled([...started.entries()].map(async ([id, { handle }]) => {
      try { await handle?.dispose?.(); } catch (err) { log.error(`app "${id}" failed to shut down`, err); }
    })),
    // What stopping the app now would interrupt: work it reports (handle.busy(), optional) and its windows.
    busy: id => {
      const entry = started.get(id);
      if (!entry) return { running: false, windows: 0 };
      let running = false;
      try { running = !!entry.handle?.busy?.(); } catch { /* an app that can't say is treated as idle */ }
      return { running, windows: entry.scope.windows().length };
    },
    // Stops the app and starts `next` (a MODULES entry) in its place. If the new version fails to
    // start, the previous one is started again, so the app keeps working.
    restart: async (id, next) => {
      const previous = modules[id];
      await stop(id);
      try {
        if (next.main) start(id, next);
        modules[id] = next;
        return { ok: true };
      } catch (err) {
        log.error(`app "${id}" failed to start its new version; going back to the one it was running`, err);
        try { if (previous?.main) start(id, previous); } catch (again) { log.error(`app "${id}" failed to start again`, again); }
        return { ok: false, error: err.message };
      }
    },
  };
}

module.exports = {
  MODULES, parseInstalledIds, getRegistryInfo, installedModuleIds, getPreloadDescriptors, register, registerModules,
  getLayout, scanApps, modulesFromScan, resolveApps, compareVersions, readApp, readUpdateState, VERSION,
};
