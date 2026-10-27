import React from 'react'

// The counts of new items shown on the sidebar, per sidebar entry. The sidebar lives in the shell,
// outside Work's provider, so it reads them from here (see useNavBadges in index.js) while the
// provider keeps them up to date.
export function createBadgeStore() {
  let badges = {}
  const listeners = new Set()
  return {
    get: () => badges,
    set(next) {
      const keys = new Set([...Object.keys(badges), ...Object.keys(next)])
      if ([...keys].every(k => (badges[k] || 0) === (next[k] || 0))) return
      badges = { ...next }
      listeners.forEach(l => l())
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  }
}

export const workBadges = createBadgeStore()

export function useWorkNavBadges(store = workBadges) {
  return React.useSyncExternalStore(store.subscribe, store.get)
}
