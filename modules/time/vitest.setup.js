// Node 22+ defines its own (experimental) localStorage/sessionStorage on the
// global; without --localstorage-file they read as undefined. Vitest copies a
// jsdom window key onto the global only when the global lacks it, so jsdom's
// Storage never lands. Point the globals back at jsdom's.
const win = globalThis.jsdom?.window
if (win) {
  for (const key of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(globalThis, key, { get: () => win[key], configurable: true })
  }
}
