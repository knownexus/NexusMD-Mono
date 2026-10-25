import { createRegistry } from '@nexusmd/shell-sdk'
import bundledApps from './bundled-apps.json'

// All apps this build knows about. While everything is still bundled in one
// renderer, the main process tells us which of them are actually installed.
export const BUNDLED_MANIFESTS = bundledApps

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

// True for a view that belongs to an app this build knows but this machine doesn't have. Other
// ids (settings, unknown) are not "uninstalled" and keep their existing handling.
export function isUninstalledView(viewId, reg = registry) {
  return !reg.appForView(viewId) && !!buildRegistry().appForView(viewId)
}
