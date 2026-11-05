import { rendererLog, ignore } from '@nexusmd/core'

const log = rendererLog('core', 'storage')

export const localStorageAdapter = {
  get(key) {
    try { const v = localStorage.getItem(key); return v === null ? null : JSON.parse(v) } catch (_) { return null }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch (err) { ignore(log, 'browser storage could not be written (full or blocked)', err, 'warn') }
  },
  remove(key) {
    try { localStorage.removeItem(key) } catch (err) { ignore(log, 'browser storage could not be cleared', err, 'warn') }
  },
  keys() {
    try { return Object.keys(localStorage) } catch (_) { return [] }
  },
}
