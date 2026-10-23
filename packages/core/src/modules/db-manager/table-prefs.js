// packages/core/src/modules/db-manager/table-prefs.js
//
// How one connection's table list is arranged: favourite (starred) tables, hidden tables, the
// user's own groups, and which sections are folded. Pure — callers load and save the object.
//
// Shape: { starred: string[], hidden: string[], groups: string[] (display order),
//          assigned: { [table]: groupName }, collapsed: string[] (section keys) }

const EMPTY = { starred: [], hidden: [], groups: [], assigned: {}, collapsed: [] }

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
  return { ...EMPTY, starred: strings(p.starred), hidden: strings(p.hidden), groups, assigned, collapsed: strings(p.collapsed) }
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

/**
 * The table list's sections, in display order: the user's groups, then each schema's
 * ungrouped tables ("dbo.Users" goes under dbo; names without a schema under "Tables").
 * Only sections that have one of `tables` in them are returned.
 * @returns {{ key: string, kind: 'group'|'schema', name: string, label: string, names: string[] }[]}
 */
export function tableSections(tables, prefs) {
  const byGroup = new Map(prefs.groups.map(g => [g, []]))
  const bySchema = new Map()
  for (const t of tables) {
    const g = prefs.assigned[t]
    if (g && byGroup.has(g)) { byGroup.get(g).push(t); continue }
    const dot = t.indexOf('.')
    const schema = dot > 0 ? t.slice(0, dot) : ''
    if (!bySchema.has(schema)) bySchema.set(schema, [])
    bySchema.get(schema).push(t)
  }
  return [
    ...[...byGroup].filter(([, names]) => names.length)
      .map(([name, names]) => ({ key: groupSectionKey(name), kind: 'group', name, label: name, names })),
    ...[...bySchema].map(([schema, names]) => ({ key: schemaSectionKey(schema), kind: 'schema', name: schema, label: schema || 'Tables', names })),
  ]
}
