// Encrypts app secrets at rest: ciphertext in localStorage under `nexusmd.sec.*`,
// non-extractable AES-GCM master key in IndexedDB (`nexusmd-keystore`). Crypto is
// shared via @nexusmd/web-adapters; only the namespace constants are app-specific.
import { createSecureStorageAdapter } from '@nexusmd/web-adapters'

export const secureStorageAdapter = createSecureStorageAdapter({
  encPrefix: 'nexusmd.sec.',
  dbName: 'nexusmd-keystore',
})
