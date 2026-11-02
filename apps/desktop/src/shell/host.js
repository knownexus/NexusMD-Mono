import { capabilities } from './capabilities.js'
import { registry } from './registry.js'
import { appQueue, flushQueue } from '../offline-queue-app.js'
import { makeShellOAuthService, makeNativeGoogleBinding } from '../cloud-auth.js'
import { desktopSync } from '../sync.js'
import { secureStorageAdapter } from '../adapters/secureStorage.js'
import { pickerAdapter } from '../adapters/picker.js'
import { artifactsAdapter } from '../adapters/artifacts.js'
import { windowControlsAdapter } from '../adapters/windowControls.js'

// Everything an installed app may ask of the shell. Apps never import each other or the shell's
// files; they get this object instead (as the `host` prop of their views and in `activate(host)`).
//
//   capabilities   what apps offer each other: provide(name, fn) / has(name) / call(name, ...args)
//   isInstalled    whether an app is installed on this machine
//   navigate       switch the shell to a view
//   cloud          the shell's Google/Microsoft sign-in (the Accounts card in Settings)
//   sync           the shell's cloud backup
//   adapters       the shell's own adapters apps may use: secureStorage (saved passwords), picker (file dialogs), windowControls,
//                  artifacts (saveArtifact(item, { pat, org? }) -> { saved, path? }: a build artifact saved where the user picks)
//   offlineQueue   provider writes kept while offline: run(kind, payload, label) -> { done, result } | { queued: true },
//                  count(), flush(). An app that can send them provides the 'work.offlineSend' capability.
export { capabilities }

// An app can ask for a view while the page is still loading (the Editor does, for a file the app was
// launched with), before the shell has mounted and started listening. The latest such request waits
// here for the shell to pick up when it starts (and is cleared whenever it hears one).
let waitingView = null
export function takeWaitingNavigation() {
  const view = waitingView
  waitingView = null
  return view
}

export const host = {
  capabilities,
  isInstalled: id => registry.isInstalled(id),
  navigate: view => {
    waitingView = view
    window.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: view }))
  },
  // Looked up when called, not when this file loads.
  cloud: {
    makeOAuthService: (...args) => makeShellOAuthService(...args),
    makeNativeGoogleBinding: (...args) => makeNativeGoogleBinding(...args),
  },
  sync: { syncOnce: () => desktopSync.syncOnce() },
  adapters: { secureStorage: secureStorageAdapter, picker: pickerAdapter, windowControls: windowControlsAdapter, artifacts: artifactsAdapter },
  offlineQueue: {
    run: (kind, payload, label) => appQueue.run(kind, payload, label),
    count: () => appQueue.count(),
    flush: () => flushQueue(),
  },
}
