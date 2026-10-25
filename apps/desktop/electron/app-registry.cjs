'use strict';

// Which apps are installed on this machine. For now every app is still bundled in the one
// renderer, so the answer is "all" unless NEXUSMD_APPS narrows it (dev and testing):
//   NEXUSMD_APPS=git,editor npm start
// A null result means "everything"; the renderer holds the manifests and applies it.

function parseInstalledIds(raw) {
  if (typeof raw !== 'string') return null;
  const ids = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return ids.length ? [...new Set(ids)] : null;
}

function getRegistryInfo(env = process.env) {
  return { installedIds: parseInstalledIds(env.NEXUSMD_APPS) };
}

// The preload asks synchronously (it builds the renderer's startup state), so this is a
// sendSync handler: whatever is assigned to event.returnValue is the reply.
function register(ipcMain, env = process.env) {
  ipcMain.on('registry:get', (event) => { event.returnValue = getRegistryInfo(env); });
}

module.exports = { parseInstalledIds, getRegistryInfo, register };
