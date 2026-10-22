// The app's log files, read in the main process. Each call resolves undefined when the
// bridge is absent, so the viewer simply shows nothing outside Electron.
const logs = () => (typeof window !== 'undefined' ? window.electronAPI?.logs : undefined)

export const logsAdapter = {
  list() { return logs()?.list?.() },
  read(date) { return logs()?.read?.(date) },
  delete(date) { return logs()?.delete?.(date) },
}
