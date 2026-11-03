// account.js — the Android app's NexusMD account wiring for <AccountGate> and <AccountCard>: where
// the session and device id live, and how the sync engine reads this phone's settings.
// Runs after profile-migration.js (main.jsx imports that first), so profile ids are final here.
import { Device } from '@capacitor/device'
import { createAccountClient, createAccountSync, createKeyRegistry, clearAccountLocalData } from '@nexusmd/core'
import { secureStorageAdapter } from './adapters/secureStorage.js'
import { getActiveProfileId } from './profile-keys.js'

const API_BASE = import.meta.env.VITE_API_BASE || 'https://nexusmd.app'

const SESSION_KEY = 'account.session'         // secure storage -> helm.sec.account.session
const DEVICE_KEY  = 'helm.account.deviceId'   // never synced (the registry skips `.account.` keys)
const META_KEY    = 'helm.account.meta'
const OPT_OUT_KEY = 'helm.account.optOut'
const USER_KEY    = 'helm.account.userId'  // which account this install was last used by; never synced

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
  set(id) {
    try {
      if (id == null) localStorage.removeItem(DEVICE_KEY)   // the gate forgets the device on an account change
      else localStorage.setItem(DEVICE_KEY, id)
    } catch { /* storage unavailable */ }
  },
}

export const createRegistry = () => createKeyRegistry({ namespace: 'helm', getActiveProfileId })

const client = createAccountClient({ baseUrl: API_BASE, sessionStore })

function createSync(containerKey, deviceId) {
  return createAccountSync({
    client,
    containerKey,
    registry: createRegistry(),
    storage: localStorage,
    secure: secureStorageAdapter,
    devicePrefs: null,
    deviceId,
    metaKey: META_KEY,
  })
}

// deviceNameDefault must stay synchronous, so the plugin is asked once at load and the answer
// cached. Until it arrives (or if it never does) the generic name is used.
let cachedDeviceName = ''
export const deviceNameReady = (async () => {
  try {
    const info = await Device.getInfo()
    const name = String((info && info.name) || '').trim() || String((info && info.model) || '').trim()
    if (name) cachedDeviceName = name
  } catch { /* plugin unavailable: keep the fallback */ }
})()

function deviceNameDefault() {
  return cachedDeviceName || 'Android device'
}

// Wipes this install's synced settings and secrets when a different account signs in.
function clearLocal() {
  return clearAccountLocalData({
    registry: createKeyRegistry({ namespace: 'helm' }),
    storage: localStorage,
    secure: secureStorageAdapter,
    metaKey: META_KEY,
  })
}

export const account = {
  client, sessionStore, deviceStore, createSync,
  platform: 'android',
  deviceNameDefault,
  optOutKey: OPT_OUT_KEY,
  boundUserKey: USER_KEY,
  clearLocal,
}
