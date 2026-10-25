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
  git: {
    manifest: () => require('@nexusmd/app-git/manifest'),
    main: () => require('@nexusmd/app-git/main'),
  },
};

function parseInstalledIds(raw) {
  if (typeof raw !== 'string') return null;
  const ids = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return ids.length ? [...new Set(ids)] : null;
}

function getRegistryInfo(env = process.env) {
  return { installedIds: parseInstalledIds(env.NEXUSMD_APPS) };
}

// Split-out apps that are installed, given the installed set (null = all of them).
function installedModuleIds(env = process.env, modules = MODULES) {
  const installed = parseInstalledIds(env.NEXUSMD_APPS);
  return Object.keys(modules).filter(id => !installed || installed.includes(id));
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
function register(ipcMain, env = process.env, modules = MODULES) {
  ipcMain.on('registry:get', (event) => { event.returnValue = getRegistryInfo(env); });
  ipcMain.on('registry:preload-descriptors', (event) => { event.returnValue = getPreloadDescriptors(env, modules); });
}

// Starts each installed app's main-process side. One app failing to start never stops the others.
// Returns { disposeAll } for shutdown.
function registerModules(ctx, env = process.env, modules = MODULES, log = console) {
  const handles = [];
  for (const id of installedModuleIds(env, modules)) {
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

module.exports = { MODULES, parseInstalledIds, getRegistryInfo, installedModuleIds, getPreloadDescriptors, register, registerModules };
