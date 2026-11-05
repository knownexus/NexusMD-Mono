// damaged-copy.js — read a stored JSON value without losing it when it is damaged.
//
// A planner week or the notes list that is not valid JSON (a torn write, a bad manual edit) opens empty, and the
// next save replaces it. Before that can happen the damaged text is copied aside, to the same place the cloud
// sync keeps its copies (`<ns>.p.<pid>.sync.quarantine.<collection>.<item>.<time>`): inside the profile, so
// deleting the profile deletes it, and on the sync skip list, so it never leaves the device. The value itself is
// left where it is (removing it would look like a deletion to the sync engine).
import { ignore, quarantineStored } from '@nexusmd/core'

/**
 * The parsed value at `storageKey`, or `empty` when there is none or it cannot be read. When the stored text is not
 * valid JSON a copy is kept first, and the log says whether that worked (never the text itself).
 * @param {{ storage: Storage, getProfileKey: (k: string) => string, namespace: string, log: object,
 *   storageKey: string, collection: string, itemKey: string, empty: any, what: string, data?: object }} o
 */
export function readJsonKeepingDamaged({ storage, getProfileKey, namespace, log, storageKey, collection, itemKey, empty, what, data }) {
  let raw
  try { raw = storage.getItem(storageKey) } catch (err) { ignore(log, what, err, 'warn', data); return empty }
  if (!raw) return empty
  try { return JSON.parse(raw) } catch (err) {
    let kept = false
    try { kept = !!quarantineStored(storage, getProfileKey, namespace, collection, itemKey, storageKey) } catch (copyErr) { ignore(log, 'a copy of the damaged text could not be stored', copyErr, 'warn', data) }
    ignore(log, `${what}; ${kept ? 'the damaged text is kept aside' : 'no copy of the damaged text could be kept'}`, err, 'warn', { ...data, kept })
    return empty
  }
}
