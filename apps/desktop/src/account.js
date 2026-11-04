// account.js — the desktop's NexusMD account wiring for <AccountGate> and <AccountCard>: where the
// session and device id live, and how the sync engine reads this machine's settings.
import { createAccountClient, createAccountSync, createKeyRegistry, clearAccountLocalData, listUnpushed } from '@nexusmd/core'
import { buildProfileBundle } from '@nexusmd/ui'
import { secureStorageAdapter, bundleSecureStorage } from './adapters/secureStorage.js'
import { desktopFileIO } from './file-io.js'
import { appPrefsAdapter } from './adapters/appPrefs.js'
import { collectDesktopPrefs, applyDesktopPrefs } from './settings-file.js'
import { registry } from './shell/registry.js'

const API_BASE = import.meta.env.VITE_API_BASE || 'https://nexusmd-api-production.up.railway.app'

const SESSION_KEY = 'account.session'          // secure storage -> nexusmd.sec.account.session
const DEVICE_KEY  = 'nexusmd.account.deviceId' // never synced (the registry skips `.account.` keys)
const META_KEY    = 'nexusmd.account.meta'
const OPT_OUT_KEY = 'nexusmd.account.optOut'
const USER_KEY    = 'nexusmd.account.userId'  // the account this install's data belongs to; never synced or exported

// The session holds the refresh token and wrapped keys, so it is encrypted at rest like any secret.
const sessionStore = {
  async load() {
    const raw = await secureStorageAdapter.get(SESSION_KEY)
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  },
  async save(session) {
    if (session) await secureStorageAdapter.set(SESSION_KEY, JSON.stringify(session))
    else await secureStorageAdapter.remove(SESSION_KEY)
  },
}

const deviceStore = {
  get() { try { return localStorage.getItem(DEVICE_KEY) } catch { return null } },
  // set(null) clears the id (the gate does this after a confirmed account switch).
  set(id) {
    try {
      if (id == null) localStorage.removeItem(DEVICE_KEY)
      else localStorage.setItem(DEVICE_KEY, id)
    } catch { /* storage unavailable */ }
  },
}

// Per-device prefs owned by the main process; the sync keeps one encrypted blob of them per device.
const devicePrefs = {
  collect: () => collectDesktopPrefs(appPrefsAdapter),
  apply: (prefs) => applyDesktopPrefs(prefs, appPrefsAdapter, registry.installedApps.map(a => a.id)),
}

const keyRegistry = createKeyRegistry({ namespace: 'nexusmd' })

const client = createAccountClient({ baseUrl: API_BASE, sessionStore })

function createSync(containerKey, deviceId) {
  return createAccountSync({
    client,
    containerKey,
    registry: keyRegistry,
    storage: localStorage,
    secure: secureStorageAdapter,
    devicePrefs,
    deviceId,
    metaKey: META_KEY,
  })
}

function deviceNameDefault() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
  const os = /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : ''
  return os ? `${os} PC` : 'This computer'
}

export const account = {
  client, sessionStore, deviceStore, createSync,
  platform: 'windows',
  deviceNameDefault,
  optOutKey: OPT_OUT_KEY,
  boundUserKey: USER_KEY,
  // An account switch is blocked while this device holds content not synced yet (AccountGate).
  unpushed: () => listUnpushed({ registry: keyRegistry, storage: localStorage, metaKey: META_KEY }),
  // A .nmdprofile with secrets: every profile but purged ones, or one profile by id (a purged one
  // too: a pending purge still holds its data here). True once saved.
  exportBackup: async (password, scope = 'all') => {
    let profiles = []
    try { profiles = JSON.parse(localStorage.getItem('nexusmd.profiles') || '[]') } catch { profiles = [] }
    profiles = (Array.isArray(profiles) ? profiles : []).filter(p => p && typeof p.id === 'string' && (scope !== 'all' || !p.purgedAt))
    const { filename, text } = await buildProfileBundle({
      storage: localStorage, secure: bundleSecureStorage, namespace: 'nexusmd', profiles, scope,
      activeId: localStorage.getItem('nexusmd.activeProfileId'), password,
    })
    return desktopFileIO.saveFile(filename, text)
  },
  clearLocal: () => clearAccountLocalData({
    registry: keyRegistry,
    storage: localStorage,
    secure: secureStorageAdapter,
    metaKey: META_KEY,
  }),
}
