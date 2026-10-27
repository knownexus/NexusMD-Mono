import { validateManifest } from './manifest.js'

export const COMBINED_PRODUCT_NAME = 'NexusMD'

// Builds the view of "which apps are installed" the shell works from.
//   manifests    every known app manifest
//   installedIds ids actually installed; null/undefined means all of them
// Unknown installed ids are ignored (an app removed from the build), and the
// result is ordered by manifest.order, then by position in `manifests`.
// Sidebar entries across all installed apps. An entry's own `order` wins over its app's, so one
// app (Work) can have entries interleaved with another's; ties keep app and declaration order.
// The `order` field itself is dropped: consumers only see { id, label, icon }.
function orderedEntries(apps) {
  return apps
    .flatMap(a => a.nav.map(n => ({ n, key: n.order ?? a.order ?? 0 })))
    .map((e, i) => ({ ...e, i }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map(({ n }) => ({ id: n.id, label: n.label, icon: n.icon }))
}

export function createRegistry({ manifests, installedIds = null }) {
  const seen = new Set()
  for (const m of manifests) {
    const errors = validateManifest(m)
    if (errors.length) throw new Error(`Invalid manifest${m && m.id ? ` "${m.id}"` : ''}: ${errors.join('; ')}`)
    if (seen.has(m.id)) throw new Error(`Duplicate app id "${m.id}"`)
    seen.add(m.id)
  }

  const wanted = installedIds ? new Set(installedIds) : null
  const apps = manifests
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => !wanted || wanted.has(m.id))
    .sort((a, b) => (a.m.order ?? 0) - (b.m.order ?? 0) || a.i - b.i)
    .map(({ m }) => m)

  const byId = new Map(apps.map(a => [a.id, a]))
  const byView = new Map()
  for (const a of apps) for (const n of a.nav) byView.set(n.id, a)

  const mode = apps.length === 1 ? 'standalone' : 'combined'
  return {
    apps,
    mode,
    nav: orderedEntries(apps),
    isInstalled: id => byId.has(id),
    appForView: viewId => byView.get(viewId),
    // What the window, taskbar and tray call the thing that is running.
    identity: mode === 'standalone'
      ? { productName: apps[0].productName, appId: apps[0].id }
      : { productName: COMBINED_PRODUCT_NAME, appId: 'combined' },
  }
}
