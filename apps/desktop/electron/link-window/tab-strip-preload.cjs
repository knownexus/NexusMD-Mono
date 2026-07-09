'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('linkWindowAPI', {
  switchTab:  (id) => ipcRenderer.send('link-window:switchTab', id),
  closeTab:   (id) => ipcRenderer.send('link-window:closeTab', id),
  refreshTab: (id) => ipcRenderer.send('link-window:refreshTab', id),
  onTabsUpdated: (callback) => {
    ipcRenderer.removeAllListeners('link-window:tabsUpdated');
    ipcRenderer.on('link-window:tabsUpdated', (_event, tabs) => callback(tabs));
  },
});
