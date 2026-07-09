'use strict';

const { BrowserWindow, WebContentsView, ipcMain } = require('electron');
const path = require('path');

const TAB_STRIP_HEIGHT = 36;

/** @type {Electron.BrowserWindow|null} */
let linkWindow = null;
/** @type {Electron.WebContentsView|null} */
let tabStripView = null;
/** @type {{id: number, url: string, title: string, view: Electron.WebContentsView}[]} */
let tabs = [];
let activeTabId = null;
let nextTabId = 1;

function serializeTabs() {
  return tabs.map(t => ({ id: t.id, title: t.title || t.url, url: t.url, active: t.id === activeTabId }));
}

function sendTabsUpdated() {
  if (tabStripView && !tabStripView.webContents.isDestroyed()) {
    tabStripView.webContents.send('link-window:tabsUpdated', serializeTabs());
  }
}

function layoutViews() {
  if (!linkWindow || linkWindow.isDestroyed()) return;
  const { width, height } = linkWindow.getContentBounds();
  tabStripView.setBounds({ x: 0, y: 0, width, height: TAB_STRIP_HEIGHT });
  const active = tabs.find(t => t.id === activeTabId);
  if (active) {
    active.view.setBounds({ x: 0, y: TAB_STRIP_HEIGHT, width, height: Math.max(0, height - TAB_STRIP_HEIGHT) });
  }
}

function createLinkWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Links',
    show: false,
  });

  tabStripView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'tab-strip-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  tabStripView.webContents.loadFile(path.join(__dirname, 'tab-strip.html'));
  // The tab strip's own script attaches its IPC listener only after this
  // fires, so re-send state here in case openLink()'s first update raced it.
  tabStripView.webContents.on('did-finish-load', sendTabsUpdated);
  win.contentView.addChildView(tabStripView);

  win.on('resize', layoutViews);
  win.on('closed', () => {
    linkWindow = null;
    tabStripView = null;
    tabs = [];
    activeTabId = null;
  });

  return win;
}

function isAllowedUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function createTabView(url) {
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (isAllowedUrl(url)) view.webContents.loadURL(url);
  return view;
}

function activateTab(id) {
  const current = tabs.find(t => t.id === activeTabId);
  const next = tabs.find(t => t.id === id);
  if (!next) return;

  if (current && current.id !== next.id) {
    linkWindow.contentView.removeChildView(current.view);
  }
  activeTabId = next.id;
  if (!current || current.id !== next.id) {
    linkWindow.contentView.addChildView(next.view);
  }

  layoutViews();
  sendTabsUpdated();
}

function openLink(url) {
  if (!isAllowedUrl(url)) return;

  if (!linkWindow || linkWindow.isDestroyed()) {
    linkWindow = createLinkWindow();
  }

  const id = nextTabId++;
  const view = createTabView(url);
  const tab = { id, url, title: url, view };
  tabs.push(tab);

  view.webContents.on('page-title-updated', (_event, title) => {
    tab.title = title;
    sendTabsUpdated();
  });

  // errorCode -3 is ABORTED, fired when a navigation is superseded by another
  // (e.g. redirects) — not a real failure, so it's ignored here.
  view.webContents.on('did-fail-load', (_event, errorCode, _description, _validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    view.webContents.loadFile(path.join(__dirname, 'error-page.html'), {
      hash: encodeURIComponent(tab.url),
    });
  });

  activateTab(id);
  linkWindow.show();
  linkWindow.focus();
}

function closeTab(id) {
  if (!linkWindow || linkWindow.isDestroyed()) return;

  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;

  const [tab] = tabs.splice(idx, 1);
  const wasActive = tab.id === activeTabId;

  if (wasActive) {
    linkWindow.contentView.removeChildView(tab.view);
    activeTabId = null;
  }

  if (tabs.length === 0) {
    linkWindow.close();
    return;
  }

  if (wasActive) {
    const fallback = tabs[idx] || tabs[idx - 1];
    activateTab(fallback.id);
  } else {
    sendTabsUpdated();
  }
}

function switchTab(id) {
  activateTab(id);
}

function refreshTab(id) {
  const tab = tabs.find(t => t.id === id);
  if (tab && !tab.view.webContents.isDestroyed()) tab.view.webContents.reload();
}

function register(ipc = ipcMain) {
  ipc.on('link-window:switchTab', (_event, id) => switchTab(id));
  ipc.on('link-window:closeTab', (_event, id) => closeTab(id));
  ipc.on('link-window:refreshTab', (_event, id) => refreshTab(id));
}

module.exports = { openLink, closeTab, switchTab, refreshTab, register, isAllowedUrl };
