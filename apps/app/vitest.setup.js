// jsdom under Node 26 doesn't expose a working `localStorage` global, so install a
// faithful in-memory shim (data keys enumerable, Storage methods not).
function makeLocalStorage() {
  const ls = {}
  Object.defineProperties(ls, {
    getItem:    { value(k) { return Object.prototype.hasOwnProperty.call(this, k) ? this[k] : null }, enumerable: false },
    setItem:    { value(k, v) { this[k] = String(v) }, enumerable: false },
    removeItem: { value(k) { delete this[k] }, enumerable: false },
    clear:      { value() { for (const k of Object.keys(this)) delete this[k] }, enumerable: false },
    key:        { value(i) { return Object.keys(this)[i] ?? null }, enumerable: false },
    length:     { get() { return Object.keys(this).length }, enumerable: false },
  })
  return ls
}

const ls = makeLocalStorage()
globalThis.localStorage = ls
if (globalThis.window) globalThis.window.localStorage = ls
