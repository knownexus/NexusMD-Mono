import { registry } from './registry.js'

// Renderer code of every installable app. While all apps are still bundled together, Vite pulls
// each modules/<id>/src/renderer/index.js in here; only the ones the registry says are installed
// are used. (Later phases load them from the install folder instead.)
const found = import.meta.glob('../../../../modules/*/src/renderer/index.js', { eager: true, import: 'default' })

export function loadModules(reg = registry, all = Object.values(found)) {
  return all.filter(m => reg.isInstalled(m.id))
}

export const modules = loadModules()

// Adapters the installed apps add to the core adapter set (must be merged before initCore).
export function moduleAdapters(mods = modules) {
  return Object.assign({}, ...mods.map(m => m.adapters || {}))
}

// The component an installed app renders for a view id, or undefined if no app module owns it.
export function moduleView(viewId, mods = modules) {
  return mods.find(m => m.views?.[viewId])?.views[viewId]
}

export function moduleSettingsCards(mods = modules) {
  return mods.filter(m => m.settingsCard).map(m => ({ id: m.id, Card: m.settingsCard }))
}

// If this page is an app's pop-out window, the app's component and the request it was opened with.
export function findPopout(hash, mods = modules) {
  for (const m of mods) {
    const spec = m.popout?.parse(hash)
    if (spec) return { Component: m.popout.Component, adapter: m.popout.adapter, spec }
  }
  return null
}
