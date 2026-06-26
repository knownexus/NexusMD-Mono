export const localStorageAdapter = {
  get(key) {
    try { const v = localStorage.getItem(key); return v === null ? null : JSON.parse(v) } catch { return null }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch (_) {}
  },
  remove(key) {
    try { localStorage.removeItem(key) } catch (_) {}
  },
  keys() {
    try { return Object.keys(localStorage) } catch { return [] }
  },
}
