'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

let installedInfo;

// ── Recording ───────────────────────────────────────────────────────────────
// While a recording runs the main process tells every window (`trace:state`). This file runs in the window's isolated
// world and cannot see the page's own code, so the page registers a function that says which of its calls is running
// (electronAPI.trace.setContextProvider). Before each IPC call made during a recording the call is noted for the main
// process (`trace:ctx`), so what it causes there is shown under it. Messages from one window arrive in order, which is
// what lets the main process match the note to the call that follows it. Nothing about any channel changes.
let traceState = { recording: false };
let traceContext = null;
const traceListeners = new Set();
const NOT_RECORDED = /^(?:trace|recording|log|logs):/;

function noteCall(channel) {
  if (!traceState.recording || !traceContext || NOT_RECORDED.test(channel)) return;
  try {
    const callId = traceContext();
    if (typeof callId === 'string') ipcRenderer.send('trace:ctx', { callId, channel });
  } catch (err) {
    ipcRenderer.send('log:ingest', { lvl: 'warn', mod: 'core', scope: 'preload', msg: 'could not tell which call made an IPC call while recording', err: { name: String(err?.name ?? 'Error'), message: String(err?.message ?? err) } });
  }
}
// Every IPC call this file makes goes through these two.
const invoke = (channel, ...args) => { noteCall(channel); return ipcRenderer.invoke(channel, ...args); };
const send = (channel, ...args) => { noteCall(channel); return ipcRenderer.send(channel, ...args); };

ipcRenderer.on('trace:state', (_event, state) => {
  traceState = state && typeof state === 'object' ? state : { recording: false };
  for (const callback of traceListeners) callback(traceState);
});

// Turns an app's bridge description into functions. Each method is described by one of:
//   { invoke: channel }   invoke(channel, ...args)  -> Promise
//   { invoke, pack: [names] }  the same, but the arguments go as one object keyed by `pack`
//                         (db-manager style: invoke(channel, { type, config }))
//   { send: channel }     send(channel, ...args)
//   { on: channel }       subscribe(callback) -> unsubscribe; callback gets the event's arguments
//   { webUtils: name }    a webUtils helper (e.g. the real path of a dropped File)
// A sandboxed preload can't load other files, so this lives here rather than in a shared module.
function buildAppApi(descriptors) {
  const api = {};
  for (const [ns, methods] of Object.entries(descriptors || {})) {
    api[ns] = {};
    for (const [fullName, spec] of Object.entries(methods)) {
      // "script.run" becomes api[ns].script.run
      const path = fullName.split('.');
      const name = path.pop();
      const target = path.reduce((obj, key) => (obj[key] ??= {}), api[ns]);
      if (spec.invoke && spec.pack) {
        target[name] = (...args) => invoke(spec.invoke, Object.fromEntries(spec.pack.map((key, i) => [key, args[i]])));
      } else if (spec.invoke) target[name] = (...args) => invoke(spec.invoke, ...args);
      else if (spec.send) target[name] = (...args) => send(spec.send, ...args);
      else if (spec.on) {
        target[name] = (callback) => {
          const handler = (_event, ...args) => callback(...args);
          ipcRenderer.on(spec.on, handler);
          return () => ipcRenderer.removeListener(spec.on, handler);
        };
      } else if (spec.webUtils && typeof webUtils[spec.webUtils] === 'function') {
        target[name] = (...args) => webUtils[spec.webUtils](...args);
      }
    }
  }
  return api;
}

