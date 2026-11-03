// packages/ui/src/views/db-query-docs.js
//
// The Query tab's query tabs. Each table has its own (the New query page has its own too, under
// FREE), so switching tables keeps every query as it was: its SQL, the table its builders use, its
// result and whether it is still running.
//
// State: { [owner]: { docs: Doc[], active: id, next: n } }, owner being a table name or FREE.
// Doc:   { id, name, sql, table, result, running }
// Every function returns a new state and leaves the one given alone.

export const FREE = ''

let seq = 0
export const newDocId = () => `qd-${Date.now().toString(36)}-${(++seq).toString(36)}`

export function docsOf(state, owner) {
  return state[owner]?.docs ?? []
}

export function activeDoc(state, owner) {
  const s = state[owner]
  if (!s) return null
  return s.docs.find(d => d.id === s.active) ?? s.docs[0] ?? null
}

// A new tab, named "Query n", made the one showing.
export function addDoc(state, owner, { id = newDocId(), sql = '', table = null } = {}) {
  const s = state[owner] ?? { docs: [], active: null, next: 1 }
  const doc = { id, name: `Query ${s.next}`, sql, table, result: null, running: false }
  return { ...state, [owner]: { docs: [...s.docs, doc], active: id, next: s.next + 1 } }
}

// A first tab for `owner` when it has none.
export function ensureDoc(state, owner, opts) {
  return activeDoc(state, owner) ? state : addDoc(state, owner, opts)
}

// `patch` is an object, or a function of the doc giving one.
export function updateDoc(state, owner, id, patch) {
  const s = state[owner]
  if (!s || !s.docs.some(d => d.id === id)) return state
  const docs = s.docs.map(d => (d.id === id ? { ...d, ...(typeof patch === 'function' ? patch(d) : patch) } : d))
  return { ...state, [owner]: { ...s, docs } }
}

export function selectDoc(state, owner, id) {
  const s = state[owner]
  return s && s.docs.some(d => d.id === id) ? { ...state, [owner]: { ...s, active: id } } : state
}

// Closing the tab showing shows its neighbour; closing the last leaves a fresh, empty Query 1.
export function closeDoc(state, owner, id) {
  const s = state[owner]
  const i = s ? s.docs.findIndex(d => d.id === id) : -1
  if (i < 0) return state
  const docs = s.docs.filter(d => d.id !== id)
  if (!docs.length) return addDoc({ ...state, [owner]: undefined }, owner)
  const active = s.active === id ? docs[Math.min(i, docs.length - 1)].id : s.active
  return { ...state, [owner]: { ...s, docs, active } }
}

export function renameDoc(state, owner, id, name) {
  const n = String(name ?? '').trim()
  return n ? updateDoc(state, owner, id, { name: n }) : state
}

// Puts `sql` in a tab of `owner` with the id `id`: the tab showing when `reusable(doc)` says it can
// be written over (and it isn't running), else a new tab. The id is chosen by the caller, so it can
// run the query straight away without waiting for the state to settle.
export function placeDoc(state, owner, { id, sql, table = null }, reusable) {
  const cur = activeDoc(state, owner)
  if (!cur || cur.running || !reusable(cur)) return addDoc(state, owner, { id, sql, table })
  const s = state[owner]
  const same = cur.sql.trim() === sql.trim()
  const doc = { ...cur, id, sql, table: table ?? cur.table, result: same ? cur.result : null }
  return { ...state, [owner]: { ...s, docs: s.docs.map(d => (d.id === cur.id ? doc : d)), active: id } }
}
