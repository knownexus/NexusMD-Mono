// Desktop-only preferences owned by the main process: start at login, close to tray,
// the download folder picker and the whole-app zoom. Calls resolve undefined when the
// bridge lacks a method (older preload, partial test stubs).
const api = () => (typeof window !== 'undefined' ? window.electronAPI : undefined)

export const appPrefsAdapter = {
  isAvailable() { return !!api() },
  getLoginItemEnabled() { return api()?.getLoginItemEnabled?.() },
  setLoginItemEnabled(enabled) { return api()?.setLoginItemEnabled?.(enabled) },
  getCloseToTray() { return api()?.getCloseToTray?.() },
  setCloseToTray(enabled) { return api()?.setCloseToTray?.(enabled) },
  pickOutputFolder() { return api()?.pickOutputFolder?.() },
  getZoomFactor() { return api()?.getZoomFactor?.() },
  setZoomFactor(factor) { return api()?.setZoomFactor?.(factor) },
  onZoomChanged(cb) { return api()?.onZoomChanged?.(cb) },
  // Installed apps switched off in Settings; a change applies when the app restarts.
  getDisabledApps() { return api()?.registry?.getDisabled?.() },
  setDisabledApps(ids) { return api()?.registry?.setDisabled?.(ids) },
  restartApp(disabledIds) { return api()?.registry?.setDisabled?.(disabledIds, { restart: true }) },
}
