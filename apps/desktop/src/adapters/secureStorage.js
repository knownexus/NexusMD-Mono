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

const encrypted = createSecureStorageAdapter({
  encPrefix: 'nexusmd.sec.',
  dbName: 'nexusmd-keystore',
})

profileSecrets.bind(encrypted)

export const secureStorageAdapter = profileSecrets
