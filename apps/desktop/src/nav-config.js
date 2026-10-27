// Pure sidebar nav configuration, extracted from main.jsx (which renders and
// starts sync at import, so it can't be imported by tests). Settings is kept OUT
// of the reorderable NAV and pinned separately at the sidebar bottom.
//
// The entries now come from the app manifests (shell/bundled-apps.json). NAV is every
// app's entries, which fixes the default order; INSTALLED_NAV is only the apps installed
// on this machine, and is what the sidebar and Settings actually show.
import { buildRegistry, registry } from './shell/registry.js'

export const NAV = buildRegistry().nav
export const INSTALLED_NAV = registry.nav

export const SETTINGS_NAV = { id: 'settings', label: 'Settings', icon: 'settings' }

export const ALL_NAV = [...NAV, SETTINGS_NAV]

export const DEFAULT_NAV_ORDER = NAV.map(n => n.id)
