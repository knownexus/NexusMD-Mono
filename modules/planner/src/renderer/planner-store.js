import React from 'react'

// The Planner's in-memory working state: the data of the week being shown and the section themes.
// It lives outside the component so it survives leaving the Planner screen, and so other apps can
// reach it through the capabilities the Planner offers (see index.js) instead of sharing React state.
export function createPlannerStore() {
  let data = {}
  let themes = {}
  const listeners = new Set()
  const emit = () => listeners.forEach(fn => fn())
  // Setters accept a value or an updater, like React's setState.
  const resolve = (next, prev) => (typeof next === 'function' ? next(prev) : next)

  return {
    getData: () => data,
    getThemes: () => themes,
    setData(next) { const v = resolve(next, data); if (v !== data) { data = v; emit() } },
    setThemes(next) { const v = resolve(next, themes); if (v !== themes) { themes = v; emit() } },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  }
}

export const plannerStore = createPlannerStore()

// [data, setData, themes, setThemes], re-rendering when the store changes.
export function usePlannerStore(store = plannerStore) {
  const data = React.useSyncExternalStore(store.subscribe, store.getData)
  const themes = React.useSyncExternalStore(store.subscribe, store.getThemes)
  return [data, store.setData, themes, store.setThemes]
}
