// damaged-copy.js — read a stored JSON value without losing it when it is damaged (planner weeks and notes, the time log, the offline queue).
//
// A planner week or the notes list that is not valid JSON (a torn write, a bad manual edit) opens empty, and the
// next save replaces it. Before that can happen the damaged text is copied aside, to the same place the cloud
// sync keeps its copies (`<ns>.p.<pid>.sync.quarantine.<collection>.<item>.<time>`): inside the profile, so
// deleting the profile deletes it, and on the sync skip list, so it never leaves the device. The value itself is
// left where it is (removing it would look like a deletion to the sync engine).
import { ignore } from '../../log.js'
import { quarantine } from './collections.js'

/**
 * The parsed value at `storageKey`, or `empty` when there is none or it cannot be read. When the stored text is not
 * valid JSON a copy is kept first, and the log says whether that worked (never the text itself).
 * @param {{ storage: Storage, getProfileKey: (k: string) => string, namespace: string, log: object,
 *   storageKey: string, collection: string, itemKey: string, empty: any, what: string, data?: object,
 *   reported?: Set<string> }} o   `reported`: texts already reported by this reader; one in it is not copied or logged again (only texts that were kept are added)
 */
export function readJsonKeepingDamaged({ storage, getProfileKey, namespace, log, storageKey, collection, itemKey, empty, what, data, reported }) {
  let raw
  try { raw = storage.getItem(storageKey) } catch (err) { ignore(log, what, err, 'warn', data); return empty }
  if (!raw) return empty
  try { return JSON.parse(raw) } catch (err) {
    if (reported?.has(raw)) return empty
    let kept = false
    try { kept = !!quarantine(storage, getProfileKey, namespace, collection, itemKey, storageKey) } catch (copyErr) { ignore(log, 'a copy of the damaged text could not be stored', copyErr, 'warn', data) }
    if (kept) reported?.add(raw) // a copy that failed is tried again on the next read, before a save can replace the text
    ignore(log, `${what}; ${kept ? 'the damaged text is kept aside' : 'no copy of the damaged text could be kept'}`, err, 'warn', { ...data, kept })
    return empty
  }
}
