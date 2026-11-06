// The recordings, which live in the main process (see electron/ipc/recordings.cjs). Each call resolves to undefined when the
// bridge is absent, so the screens that use it simply show nothing outside Electron.
const recording = () => (typeof window !== 'undefined' ? window.electronAPI?.recording : undefined)

export const recordingsAdapter = {
  available() { return typeof recording()?.status === 'function' },
  status() { return recording()?.status?.() },
  start(label) { return recording()?.start?.(label) },
  stop() { return recording()?.stop?.() },
  list() { return recording()?.list?.() },
  read(id) { return recording()?.read?.(id) },
  remove(id) { return recording()?.remove?.(id) },
  /** Asks where to save it: resolves { saved }. */
  exportTo(id) { return recording()?.exportTo?.(id) },
  /** Asks which file: resolves the recording it holds, or null when the person cancels. */
  importFile() { return recording()?.importFile?.() },
  /** cb(status) when a recording starts or stops; returns a function that stops listening. */
  onState(cb) { return recording()?.onState?.(cb) ?? (() => {}) },
}
