// packages/core/src/modules/db-manager/table-prefs.js
//
// How one connection's table list is arranged: favourite (starred) tables, hidden tables, the
// user's own groups, and which sections are folded. Pure — callers load and save the object.
//
// Shape: { starred: string[], hidden: string[], groups: string[] (display order),
//          assigned: { [table]: groupName }, collapsed: string[] (section keys),
//          groupBy: one of TABLE_GROUP_BY's ids (how tables outside your groups are sectioned) }

/** The ways the table list can be sectioned, in menu order. */
export const TABLE_GROUP_BY = [
  { id: 'schema', label: 'Schema' },
  { id: 'name', label: 'Name (A–Z)' },
  { id: 'changed', label: 'Last changed' },
  { id: 'prefix', label: 'Name prefix' },
  { id: 'type', label: 'Tables and views' },
]
const groupByIds = new Set(TABLE_GROUP_BY.map(g => g.id))
const groupByOf = v => (groupByIds.has(v) ? v : 'schema')

const EMPTY = { starred: [], hidden: [], groups: [], assigned: {}, collapsed: [], groupBy: 'schema' }

const strings = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : [])

/** A complete prefs object from whatever was stored (missing, partial or malformed). */
export function normalizeTablePrefs(raw) {
  const p = raw && typeof raw === 'object' ? raw : {}
  const assigned = {}
  if (p.assigned && typeof p.assigned === 'object') {
    for (const [table, group] of Object.entries(p.assigned)) if (typeof group === 'string' && group) assigned[table] = group
  }
  // Every assigned group is listed, in its saved order first.
  const groups = [...new Set([...strings(p.groups), ...Object.values(assigned)])]
  return { ...EMPTY, starred: strings(p.starred), hidden: strings(p.hidden), groups, assigned, collapsed: strings(p.collapsed), groupBy: groupByOf(p.groupBy) }
}

export function setTableGroupBy(prefs, groupBy) {
  return { ...prefs, groupBy: groupByOf(groupBy) }
}

const toggle = (list, item) => (list.includes(item) ? list.filter(x => x !== item) : [...list, item])

export function toggleTableStarred(prefs, table) {
  return { ...prefs, starred: toggle(prefs.starred, table) }
}

export function toggleTableHidden(prefs, table) {
  return { ...prefs, hidden: toggle(prefs.hidden, table) }
}

// A group with no tables left is dropped.
function pruneGroups(prefs) {
  const used = new Set(Object.values(prefs.assigned))
  const gone = prefs.groups.filter(g => !used.has(g))
  if (!gone.length) return prefs
  return {
    ...prefs,
    groups: prefs.groups.filter(g => used.has(g)),
    collapsed: prefs.collapsed.filter(k => !gone.some(g => k === groupSectionKey(g))),
  }
}

/** Moves a table into `group` (created at the end if new), or out of any group when `group` is empty. */
export function setTableGroup(prefs, table, group) {
  const name = (group ?? '').trim()
  const assigned = { ...prefs.assigned }
  if (name) assigned[table] = name
  else delete assigned[table]
  const groups = name && !prefs.groups.includes(name) ? [...prefs.groups, name] : prefs.groups
  return pruneGroups({ ...prefs, assigned, groups })
}

/** Renames a group; renaming onto an existing group merges the two. */
export function renameTableGroup(prefs, from, to) {
  const name = (to ?? '').trim()
  if (!name || name === from || !prefs.groups.includes(from)) return prefs
  const assigned = Object.fromEntries(Object.entries(prefs.assigned).map(([t, g]) => [t, g === from ? name : g]))
  const groups = prefs.groups.includes(name) ? prefs.groups.filter(g => g !== from) : prefs.groups.map(g => (g === from ? name : g))
  const collapsed = prefs.collapsed.map(k => (k === groupSectionKey(from) ? groupSectionKey(name) : k))
  return { ...prefs, assigned, groups, collapsed: [...new Set(collapsed)] }
}

/** Removes a group; its tables go back under their schema. */
export function removeTableGroup(prefs, group) {
  const assigned = Object.fromEntries(Object.entries(prefs.assigned).filter(([, g]) => g !== group))
  return pruneGroups({ ...prefs, assigned })
}

export function toggleSectionCollapsed(prefs, key) {
  return { ...prefs, collapsed: toggle(prefs.collapsed, key) }
}

// Section keys keep a group called "dbo" apart from the dbo schema.
export const groupSectionKey = name => `group:${name}`
export const schemaSectionKey = schema => `schema:${schema}`
export const VIEWS_SECTION_KEY = 'views:'

// A table's name without its schema ("dbo.Users" → "Users").
const bareName = t => { const dot = t.indexOf('.'); return dot > 0 ? t.slice(dot + 1) : t }
// Plain code-point order on lower case, so the order is the same on every machine.
const byBareName = (a, b) => { const x = bareName(a).toLowerCase(), y = bareName(b).toLowerCase(); return x < y ? -1 : x > y ? 1 : 0 }

/**
 * The first word of a table's name, without its schema: up to a _, - or space, or where
 * camelCase starts a new word ("tbl_Patient" → "tbl", "PatientVisit" → "Patient", "HTTPLog" → "HTTP").
 */
export function tablePrefix(table) {
  const chunk = bareName(table).replace(/^[_\-\s]+/, '').split(/[_\-\s]/)[0]
  return chunk.match(/^(?:[A-Z]+(?=[A-Z][a-z])|[A-Z]+(?![a-z])|[A-Z]?[a-z0-9]+)/)?.[0] || chunk
}

