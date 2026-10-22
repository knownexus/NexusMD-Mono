// The custom title-bar buttons (Win/Linux) and shell events from the main process.
const api = () => (typeof window !== 'undefined' ? window.electronAPI : undefined)

export const windowControlsAdapter = {
  platform() { return api()?.platform },
  minimize() { api()?.window?.minimize() },
  maximize() { api()?.window?.maximize() },
  close() { api()?.window?.close() },
  // F5 (menu accelerator) asks the renderer to refresh instead of reloading the window.
  onRefreshData(cb) { api()?.onRefreshData?.(cb) },
}
