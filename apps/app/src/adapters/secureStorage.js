// NOTE: This is a localStorage fallback. Replace with capacitor-secure-storage-plugin
// when that package is added to the project.
export const secureStorageAdapter = {
  async get(key) {
    try { return localStorage.getItem(key) } catch { return null }
  },
  async set(key, value) {
    try { localStorage.setItem(key, value) } catch { /* ignore */ }
  },
  async remove(key) {
    try { localStorage.removeItem(key) } catch { /* ignore */ }
  },
}
