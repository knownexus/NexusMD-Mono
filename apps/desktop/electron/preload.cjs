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
   * Get whether the app is set to open at login.
   * @returns {Promise<boolean>}
   */
  getLoginItemEnabled: () => ipcRenderer.invoke('get-login-item-enabled'),

  /**
   * Set whether the app should open at login.
   * @param {boolean} enabled
   * @returns {Promise<void>}
   */
  setLoginItemEnabled: (enabled) => ipcRenderer.invoke('set-login-item-enabled', enabled),

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
  onDeepLink: (cb) => {
    const handler = (_e, url) => cb(url);
    ipcRenderer.on('deepLink:url', handler);
    return () => ipcRenderer.removeListener('deepLink:url', handler);
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

  // ── nativeTheme (used by theme adapter) ────────────────────────────────────
  // setTitlebarTheme already exists above — this adds the one-time read
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
});
