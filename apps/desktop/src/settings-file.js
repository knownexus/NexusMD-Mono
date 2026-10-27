// settings-file.js — one password-encrypted file holding every setting on this machine, so
// a fresh install (or another PC) can be set up in one go: profiles and everything under them
// (ADO/Jira/GitHub tokens, git repos, database connections, dev environment, ...), the global
// keys outside any profile (theme, output folder, ...), the encrypted secrets (database
// passwords, OAuth client credentials, API-client secrets) and the desktop prefs held by the
// main process (close to tray, zoom, start on login, which installed apps are switched off).
//
// Secrets are stored encrypted under a key that never leaves this machine's IndexedDB, so the
// raw `nexusmd.sec.*` values would be useless elsewhere: they are decrypted on export, carried
// inside the password-encrypted file, and re-encrypted with the new machine's key on import.
import { encryptConfidentialForServer, decryptConfidentialFromServer } from '@nexusmd/core'

export const SETTINGS_FORMAT     = 'nexusmd-settings'
export const SETTINGS_FORMAT_ENC = 'nexusmd-settings-enc'
export const SETTINGS_VERSION    = 1
export const SETTINGS_EXT        = '.nmdsettings'

const SECRET_PREFIX = 'nexusmd.sec.'

// Caches and in-flight state: rebuilt on their own, and stale or wrong on another machine.
const SKIP = [
  /^nexusmd\.sec\./,           // carried decrypted in `secrets` instead
  /^nexusmd\.oauth\.pending$/,
  /^nexusmd\.sync\.base\./,
  /\.cache(\.v\d+)?$/,
  /\.wiTypeDefs\./,
  /\.git\.snapshot$/,
  /^nexusmd\.workitems\.status\.v\d+$/,
]

export const isExported = (key) => !SKIP.some(re => re.test(key))

// SHA-256(password + salt) as hex → AES-256-GCM key material. Own salt, so a settings file
// password can't be tried against a profile bundle's keyspace or the other way round.
async function keyHash(password) {
  const data = new TextEncoder().encode(password + ' nexusmd-settings-file')
  const buf  = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function encodeSettings(payload, password) {
  if (!password) throw new Error('A password is required.')
  const body = { ...payload, format: SETTINGS_FORMAT, version: SETTINGS_VERSION }
  const { iv, ciphertext } = await encryptConfidentialForServer(body, await keyHash(password))
  return JSON.stringify({ format: SETTINGS_FORMAT_ENC, version: SETTINGS_VERSION, iv, ciphertext }, null, 2)
}

export async function decodeSettings(text, password) {
  let wrapper
  try { wrapper = JSON.parse(text) } catch { throw new Error('Not a NexusMD settings file.') }
  if (!wrapper || wrapper.format !== SETTINGS_FORMAT_ENC || !wrapper.iv || !wrapper.ciphertext) {
    throw new Error('Not a NexusMD settings file.')
  }
  let payload
  try { payload = await decryptConfidentialFromServer({ iv: wrapper.iv, ciphertext: wrapper.ciphertext }, await keyHash(password)) }
  catch { throw new Error('Wrong password or corrupted file.') }
  if (!payload || payload.format !== SETTINGS_FORMAT || typeof payload.storage !== 'object') {
    throw new Error('Wrong password or corrupted file.')
  }
  return payload
}

const storageKeys = (storage) => {
  const keys = []
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k) keys.push(k)
  }
  return keys
}

// Everything to put in the file. `prefs` is the main-process bridge (appPrefsAdapter); any of
// its calls may be missing or fail, in which case that setting is just left out.
export async function collectSettings({ storage, secure, prefs }) {
  const keys = storageKeys(storage)

  const data = {}
  for (const k of keys) if (isExported(k)) data[k] = storage.getItem(k)

  const secrets = {}
  for (const k of keys) {
    if (!k.startsWith(SECRET_PREFIX)) continue
    const name  = k.slice(SECRET_PREFIX.length)
    const value = await secure.get(name)
    if (value != null) secrets[name] = value
  }

  const desktop = {}
  const read = async (field, fn) => {
    try { const v = await fn?.(); if (v !== undefined && v !== null) desktop[field] = v } catch { /* left out */ }
  }
  await read('closeToTray', () => prefs?.getCloseToTray())
  await read('zoomFactor',  () => prefs?.getZoomFactor())
  await read('openAtLogin', () => prefs?.getLoginItemEnabled())
  await read('disabledApps', () => prefs?.getDisabledApps())

  return { exportedAt: new Date().toISOString(), storage: data, secrets, desktop }
}

// Writes a decoded file's settings over this machine's. Keys the file doesn't mention are left
// as they are, so importing adds to and overwrites what's here but never deletes anything.
// `installedApps` is the ids of the apps on this machine, switched off or not.
export async function applySettings(payload, { storage, secure, prefs, installedApps = null }) {
  let keys = 0
  for (const [k, v] of Object.entries(payload.storage || {})) {
    if (!isExported(k) || typeof v !== 'string') continue
    storage.setItem(k, v)
    keys++
  }

  let secrets = 0
  for (const [name, v] of Object.entries(payload.secrets || {})) {
    if (typeof v !== 'string') continue
    await secure.set(name, v)
    secrets++
  }

  const d = payload.desktop || {}
  const write = async (fn) => { try { await fn() } catch { /* best-effort */ } }
  if (typeof d.closeToTray === 'boolean') await write(() => prefs?.setCloseToTray(d.closeToTray))
  if (typeof d.zoomFactor === 'number')   await write(() => prefs?.setZoomFactor(d.zoomFactor))
  if (typeof d.openAtLogin === 'boolean') await write(() => prefs?.setLoginItemEnabled(d.openAtLogin))
  // Apps the file has switched off. An app this machine doesn't have is simply never started, and
  // the change, like a switch in Settings, applies on the next start. A machine with fewer apps
  // could have every one of them switched off by the file; then they all stay on.
  let disabledApps = null
  if (Array.isArray(d.disabledApps)) {
    disabledApps = d.disabledApps.filter(id => typeof id === 'string')
    if (installedApps?.length && installedApps.every(id => disabledApps.includes(id))) disabledApps = []
    await write(() => prefs?.setDisabledApps(disabledApps))
  }

  return { keys, secrets, disabledApps }
}

export const settingsFilename = (date = new Date()) =>
  `nexusmd-settings-${date.toISOString().slice(0, 10)}${SETTINGS_EXT}`
