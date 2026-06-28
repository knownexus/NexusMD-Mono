// runtime.js — module-level planner config for the handful of NON-component helpers
// (loadGlobalNotes/saveGlobalNotes) that persist namespaced keys but can't read the
// React context. NexusDataProvider syncs these fields from its value, so there is a
// single source of truth. Safe as a module singleton: exactly one namespace exists
// per running process (web 'nexusmd', app 'helm').

let runtime = {
  namespace: 'nexusmd',
  getProfileKey: (k) => k,
  pushPref: () => {},
  // Web-only hook: fired after a week is persisted so the Google-Drive planner
  // sync can push it. App leaves this a no-op. Wired via the data-context.
  onWeekSaved: () => {},
  storage: (() => {
    try { if (typeof localStorage !== 'undefined' && localStorage) return localStorage } catch { /* sandboxed */ }
    const m = new Map()
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, removeItem: (k) => { m.delete(k) } }
  })(),
}

export function setPlannerRuntime(cfg = {}) {
  runtime = { ...runtime, ...cfg }
}

export function getPlannerRuntime() {
  return runtime
}