// Expose a safe, narrow API to the renderer process.
// The React SPA can call window.electronAPI.* for native features.
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Listen for navigation requests sent from the tray menu.
   * @param {(route: string) => void} callback
   */
  onNavigate: callback => {
    // Remove any previously registered listener before adding a new one to
    // prevent accumulation if the renderer calls onNavigate more than once
    // (e.g. during hot-reload or React StrictMode double-invocations).
    ipcRenderer.removeAllListeners('navigate');
    ipcRenderer.on('navigate', (_event, route) => callback(route));
  },

  /**
   * Remove the navigate listener (cleanup).
   */
  removeNavigateListener: () => {
    ipcRenderer.removeAllListeners('navigate');
  },

  /**
   * Get whether the app is set to open at login.
   * @returns {Promise<boolean>}
   */
  getLoginItemEnabled: () => invoke('get-login-item-enabled'),

  /**
   * Set whether the app should open at login.
   * @param {boolean} enabled
   * @returns {Promise<void>}
   */
  setLoginItemEnabled: (enabled) => invoke('set-login-item-enabled', enabled),

  /**
   * Get whether the app should hide to tray on close (vs. quit fully).
   * @returns {Promise<boolean>}
   */
  getCloseToTray: () => invoke('get-close-to-tray'),

  /**
   * Set the close-to-tray preference.
   * @param {boolean} enabled
   * @returns {Promise<void>}
   */
  setCloseToTray: (enabled) => invoke('set-close-to-tray', enabled),

  /**
   * Open a native folder-picker dialog and return the chosen path (or null).
   * @returns {Promise<string|null>}
   */
  pickOutputFolder: () => invoke('pick-output-folder'),

  /**
   * Write content to filename inside folder (or ~/Downloads if folder is falsy).
   * @param {string} filename
   * @param {string} content
   * @param {string|null} folder
   * @returns {Promise<string>} resolved file path
   */
  saveFile: (filename, content, folder) => invoke('save-file', { filename, content, folder }),

  // ── Cloud OAuth IPC ─────────────────────────────────────────────────────────
  // Open the system browser for cloud sign-in, and receive the nexusmd:// deep
  // link the backend redirects back to (carries the one-time code).
  openExternal: (url) => invoke('open-external', url),

  // Open a link as a tab in the shared link window (replaces window.open for
  // ADO/PR/etc. links so they don't spawn one native window per link).
  openLink: (url) => invoke('link-window:open', url),
  onDeepLink: (cb) => {
    const handler = (_e, url) => cb(url);
    ipcRenderer.on('deepLink:url', handler);
    return () => ipcRenderer.removeListener('deepLink:url', handler);
  },

  // ── Zoom IPC ────────────────────────────────────────────────────────────────
  // Drive the native whole-app zoom engine from the Appearance settings slider.
  getZoomFactor: () => invoke('get-zoom-factor'),
  setZoomFactor: (factor) => invoke('set-zoom-factor', factor),
  onZoomChanged: (cb) => {
    const handler = (_e, factor) => cb(factor);
    ipcRenderer.on('zoom:changed', handler);
    return () => ipcRenderer.removeListener('zoom:changed', handler);
  },

  // ── File adapter IPC ────────────────────────────────────────────────────────
  file: {
    read:              (filePath)        => invoke('file:read', filePath),
    write:             (filePath, text)  => invoke('file:write', filePath, text),
    exists:            (filePath)        => invoke('file:exists', filePath),
    list:              (dirPath)         => invoke('file:list', dirPath),
    listDirs:          (dirPath)         => invoke('file:listDirs', dirPath),
    delete:            (filePath)        => invoke('file:delete', filePath),
    mkdir:             (dirPath)         => invoke('file:mkdir', dirPath),
    defaultProfileDir: ()               => invoke('file:defaultProfileDir'),
  },

  // ── Picker adapter IPC ──────────────────────────────────────────────────────
  picker: {
    pickFile:      (filter) => invoke('picker:pickFile', filter),
    pickDirectory: ()       => invoke('picker:pickDirectory'),
    saveFile:      (name, text) => invoke('picker:saveFile', name, text),
  },

  // ── Build artifacts ─────────────────────────────────────────────────────────
  // Saves a build artifact where the user picks. Sends the item and its provider's token only;
  // the main process builds the headers and decides where the token may go.
  artifacts: {
    save: (item, credentials) => invoke('artifacts:save', { item, credentials }),
  },

  // ── Badge adapter IPC ───────────────────────────────────────────────────────
  badge: {
    set:   (count) => invoke('badge:set', count),
    clear: ()      => invoke('badge:clear'),
  },

  // ── Deep link IPC ───────────────────────────────────────────────────────────
  onDeepLink: (callback) => {
    ipcRenderer.removeAllListeners('deepLink:url');
    ipcRenderer.on('deepLink:url', (_event, url) => callback(url));
  },
  removeDeepLinkListener: () => ipcRenderer.removeAllListeners('deepLink:url'),
  // The link the app was started with (Windows passes it as an argument), once.
  takeInitialDeepLink: () => invoke('deepLink:take-initial'),

  // ── Tray adapter IPC ────────────────────────────────────────────────────────
  tray: {
    setTooltip:     (text)  => invoke('tray:setTooltip', text),
    setContextMenu: (items) => invoke('tray:setContextMenu', items),
    show:           ()      => invoke('tray:show'),
    hide:           ()      => invoke('tray:hide'),
    onActivate: (callback) => {
      ipcRenderer.removeAllListeners('tray:menuClick');
      ipcRenderer.on('tray:menuClick', (_event, label) => callback(label));
    },
  },



  // ── nativeTheme (used by theme adapter) ────────────────────────────────────
  // One-time read of the native theme preference.
  getNativeTheme: () => invoke('get-native-theme'),

  // Platform identifier — lets the renderer show/hide custom window controls
  // without an extra IPC round-trip.
  platform: process.platform,

  // Custom window controls (replaces native titleBarOverlay on Win/Linux).
  window: {
    minimize: () => send('window:minimize'),
    maximize: () => send('window:maximize'),
    close:    () => send('window:close'),
  },

  // ── Display (the screen the window is on; electron/ipc/display.cjs) ─────────
  // get() → { id, width, height, scaleFactor, physicalWidth, physicalHeight }; onChange(cb) → unsubscribe.
  display: {
    get: () => invoke('display:get'),
    onChange: (callback) => {
      const listener = (_e, d) => callback(d);
      ipcRenderer.on('display:changed', listener);
      return () => ipcRenderer.removeListener('display:changed', listener);
    },
  },

  // ── Notification (renderer → main) ─────────────────────────────────────────
  showNotification: (title, body) => send('show-notification', { title, body }),

  // ── Refresh (F5 menu accelerator → renderer) ────────────────────────────────
  // F5 sends this instead of reloading the window, so it triggers the same
  // data refresh as the in-app Refresh button rather than resetting navigation
  // state back to the dashboard.
  onRefreshData: (callback) => {
    ipcRenderer.removeAllListeners('refresh-data');
    ipcRenderer.on('refresh-data', () => callback());
  },

  // ── Auto-update (IUpdateAdapter) ───────────────────────────────────────────
  update: {
    check:   () => invoke('updater:check'),
    install: () => invoke('updater:install'),
    onAvailable: (callback) => {
      ipcRenderer.removeAllListeners('updater:available');
      ipcRenderer.on('updater:available', (_event, info) => callback(info));
      return () => ipcRenderer.removeAllListeners('updater:available');
    },
  },

  // ── App updates (newer versions of the installed apps) ─────────────────────
  // pending() lists the downloaded updates not yet running; apply() runs them now (the window
  // reloads), unless an updated app is busy and `force` isn't set, when it says which.
  appUpdates: {
    pending: () => invoke('app-updates:pending'),
    check:   () => invoke('app-updates:check'),
    apply:   (opts) => invoke('app-updates:apply', opts),
    onReady: (callback) => {
      const handler = (_event, ready) => callback(ready);
      ipcRenderer.on('app-updates:ready', handler);
      return () => ipcRenderer.removeListener('app-updates:ready', handler);
    },
  },

  // ── Logs viewer IPC ────────────────────────────────────────────────────────
  logs: {
    list:   () => invoke('logs:list'),
    read:   (date) => invoke('logs:read', { date }),
    delete: (date) => invoke('logs:delete', { date }),
    // The per-module logs (what the log hub wrote):
    //   modules()          [{ mod, days: [{ date, size }] }]
    //   query({ date, mods, levels, text, limit })   { entries, truncated, skipped }
    //   follow(cid)        everything one call did across modules: { entries, modules, truncated, skipped }
    //   tailStart()        starts the live tail; resolves with the most recent entries
    //   onEntries(cb)      cb(batch) for each batch of new entries while the tail is on; returns unsubscribe
    //   tailStop()
    modules:   () => invoke('logs:modules'),
    query:     (q) => invoke('logs:query', q),
    follow:    (cid) => invoke('logs:follow', cid),
    tailStart: () => invoke('logs:tail-start'),
    tailStop:  () => invoke('logs:tail-stop'),
    onEntries: (callback) => {
      const handler = (_event, batch) => callback(batch);
      ipcRenderer.on('logs:entries', handler);
      return () => ipcRenderer.removeListener('logs:entries', handler);
    },
  },

  // ── Renderer logging ───────────────────────────────────────────────────────
  // ingest(entry): the renderer's logger and error hooks send entries to the shell's log hub, which
  // files them under the module they name. Fire and forget (packages/core/src/log.js).
  logging: {
    ingest: (entry) => send('log:ingest', entry),
  },

  // ── Recording ──────────────────────────────────────────────────────────────
  // The person's recordings (see the log viewer):
  //   start(label?)      begins one            stop()      ends it, resolves with its summary
  //   status()           { recording, id?, startedAt?, events?, capped? }
  //   list() / read(id) / remove(id)           the saved ones
  //   exportTo(id)       asks where to save it, resolves { saved }     importFile()   asks which file, resolves its summary or null
  //   onState(cb)        cb(status) when a recording starts or stops; returns unsubscribe
  recording: {
    start: (label) => invoke('recording:start', label),
    stop: () => invoke('recording:stop'),
    status: () => invoke('recording:status'),
    list: () => invoke('recording:list'),
    read: (id) => invoke('recording:read', id),
    remove: (id) => invoke('recording:remove', id),
    exportTo: (id) => invoke('recording:export', id),
    importFile: () => invoke('recording:import'),
    onState: (callback) => {
      const handler = (_event, state) => callback(state);
      ipcRenderer.on('trace:state', handler);
      return () => ipcRenderer.removeListener('trace:state', handler);
    },
  },

  // What the page's own recorder uses (packages/core/src/trace): push(events) sends a batch to the main process,
  // state() is the last state it was told (including this window's id as `win`), onState(cb) hears changes, and
  // setContextProvider(fn) registers the function that says which of the page's calls is running.
  trace: {
    push: (events) => ipcRenderer.send('trace:push', events),
    state: () => traceState,
    onState: (callback) => { traceListeners.add(callback); return () => traceListeners.delete(callback); },
    setContextProvider: (fn) => { traceContext = typeof fn === 'function' ? fn : null; },
  },

  // ── OAuth (native desktop flow) ────────────────────────────────────────────
  oauth: {
    start:   (provider = 'google') => invoke('oauth:start', { provider }),
    refresh: (refreshToken, provider = 'google') => invoke('oauth:refresh', { provider, refreshToken }),
  },


  // Which apps are installed on this machine. Answered once by the main process and kept; the
  // renderer reads it at startup to build the sidebar and Settings.
  registry: {
    get: () => (installedInfo ??= ipcRenderer.sendSync('registry:get')),
    // Saves which installed apps are switched off; they apply on the next start, so `restart` restarts now.
    setDisabled: (ids, opts) => invoke('apps:set-disabled', ids, opts),
    getDisabled: () => invoke('apps:get-disabled'),
  },

  // Namespaces (git, popout, ...) that the installed apps ask for, built from their manifests.
  ...buildAppApi(ipcRenderer.sendSync('registry:preload-descriptors')),
});
