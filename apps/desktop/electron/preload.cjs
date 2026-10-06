'use strict';

const { contextBridge, ipcRenderer } = require('electron');

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
   * Get whether the app should hide to tray on close (vs. quit fully).
   * @returns {Promise<boolean>}
   */
  getCloseToTray: () => ipcRenderer.invoke('get-close-to-tray'),

  /**
   * Set the close-to-tray preference.
   * @param {boolean} enabled
   * @returns {Promise<void>}
   */
  setCloseToTray: (enabled) => ipcRenderer.invoke('set-close-to-tray', enabled),

  /**
   * Open a native folder-picker dialog and return the chosen path (or null).
   * @returns {Promise<string|null>}
   */
  pickOutputFolder: () => ipcRenderer.invoke('pick-output-folder'),

  /**
   * Write content to filename inside folder (or ~/Downloads if folder is falsy).
   * @param {string} filename
   * @param {string} content
   * @param {string|null} folder
   * @returns {Promise<string>} resolved file path
   */
  saveFile: (filename, content, folder) => ipcRenderer.invoke('save-file', { filename, content, folder }),

  // ── Cloud OAuth IPC ─────────────────────────────────────────────────────────
  // Open the system browser for cloud sign-in, and receive the nexusmd:// deep
  // link the backend redirects back to (carries the one-time code).
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Open a link as a tab in the shared link window (replaces window.open for
  // ADO/PR/etc. links so they don't spawn one native window per link).
  openLink: (url) => ipcRenderer.invoke('link-window:open', url),
  onDeepLink: (cb) => {
    const handler = (_e, url) => cb(url);
    ipcRenderer.on('deepLink:url', handler);
    return () => ipcRenderer.removeListener('deepLink:url', handler);
  },

  // ── Zoom IPC ────────────────────────────────────────────────────────────────
  // Drive the native whole-app zoom engine from the Appearance settings slider.
  getZoomFactor: () => ipcRenderer.invoke('get-zoom-factor'),
  setZoomFactor: (factor) => ipcRenderer.invoke('set-zoom-factor', factor),
  onZoomChanged: (cb) => {
    const handler = (_e, factor) => cb(factor);
    ipcRenderer.on('zoom:changed', handler);
    return () => ipcRenderer.removeListener('zoom:changed', handler);
  },

  // ── File adapter IPC ────────────────────────────────────────────────────────
  file: {
    read:              (filePath)        => ipcRenderer.invoke('file:read', filePath),
    write:             (filePath, text)  => ipcRenderer.invoke('file:write', filePath, text),
    exists:            (filePath)        => ipcRenderer.invoke('file:exists', filePath),
    list:              (dirPath)         => ipcRenderer.invoke('file:list', dirPath),
    delete:            (filePath)        => ipcRenderer.invoke('file:delete', filePath),
    mkdir:             (dirPath)         => ipcRenderer.invoke('file:mkdir', dirPath),
    defaultProfileDir: ()               => ipcRenderer.invoke('file:defaultProfileDir'),
  },

  // ── Picker adapter IPC ──────────────────────────────────────────────────────
  picker: {
    pickFile:      (filter) => ipcRenderer.invoke('picker:pickFile', filter),
    pickDirectory: ()       => ipcRenderer.invoke('picker:pickDirectory'),
    saveFile:      (name, text) => ipcRenderer.invoke('picker:saveFile', name, text),
  },

  // ── Badge adapter IPC ───────────────────────────────────────────────────────
  badge: {
    set:   (count) => ipcRenderer.invoke('badge:set', count),
    clear: ()      => ipcRenderer.invoke('badge:clear'),
  },

  // ── Deep link IPC ───────────────────────────────────────────────────────────
  onDeepLink: (callback) => {
    ipcRenderer.removeAllListeners('deepLink:url');
    ipcRenderer.on('deepLink:url', (_event, url) => callback(url));
  },
  removeDeepLinkListener: () => ipcRenderer.removeAllListeners('deepLink:url'),

  // ── Tray adapter IPC ────────────────────────────────────────────────────────
  tray: {
    setTooltip:     (text)  => ipcRenderer.invoke('tray:setTooltip', text),
    setContextMenu: (items) => ipcRenderer.invoke('tray:setContextMenu', items),
    show:           ()      => ipcRenderer.invoke('tray:show'),
    hide:           ()      => ipcRenderer.invoke('tray:hide'),
    onActivate: (callback) => {
      ipcRenderer.removeAllListeners('tray:menuClick');
      ipcRenderer.on('tray:menuClick', (_event, label) => callback(label));
    },
  },

  // ── Database Manager adapter IPC ───────────────────────────────────────────
  dbManager: {
    connect:    (type, config) =>
      ipcRenderer.invoke('db-manager:connect',    { type, config }),
    getRows:    (type, config, table, limit, offset) =>
      ipcRenderer.invoke('db-manager:get-rows',   { type, config, table, limit, offset }),
    deleteRows: (type, config, table, primaryKey, values) =>
      ipcRenderer.invoke('db-manager:delete-rows', { type, config, table, primaryKey, values }),
    updateCell: (type, config, table, primaryKey, primaryValue, column, value) =>
      ipcRenderer.invoke('db-manager:update-cell', { type, config, table, primaryKey, primaryValue, column, value }),
    runQuery:   (type, config, sql) =>
      ipcRenderer.invoke('db-manager:run-query',  { type, config, sql }),
    getColumns: (type, config, table) =>
      ipcRenderer.invoke('db-manager:get-columns', { type, config, table }),
  },

  // ── Jira proxy IPC ──────────────────────────────────────────────────────────
  jira: {
    request: (req) => ipcRenderer.invoke('jira:request', req),
  },

  // ── nativeTheme (used by theme adapter) ────────────────────────────────────
  // One-time read of the native theme preference.
  getNativeTheme: () => ipcRenderer.invoke('get-native-theme'),

  // Platform identifier — lets the renderer show/hide custom window controls
  // without an extra IPC round-trip.
  platform: process.platform,

  // Custom window controls (replaces native titleBarOverlay on Win/Linux).
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close:    () => ipcRenderer.send('window:close'),
  },

  // ── Notification (renderer → main) ─────────────────────────────────────────
  showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),

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
    check:   () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.invoke('updater:install'),
    onAvailable: (callback) => {
      ipcRenderer.removeAllListeners('updater:available');
      ipcRenderer.on('updater:available', (_event, info) => callback(info));
      return () => ipcRenderer.removeAllListeners('updater:available');
    },
  },

  // ── Logs viewer IPC ────────────────────────────────────────────────────────
  logs: {
    list:   () => ipcRenderer.invoke('logs:list'),
    read:   (date) => ipcRenderer.invoke('logs:read', { date }),
    delete: (date) => ipcRenderer.invoke('logs:delete', { date }),
  },

  // ── OAuth (native desktop flow) ────────────────────────────────────────────
  oauth: {
    start:   (provider = 'google') => ipcRenderer.invoke('oauth:start', { provider }),
    refresh: (refreshToken, provider = 'google') => ipcRenderer.invoke('oauth:refresh', { provider, refreshToken }),
  },

  // ── API client module (scriptRunner adapter) ───────────────────────────────
  apiClient: {
    script: {
      run: (script, context) => ipcRenderer.invoke('api-client:script:run', script, context),
    },
  },
});
