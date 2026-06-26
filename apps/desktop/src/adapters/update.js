// IUpdateAdapter — backed by electron-updater via the preload `update` IPC bridge.
// Falls back to a safe no-op when the bridge is absent (e.g. running the renderer
// outside Electron, like the Playwright web harness).
const api = (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.update) || null

export const updateAdapter = {
  async checkForUpdate() {
    return api ? api.check() : { available: false }
  },
  async installUpdate() {
    if (api) await api.install()
  },
  onUpdateAvailable(cb) {
    return api ? api.onAvailable(cb) : () => {}
  },
}