const DAY = 24 * 60 * 60 * 1000
// When-changed buckets, newest first; a table goes in the first whose start it's at or after.
const CHANGED_BUCKETS = [
  { id: 'today', label: 'Today', since: now => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime() } },
  { id: 'week', label: 'Last 7 days', since: now => now - 7 * DAY },
  { id: 'month', label: 'Last 30 days', since: now => now - 30 * DAY },
  { id: 'older', label: 'Older', since: () => -Infinity },
]

// The sections for tables outside the user's groups, for a grouping other than schema.
// Each is { id, label, names }; empty ones are left out.
function otherSections(groupBy, names, { isView, changed, now }) {
  const sorted = [...names].sort(byBareName)
  if (groupBy === 'type') {
    return [
      { id: 'tables', label: 'Tables', names: sorted.filter(t => !isView.has(t)) },
      { id: 'views', label: 'Views', names: sorted.filter(t => isView.has(t)) },
    ]
  }
  if (groupBy === 'name') {
    const byLetter = new Map()
    for (const t of sorted) {
      const first = bareName(t).charAt(0).toUpperCase()
      const letter = /[A-Z]/.test(first) ? first : '#'
      if (!byLetter.has(letter)) byLetter.set(letter, [])
      byLetter.get(letter).push(t)
    }
    return [...byLetter].sort(([a], [b]) => (a === '#') - (b === '#') || (a < b ? -1 : 1))
      .map(([letter, list]) => ({ id: letter, label: letter, names: list }))
  }
  if (groupBy === 'changed') {
    const when = t => { const ms = Date.parse(changed[t]?.at); return Number.isNaN(ms) ? null : ms }
    const known = sorted.filter(t => when(t) != null).sort((a, b) => when(b) - when(a))
    const buckets = CHANGED_BUCKETS.map(b => ({ id: b.id, label: b.label, since: b.since(now), names: [] }))
    for (const t of known) buckets.find(b => when(t) >= b.since).names.push(t)
    return [...buckets, { id: 'unknown', label: 'Not known', names: sorted.filter(t => when(t) == null) }]
  }
  if (groupBy === 'prefix') {
    const byPrefix = new Map() // lower-cased prefix → { names, spellings: Map<spelling, count> }
    for (const t of sorted) {
      const word = tablePrefix(t)
      const key = word.toLowerCase()
      if (!byPrefix.has(key)) byPrefix.set(key, { names: [], spellings: new Map() })
      const entry = byPrefix.get(key)
      entry.names.push(t)
      entry.spellings.set(word, (entry.spellings.get(word) ?? 0) + 1)
    }
    // A prefix shared by one table groups nothing, so it goes under Other.
    const shared = [...byPrefix].filter(([, e]) => e.names.length > 1).sort(([a], [b]) => (a < b ? -1 : 1))
    const other = sorted.filter(t => byPrefix.get(tablePrefix(t).toLowerCase()).names.length === 1)
    // Labelled with the commonest spelling; on a tie, the capitalised one.
    const label = e => [...e.spellings].sort(([a, n], [b, m]) => m - n || (a < b ? -1 : 1))[0][0]
    return [...shared.map(([key, e]) => ({ id: key, label: label(e), names: e.names })), { id: '', label: 'Other', names: other }]
  }
  return []
}

/**
 * The table list's sections, in display order: the user's groups first, then the rest grouped
 * by prefs.groupBy. By schema (the default): each schema's ungrouped tables ("dbo.Users" goes
 * under dbo; names without a schema under "Tables"), then any views not in a group. The other
 * groupings sort tables by name without the schema, except Last changed, newest first.
 * Only sections that have one of `tables` in them are returned.
 * @param {{ views?: Iterable<string>, changed?: { [table]: { at: string } }, now?: number }} [opts]
 *   Which of `tables` are views; when each last changed (for Last changed); the time it is now.
 * @returns {{ key: string, kind: 'group'|'schema'|'views'|'name'|'changed'|'prefix'|'type', name: string, label: string, names: string[] }[]}
 */
export function tableSections(tables, prefs, { views = [], changed = {}, now = Date.now() } = {}) {
  const byGroup = new Map(prefs.groups.map(g => [g, []]))
  const rest = []
  for (const t of tables) {
    const g = prefs.assigned[t]
    if (g && byGroup.has(g)) byGroup.get(g).push(t)
    else rest.push(t)
  }
  const groups = [...byGroup].filter(([, names]) => names.length)
    .map(([name, names]) => ({ key: groupSectionKey(name), kind: 'group', name, label: name, names }))
  const isView = new Set(views)
  const groupBy = groupByOf(prefs.groupBy)
  if (groupBy !== 'schema') {
    return [...groups, ...otherSections(groupBy, rest, { isView, changed, now })
      .filter(s => s.names.length)
      .map(s => ({ key: `${groupBy}:${s.id}`, kind: groupBy, name: s.id, label: s.label, names: s.names }))]
  }
  const bySchema = new Map()
  const viewNames = []
  for (const t of rest) {
    if (isView.has(t)) { viewNames.push(t); continue }
    const dot = t.indexOf('.')
    const schema = dot > 0 ? t.slice(0, dot) : ''
    if (!bySchema.has(schema)) bySchema.set(schema, [])
    bySchema.get(schema).push(t)
  }
  return [
    ...groups,
    ...[...bySchema].map(([schema, names]) => ({ key: schemaSectionKey(schema), kind: 'schema', name: schema, label: schema || 'Tables', names })),
    ...(viewNames.length ? [{ key: VIEWS_SECTION_KEY, kind: 'views', name: '', label: 'Views', names: viewNames }] : []),
  ]
}
