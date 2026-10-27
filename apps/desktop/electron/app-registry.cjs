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
// the build is all-in-one and the apps are the bundled MODULES above.
// ---------------------------------------------------------------------------
const APP_ID = /^[a-z][a-z0-9-]*$/;

function getLayout(env = process.env, { isPackaged = false, resourcesPath = '', exists = nodeFs.existsSync } = {}) {
  const installedApps = isPackaged && resourcesPath ? path.join(resourcesPath, 'apps') : null;
  const appsDir = env.NEXUSMD_APPS_DIR || (installedApps && exists(installedApps) ? installedApps : null);
  const shellDir = env.NEXUSMD_SHELL_DIR || (appsDir && isPackaged && resourcesPath ? path.join(resourcesPath, 'renderer') : null);
  return { appsDir, shellDir };
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
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'app.manifest.json'), 'utf8'));
      if (manifest.id !== id) throw new Error(`its manifest says it is "${manifest.id}"`);
      const renderer = path.join(dir, 'renderer');
      if (!fs.existsSync(path.join(renderer, 'index.js'))) throw new Error('it has no renderer/index.js');
      const mainFile = path.join(dir, 'main', 'index.cjs');
      apps.push({
        id,
        dir,
        manifest,
        rendererUrl: pathToFileURL(path.join(renderer, 'index.js')).href,
        styles: fs.readdirSync(renderer).filter(f => f.endsWith('.css')).sort().map(f => pathToFileURL(path.join(renderer, f)).href),
        mainFile: fs.existsSync(mainFile) ? mainFile : null,
        iconPath: fs.existsSync(path.join(dir, 'assets', 'icon.png')) ? path.join(dir, 'assets', 'icon.png') : null,
      });
    } catch (err) {
      log.error(`app folder "${id}" is not a usable app, so it is skipped: ${err.message}`);
    }
  }
  return apps;
}

// The MODULES table for scanned apps: the same shape, with the code coming from each app's folder.
function modulesFromScan(scanned) {
  return Object.fromEntries(scanned.map(app => [app.id, {
    manifest: () => app.manifest,
    main: app.mainFile ? () => require(app.mainFile) : null,
  }]));
}

// Which apps are installed: NEXUSMD_APPS narrows the set (dev and testing); null means everything.
function installedModuleIds(env = process.env, modules = MODULES) {
  const installed = parseInstalledIds(env.NEXUSMD_APPS);
  return Object.keys(modules).filter(id => !installed || installed.includes(id));
}

// What the window is told at startup. In the all-in-one build that is only the installed ids (null =
// all); in the split layout it also carries each installed app's manifest, code URL and stylesheets.
function getRegistryInfo(env = process.env, scanned = null) {
  if (!scanned) return { installedIds: parseInstalledIds(env.NEXUSMD_APPS), split: null };
  const wanted = parseInstalledIds(env.NEXUSMD_APPS);
  const apps = scanned.filter(app => !wanted || wanted.includes(app.id));
  return {
    installedIds: apps.map(app => app.id),
    split: { apps: apps.map(({ id, manifest, rendererUrl, styles }) => ({ id, manifest, rendererUrl, styles })) },
  };
}

// The preload bridge the installed apps ask for: { namespace: { method: { invoke | send | on | webUtils } } }.
function getPreloadDescriptors(env = process.env, modules = MODULES) {
  const out = {};
  for (const id of installedModuleIds(env, modules)) {
    const namespaces = modules[id].manifest().ipc?.preload || {};
    for (const [ns, methods] of Object.entries(namespaces)) out[ns] = { ...out[ns], ...methods };
  }
  return out;
}

// The preload asks synchronously (it builds the renderer's startup state), so these are sendSync
// handlers: whatever is assigned to event.returnValue is the reply. Register before any window opens.
// `scanned` is the split layout's apps (from scanApps), or null for the all-in-one build.
function register(ipcMain, env = process.env, modules = MODULES, scanned = null) {
  ipcMain.on('registry:get', (event) => { event.returnValue = getRegistryInfo(env, scanned); });
  ipcMain.on('registry:preload-descriptors', (event) => { event.returnValue = getPreloadDescriptors(env, modules); });
}

// Starts each installed app's main-process side. One app failing to start never stops the others,
// and an app with no main-process side (most of them) simply has nothing to start.
// Returns { disposeAll } for shutdown.
function registerModules(ctx, env = process.env, modules = MODULES, log = console) {
  const handles = [];
  for (const id of installedModuleIds(env, modules)) {
    if (!modules[id].main) continue;
    try {
      const handle = modules[id].main().register(ctx);
      if (handle) handles.push({ id, handle });
    } catch (err) {
      log.error(`app "${id}" failed to start`, err);
    }
  }
  return {
    disposeAll: () => Promise.allSettled(handles.map(async ({ id, handle }) => {
      try { await handle.dispose?.(); } catch (err) { log.error(`app "${id}" failed to shut down`, err); }
    })),
  };
}

module.exports = {
  MODULES, parseInstalledIds, getRegistryInfo, installedModuleIds, getPreloadDescriptors, register, registerModules,
  getLayout, scanApps, modulesFromScan,
};
