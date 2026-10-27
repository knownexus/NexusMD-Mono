import { createRegistry } from '@nexusmd/shell-sdk'
import { appManifests } from './app-manifests.js'

// All apps this build knows about. While everything is still bundled in one renderer, the main
// process tells us which of them are actually installed.
export const BUNDLED_MANIFESTS = appManifests

// Registry for an installed set (null = all, as in dev, tests and Mac/Linux), less the apps the
// user has switched off. `extraManifests` are switched-off apps whose code wasn't loaded (the split
// layout), so Settings can still list them.
export function buildRegistry(installedIds = null, disabledIds = null, extraManifests = []) {
  const known = new Set(BUNDLED_MANIFESTS.map(m => m.id))
  const manifests = [...BUNDLED_MANIFESTS, ...extraManifests.filter(m => !known.has(m.id))]
  return createRegistry({ manifests, installedIds, disabledIds })
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

// The installed apps switched off in Settings, and the manifests of those the split layout didn't load.
export function disabledFromHost(host = typeof window !== 'undefined' ? window.electronAPI : undefined) {
  try {
    const info = host?.registry?.get?.()
    const ids = Array.isArray(info?.disabledIds) ? info.disabledIds : []
    const manifests = Array.isArray(info?.split?.disabled) ? info.split.disabled : []
    return { ids, manifests }
  } catch { return { ids: [], manifests: [] } }
}

const disabled = disabledFromHost()
export const registry = buildRegistry(installedIdsFromHost(), disabled.ids, disabled.manifests)

// The web app's names for views the desktop calls something else. Shared screens (@nexusmd/ui) were
// written for the web app, so their links use its names: the Dashboard's PR tile asks for 'pr'.
const VIEW_ALIASES = { pr: 'prs' }
export const resolveView = viewId => VIEW_ALIASES[viewId] || viewId

// True for a view that no installed app owns: an app that isn't on this machine (a saved view, a
// deep link, the tray), or an id nobody has heard of. Settings is the shell's own.
export function isUninstalledView(viewId, reg = registry) {
  return viewId !== 'settings' && !reg.appForView(viewId)
}
