import React from 'react'
import { registry } from './registry.js'
import { appModules } from './app-code.js'
import { host } from './host.js'

// The installed apps in the apps' own order (the manifests' `order`), which is also the order of
// their providers, panels and settings cards.
export function loadModules(reg = registry, all = appModules) {
  const position = id => reg.apps.findIndex(a => a.id === id)
  return all.filter(m => reg.isInstalled(m.id)).sort((a, b) => position(a.id) - position(b.id))
}

export const modules = loadModules()

// Lets each installed app register what it offers the others (capabilities) before anything renders.
for (const m of modules) m.activate?.(host)

// Adapters the installed apps add to the core adapter set (must be merged before initCore).
export function moduleAdapters(mods = modules) {
  return Object.assign({}, ...mods.map(m => m.adapters || {}))
}

// The component an installed app renders for a view id, or undefined if no app module owns it.
export function moduleView(viewId, mods = modules) {
  return mods.find(m => m.views?.[viewId])?.views[viewId]
}

// Settings panels that installed apps put into a named tab (e.g. 'planner'). A panel is a component
// or { Panel, order }; lower orders come first, apps in their own order otherwise.
export function modulePanels(tabId, mods = modules) {
  return mods
    .filter(m => m.settingsPanels?.[tabId])
    .map((m, i) => {
      const p = m.settingsPanels[tabId]
      return typeof p === 'function' ? { id: m.id, Panel: p, order: 0, i } : { id: m.id, Panel: p.Panel, order: p.order ?? 0, i }
    })
    .sort((a, b) => a.order - b.order || a.i - b.i)
    .map(({ id, Panel }) => ({ id, Panel }))
}

// The counts of new items each installed app wants on the sidebar: { sidebar entry id: count }.
// The apps and their hooks are fixed for the session, so calling them in a loop is safe.
export function useModuleBadges(mods = modules) {
  const out = {}
  for (const m of mods) {
    const badges = m.useNavBadges?.()
    if (badges) Object.assign(out, badges)
  }
  return out
}

// What installed apps add to the top bar and under it. They render inside the apps' providers.
export function ModuleTopbar({ mods = modules }) {
  return mods.filter(m => m.topbar).map(m => React.createElement(m.topbar, { key: m.id }))
}
export function ModuleBanners({ mods = modules }) {
  return mods.filter(m => m.banner).map(m => React.createElement(m.banner, { key: m.id }))
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

// Wraps children in every installed app's provider (outermost = first app). An app uses one when
// something it owns must outlive its screen, e.g. a running script.
export function ModuleProviders({ adapters, notify, view, children, mods = modules }) {
  return mods
    .filter(m => m.provider)
    .reduceRight((inner, m) => React.createElement(m.provider, { adapters, notify, view, host }, inner), children)
}
