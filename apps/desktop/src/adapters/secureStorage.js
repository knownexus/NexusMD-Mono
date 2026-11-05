// Encrypts app secrets at rest: ciphertext in localStorage under `nexusmd.sec.*`,
// non-extractable AES-GCM master key in IndexedDB (`nexusmd-keystore`). Crypto is
// shared via @nexusmd/web-adapters; only the namespace constants are app-specific.
//
// The adapter the app uses is the shared secret cache (@nexusmd/shell-sdk profileSecrets)
// bound to the encrypted store: same async get/set/remove, plus a synchronous peek() for the
// tokens loaded at start. Every write through it (settings, account sync, the migration)
// keeps that cache current.
import { createSecureStorageAdapter } from '@nexusmd/web-adapters'
import { profileSecrets } from '@nexusmd/shell-sdk'
import { rendererLog, ignore } from '@nexusmd/core'

const log = rendererLog('core', 'secure-storage')

const encrypted = createSecureStorageAdapter({
  encPrefix: 'nexusmd.sec.',
  dbName: 'nexusmd-keystore',
})

profileSecrets.bind(encrypted)

export const secureStorageAdapter = profileSecrets

// What profile bundles (.nmdprofile) and profile purges use: the encrypted store keeps each
// secret's ciphertext at `nexusmd.sec.<name>`, so its names are listed from localStorage.
const SECRET_PREFIX = 'nexusmd.sec.'
export const bundleSecureStorage = {
  names: () => {
    const out = []
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(SECRET_PREFIX)) out.push(k.slice(SECRET_PREFIX.length))
      }
    } catch (err) { ignore(log, 'browser storage is unavailable, so no secrets are listed', err, 'warn') }
    return out
  },
  get: (name) => secureStorageAdapter.get(name),
  set: (name, value) => secureStorageAdapter.set(name, value),
  remove: (name) => secureStorageAdapter.remove(name),
}
