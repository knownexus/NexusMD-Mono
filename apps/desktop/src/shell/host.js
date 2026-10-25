import { createCapabilities } from '@nexusmd/shell-sdk'
import { registry } from './registry.js'
import { makeDesktopOAuthService, makeNativeGoogleBinding } from '../cloud-auth.js'
import { desktopSync } from '../sync.js'
import { secureStorageAdapter } from '../adapters/secureStorage.js'
import { pickerAdapter } from '../adapters/picker.js'

// Everything an installed app may ask of the shell. Apps never import each other or the shell's
// files; they get this object instead (as the `host` prop of their views and in `activate(host)`).
//
//   capabilities   what apps offer each other: provide(name, fn) / has(name) / call(name, ...args)
//   isInstalled    whether an app is installed on this machine
//   navigate       switch the shell to a view
//   cloud          the shell's Google/Microsoft sign-in (the Accounts card in Settings)
//   sync           the shell's cloud backup
//   adapters       the shell's own adapters apps may use: secureStorage (saved passwords), picker (file dialogs)
export const capabilities = createCapabilities()

export const host = {
  capabilities,
  isInstalled: id => registry.isInstalled(id),
  navigate: view => window.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: view })),
  // Looked up when called, not when this file loads.
  cloud: {
    makeOAuthService: (...args) => makeDesktopOAuthService(...args),
    makeNativeGoogleBinding: (...args) => makeNativeGoogleBinding(...args),
  },
  sync: { syncOnce: () => desktopSync.syncOnce() },
  adapters: { secureStorage: secureStorageAdapter, picker: pickerAdapter },
}
