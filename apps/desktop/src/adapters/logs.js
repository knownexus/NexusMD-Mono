// The app's log files, read in the main process. Each call resolves undefined when the
// bridge is absent, so the viewer simply shows nothing outside Electron.
const logs = () => (typeof window !== 'undefined' ? window.electronAPI?.logs : undefined)

export const logsAdapter = {
  // The flat daily files written before per-module logs
  list() { return logs()?.list?.() },
  read(date) { return logs()?.read?.(date) },
  delete(date) { return logs()?.delete?.(date) },

  // The per-module logs
  available() { return typeof logs()?.query === 'function' },
  modules() { return logs()?.modules?.() },
  query(q) { return logs()?.query?.(q) },
  follow(cid) { return logs()?.follow?.(cid) },
  /** Starts the live tail; onBatch gets each batch of new entries. Returns a function that stops it. */
  async tail(onBatch) {
    const l = logs()
    if (!l?.tailStart || !l?.onEntries) return () => {}
    const off = l.onEntries(onBatch)
    try { await l.tailStart() } catch (err) { off(); throw err }
    return () => { off(); l.tailStop?.()?.catch?.(() => {}) }
  },
}
