'use strict';

// Applies downloaded app updates while NexusMD runs, instead of waiting for the next launch. Each
// updated app's main-process side is stopped and its new version started (registerModules' restart),
// the running list and the module table are updated in place (the registry IPC and the updater read
// them), and the window reloads so it loads the new screens and preload bridge. An app with work in
// progress or windows open isn't stopped unless the caller says so (`force`), so the user can be asked.

const { compareVersions } = require('./app-registry.cjs');

const label = app => app.manifest?.label || app.id;

// The installed apps whose newest usable version (resolveApps) is newer than the one running.
// Switched-off apps aren't running, so they just take the new version at their next start.
function pendingUpdates(running, resolved, disabled = []) {
  const now = new Map(running.map(app => [app.id, app]));
  return resolved
    .filter(app => !disabled.includes(app.id) && now.has(app.id) && compareVersions(app.version, now.get(app.id).version) > 0)
    .map(app => ({ id: app.id, label: label(app), from: now.get(app.id).version, to: app.version }));
}

// running: the apps NexusMD runs (resolveApps at launch), updated in place. table: the module table
// (modulesFromScan), updated in place. started: registerModules' result. resolve(): resolveApps now.
// toModule(app): one app's module table entry. reload(): reloads the window.
async function applyAppUpdates({ running, table, started, resolve, toModule, reload, disabled = [], force = false, log = console }) {
  const result = { applied: [], busy: [], failed: [] };
  const resolved = resolve();
  const pending = pendingUpdates(running, resolved, disabled);
  if (!force) {
    for (const update of pending) {
      const busy = started.busy(update.id);
      if (busy.running || busy.windows) result.busy.push({ id: update.id, label: update.label, ...busy });
    }
    if (result.busy.length) return result;
  }
  for (const update of pending) {
    const next = resolved.find(app => app.id === update.id);
    const mod = toModule(next);
    const outcome = await started.restart(update.id, mod);
    if (!outcome.ok) {
      result.failed.push({ ...update, error: outcome.error });
      continue;
    }
    running.splice(running.findIndex(app => app.id === update.id), 1, next);
    table[update.id] = mod;
    log.info(`app "${update.id}" now runs ${update.to} (was ${update.from}), without a restart`);
    result.applied.push(update);
  }
  if (result.applied.length) reload();
  return result;
}

module.exports = { pendingUpdates, applyAppUpdates };
