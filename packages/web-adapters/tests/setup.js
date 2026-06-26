// jsdom under Node 26 doesn't expose a working `localStorage` global, so install a
// faithful in-memory shim: data keys are enumerable own properties (so the adapter's
// Object.keys(localStorage) works), the Storage methods are non-enumerable.
function makeLocalStorage() {
  const ls = {}
  Object.defineProperties(ls, {
    getItem:    { value(k) { return Object.prototype.hasOwnProperty.call(this, k) ? this[k] : null }, enumerable: false },
    setItem:    { value(k, v) { this[k] = String(v) }, enumerable: false },
    removeItem: { value(k) { delete this[k] }, enumerable: false },
    clear:      { value() { for (const k of Object.keys(this)) delete this[k] }, enumerable: false },
  })
  return ls
}

const ls = makeLocalStorage()
globalThis.localStorage = ls
if (globalThis.window) globalThis.window.localStorage = ls
