// Pure 3-way merge strategies for the sync engine. Equality is structural via
// contentHash. Rows + text keep-both on conflict; key-value is newest-wins via a
// caller-supplied `prefer`; sets are unions.
import { contentHash } from './hash.js'
import { PLANNER_SECTIONS } from '../planner/index.js'

const eq = (a, b) => contentHash(a) === contentHash(b)
const asArray = (v) => (Array.isArray(v) ? v : [])
const byId = (arr, idKey) => { const m = new Map(); for (const r of asArray(arr)) m.set(r[idKey], r); return m }

export function mergeRows(base, local, remote, idKey = 'id') {
  const b = byId(base, idKey), l = byId(local, idKey), r = byId(remote, idKey)
  const ids = new Set([...l.keys(), ...r.keys(), ...b.keys()])
  const merged = []
  const conflicts = []
  for (const id of ids) {
    const bv = b.get(id), lv = l.get(id), rv = r.get(id)
    const lChanged = !eq(lv ?? null, bv ?? null)
    const rChanged = !eq(rv ?? null, bv ?? null)
    if (lv && rv) {
      if (eq(lv, rv)) merged.push(lv)
      else if (!lChanged) merged.push(rv)            // only remote edited
      else if (!rChanged) merged.push(lv)            // only local edited
      else {                                         // both edited → keep both
        merged.push(lv)
        merged.push({ ...rv, [idKey]: id + '__conflict', _conflict: { from: 'remote' } })
        conflicts.push({ kind: 'row', id, from: 'remote' })
      }
    } else if (lv && !rv) {
      if (bv && lChanged) { merged.push(lv); conflicts.push({ kind: 'row', id, from: 'remote-delete' }) }
      else if (bv && !lChanged) { /* remote deletion wins → drop */ }
      else merged.push(lv)                            // local add
    } else if (!lv && rv) {
      if (bv && rChanged) { merged.push(rv); conflicts.push({ kind: 'row', id, from: 'local-delete' }) }
      else if (bv && !rChanged) { /* local deletion wins → drop */ }
      else merged.push(rv)                            // remote add
    }
    // both absent → dropped
  }
  return { merged, conflicts }
}

export function mergeKeyVal(base, local, remote, { prefer = 'local' } = {}) {
  const b = base || {}, l = local || {}, r = remote || {}
  const keys = new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])
  const merged = {}
  const conflicts = []
  for (const key of keys) {
    const bv = b[key], lv = l[key], rv = r[key]
    const lChanged = !eq(lv, bv)
    const rChanged = !eq(rv, bv)
    let winner
    if (!lChanged && !rChanged) winner = lv
    else if (lChanged && !rChanged) winner = lv
    else if (!lChanged && rChanged) winner = rv
    else { // both changed
      winner = prefer === 'remote' ? rv : lv
      conflicts.push({ kind: 'keyval', key, winner: prefer })
    }
    if (winner !== undefined) merged[key] = winner
  }
  return { merged, conflicts }
}

export function mergeText(base, local, remote, { from = 'remote' } = {}) {
  const b = base ?? '', l = local ?? '', r = remote ?? ''
  const lChanged = l !== b
  const rChanged = r !== b
  if (lChanged && rChanged && l !== r) {
    return { merged: `${l}\n\n--- conflict from ${from} ---\n\n${r}`, conflicts: [{ kind: 'text', from }] }
  }
  return { merged: lChanged ? l : r, conflicts: [] }
}

export function mergeSet(base, local, remote) {
  const out = []
  const seen = new Set()
  for (const arr of [asArray(local), asArray(remote), asArray(base)]) {
    for (const v of arr) if (!seen.has(v)) { seen.add(v); out.push(v) }
  }
  return { merged: out, conflicts: [] }
}

export function mergePlannerWeek(base, local, remote, { from = 'remote', prefer = 'local' } = {}) {
  const b = base || {}, l = local || {}, r = remote || {}
  const bd = b.data || {}, ld = l.data || {}, rd = r.data || {}
  const data = {}
  const conflicts = []
  for (const sec of PLANNER_SECTIONS) {
    const id = sec.id
    let res
    if (sec.type === 'table') res = mergeRows(bd[id], ld[id], rd[id])
    else if (sec.type === 'textarea') res = mergeText(bd[id], ld[id], rd[id], { from })
    else res = mergeKeyVal(bd[id], ld[id], rd[id], { prefer }) // keyval + eow
    data[id] = res.merged
    for (const c of res.conflicts) conflicts.push({ ...c, sectionId: id })
  }
  const themesRes = mergeKeyVal(b.themes, l.themes, r.themes, { prefer })
  for (const c of themesRes.conflicts) conflicts.push({ ...c, sectionId: 'themes' })
  return { merged: { data, themes: themesRes.merged }, conflicts }
}
