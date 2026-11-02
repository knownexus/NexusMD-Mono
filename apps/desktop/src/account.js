// account.js — the desktop's NexusMD account wiring for <AccountGate> and <AccountCard>: where the
// session and device id live, and how the sync engine reads this machine's settings.
import { createAccountClient, createAccountSync, createKeyRegistry, clearAccountLocalData } from '@nexusmd/core'
import { secureStorageAdapter } from './adapters/secureStorage.js'
import { appPrefsAdapter } from './adapters/appPrefs.js'
import { collectDesktopPrefs, applyDesktopPrefs } from './settings-file.js'
import { registry } from './shell/registry.js'

const API_BASE = import.meta.env.VITE_API_BASE || 'https://nexusmd.app'

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
  set(id) { try { localStorage.setItem(DEVICE_KEY, id) } catch { /* storage unavailable */ } },
}

// Per-device prefs owned by the main process; the sync keeps one encrypted blob of them per device.
const devicePrefs = {
  collect: () => collectDesktopPrefs(appPrefsAdapter),
  apply: (prefs) => applyDesktopPrefs(prefs, appPrefsAdapter, registry.installedApps.map(a => a.id)),
}

const client = createAccountClient({ baseUrl: API_BASE, sessionStore })

function createSync(containerKey, deviceId) {
  return createAccountSync({
    client,
    containerKey,
    registry: createKeyRegistry({ namespace: 'nexusmd' }),
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
  clearLocal: () => clearAccountLocalData({
    registry: createKeyRegistry({ namespace: 'nexusmd' }),
    storage: localStorage,
    secure: secureStorageAdapter,
    metaKey: META_KEY,
  }),
}
