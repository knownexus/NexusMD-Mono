import { createRegistry } from '@nexusmd/shell-sdk'
import { appManifests } from './app-manifests.js'

// All apps this build knows about. While everything is still bundled in one renderer, the main
// process tells us which of them are actually installed.
export const BUNDLED_MANIFESTS = appManifests

// Registry for an installed set (null = all, as in dev, tests and Mac/Linux).
export function buildRegistry(installedIds = null) {
  return createRegistry({ manifests: BUNDLED_MANIFESTS, installedIds })
}

// The installed set as reported by the main process (preload `registry.get`). Falls back to
// "everything" when there is no bridge (tests, plain browser) or it reports nothing usable,
// so a missing answer can never leave the user with an empty app.
export function installedIdsFromHost(host = typeof window !== 'undefined' ? window.electronAPI : undefined) {
  try {
    const ids = host?.registry?.get?.()?.installedIds
    return Array.isArray(ids) && ids.length ? ids : null
  } catch { return null }
}

export const registry = buildRegistry(installedIdsFromHost())

// True for a view that no installed app owns: an app that isn't on this machine (a saved view, a
// deep link, the tray), or an id nobody has heard of. Settings is the shell's own.
export function isUninstalledView(viewId, reg = registry) {
  return viewId !== 'settings' && !reg.appForView(viewId)
}
