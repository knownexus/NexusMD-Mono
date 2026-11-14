// apps-disabled.js — which apps are switched off right now, so turning one off or on in Settings shows at once
// instead of waiting for a restart. The saved list (prefs.disabledApps, kept by the main process) is what the next
// start uses; this is what the running window follows. An app that was running at start is only hidden or shown again
// (its code is loaded, so showing it is just not hiding it); one that was off at start was never loaded, so turning it
// on still takes a restart (see AppsCard). Kept in session storage so a reload of the window keeps it, and seeded from
// the saved list when the shell starts (refreshFromPrefs).
import React from 'react'
import { rendererLog, ignore } from '@nexusmd/core'
import { registry } from './registry.js'

const log = rendererLog('core', 'apps')
const KEY = 'nexusmd.apps.disabled'

let current // undefined until read; then an array, or null when nothing is known
const listeners = new Set()

function read() {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) || 'null')
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : null
  } catch (err) { ignore(log, 'session storage is unavailable, so the switched-off apps are not remembered across a reload', err, 'debug'); return null }
}

/** The ids switched off now (every installed app that is off, running or not), or null when nothing says. */
export function getDisabledApps() {
  if (current === undefined) current = read()
  return current
}

export function setDisabledApps(ids) {
  current = Array.isArray(ids) ? [...new Set(ids.filter(x => typeof x === 'string'))] : null
  try { if (current) sessionStorage.setItem(KEY, JSON.stringify(current)); else sessionStorage.removeItem(KEY) } catch (err) { ignore(log, 'session storage is unavailable', err, 'debug') }
  listeners.forEach(fn => fn())
}

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
/** The switched-off ids, for a component that must follow them. */
export const useDisabledApps = () => React.useSyncExternalStore(subscribe, getDisabledApps)

/** True for an app that is running here and has been switched off since (so its entries, screens and settings are left out). */
export function isAppHidden(id, reg = registry) {
  const off = getDisabledApps()
  return !!off && off.includes(id) && reg.isInstalled(id)
}

/** The sidebar entry ids of the running apps that have been switched off. */
export function hiddenViewIds(reg = registry, off = getDisabledApps()) {
  if (!off) return []
  return reg.apps.filter(a => off.includes(a.id)).flatMap(a => a.nav.map(n => n.id))
}

/** Takes the saved list from the main process (it may have changed there, for instance by a settings import). */
export async function refreshFromPrefs(prefs) {
  try {
    const ids = await prefs?.getDisabledApps?.()
    if (Array.isArray(ids)) setDisabledApps(ids)
  } catch (err) { ignore(log, 'the saved list of switched-off apps could not be read', err, 'warn') }
}

/** For tests: forget what was read or set. */
export function resetDisabledApps() {
  current = undefined
  try { sessionStorage.removeItem(KEY) } catch (err) { ignore(log, 'session storage is unavailable', err, 'debug') }
  listeners.forEach(fn => fn())
}
