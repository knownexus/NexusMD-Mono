// Encrypts app secrets at rest: ciphertext in localStorage under `helm.sec.*`,
// non-extractable AES-GCM master key in IndexedDB (`helm-keystore`). Crypto is
// shared via @nexusmd/web-adapters; only the namespace constants are app-specific.
import { createSecureStorageAdapter } from '@nexusmd/web-adapters'

export const secureStorageAdapter = createSecureStorageAdapter({
  encPrefix: 'helm.sec.',
  dbName: 'helm-keystore',
})
