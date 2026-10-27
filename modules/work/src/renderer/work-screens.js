import React from 'react'
import { getProfileKey } from '@nexusmd/shell-sdk'
import manifest from '../../app.manifest.json'

// Which of Work's screens are switched off, per profile. A switched-off screen leaves the sidebar
// and can't be opened (the shell reads this through useOffViews in index.js), its Dashboard widgets
// go, and for the screens with data of their own (Pull Requests, Builds, Tests) nothing is fetched.
// Team and Triage only hide: the team list and the work items are what the rest of Work runs on.

export const WORK_SCREENS = manifest.nav.map(({ id, label }) => ({ id, label }))

// The screens that load something of their own, and the loader's `skip` flag for each.
export const FETCHED_BY = { prs: 'prs', builds: 'builds', tests: 'tests' }

const KEY = () => getProfileKey('work.screens.off')
const EVENT = 'nexusmd:work-screens'
const known = new Set(WORK_SCREENS.map(s => s.id))

let cache = null
function read(storage) {
  try {
    const ids = JSON.parse(storage.getItem(KEY()) || '[]')
    return Array.isArray(ids) ? ids.filter(id => known.has(id)) : []
  } catch { return [] }
}

export function getOffScreens(storage = localStorage) {
  return cache ?? (cache = read(storage))
}

// Saves the switched-off screens. One screen always stays on, or Work would have nothing to show.
// Returns false (and saves nothing) when every screen would be off.
export function setOffScreens(ids, storage = localStorage) {
  const next = [...new Set(ids)].filter(id => known.has(id))
  if (next.length >= WORK_SCREENS.length) return false
  try { storage.setItem(KEY(), JSON.stringify(next)) } catch { /* kept for this session */ }
  cache = next
  window.dispatchEvent(new Event(EVENT))
  return true
}

// The loader's `skip` for the switched-off screens that have data of their own.
export function skippedFetches(off = getOffScreens()) {
  return Object.fromEntries(Object.entries(FETCHED_BY).map(([view, flag]) => [flag, off.includes(view)]))
}

function subscribe(fn) {
  // Another window (a pop-out) or an import changing the stored value: read it again.
  const onStorage = () => { cache = null; fn() }
  window.addEventListener(EVENT, fn)
  window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener(EVENT, fn); window.removeEventListener('storage', onStorage) }
}

export function useOffScreens() {
  return React.useSyncExternalStore(subscribe, () => getOffScreens())
}

// Only for tests: forget what was read.
export function resetOffScreensCache() { cache = null }
