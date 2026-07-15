// Field/column visibility catalogs + pure resolver. One config per surface:
// an ordered array of { key, visible }. Catalogs are the source of truth for
// which fields exist, their labels, default order, table widths, and lock state.

export const WI_CARD_FIELDS = [
  { key: 'type',     label: 'Type icon',   locked: true },
  { key: 'id',       label: 'ID',          locked: true },
  { key: 'title',    label: 'Title',       locked: true },
  { key: 'priority', label: 'Priority' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'tags',     label: 'Tags' },
  { key: 'points',   label: 'Story points' },
  { key: 'comments', label: 'Comment count' },
  { key: 'prs',      label: 'PR count' },
  { key: 'updated',  label: 'Updated' },
]

export const WI_TABLE_COLUMNS = [
  { key: 'id',       label: 'ID',       width: '70px' },
  { key: 'type',     label: 'Type',     width: '52px' },
  { key: 'title',    label: 'Title',    width: '1fr', locked: true },
  { key: 'project',  label: 'Project',  width: '120px' },
  { key: 'state',    label: 'State',    width: '120px' },
  { key: 'assignee', label: 'Assignee', width: '150px' },
  { key: 'priority', label: 'Priority', width: '52px' },
  { key: 'tags',     label: 'Tags',     width: '160px' },
  { key: 'updated',  label: 'Updated',  width: '96px' },
]

export const PR_CARD_FIELDS = [
  { key: 'status',           label: 'Status icon',      locked: true },
  { key: 'title',            label: 'Title',            locked: true },
  { key: 'id',               label: 'ID',               locked: true },
  { key: 'author',           label: 'Author' },
  { key: 'branch',           label: 'Branch' },
  { key: 'age',              label: 'Age' },
  { key: 'linkedWorkItems',  label: 'Linked work items' },
  { key: 'changes',          label: 'Additions / deletions' },
  { key: 'comments',         label: 'Comments' },
  { key: 'ci',               label: 'CI status' },
  { key: 'reviewers',        label: 'Reviewers' },
]

export const BUILDS_TABLE_COLUMNS = [
  { key: 'status',      label: 'Status',       width: '28px',  locked: true },
  { key: 'build',       label: 'Build #',      width: '68px',  locked: true },
  { key: 'project',     label: 'Project',      width: '120px' },
  { key: 'triggeredBy', label: 'Triggered by', width: '1fr' },
  { key: 'branch',      label: 'Branch',       width: '160px' },
  { key: 'commit',      label: 'Commit',       width: '72px' },
  { key: 'reason',      label: 'Reason',       width: '80px' },
  { key: 'duration',    label: 'Duration',     width: '72px' },
  { key: 'date',        label: 'Date',         width: '148px' },
  { key: 'actions',     label: 'Actions',      width: '140px', locked: true },
]

export const TESTS_TABLE_COLUMNS = [
  { key: 'result',   label: 'Result',   width: 'auto', locked: true },
  { key: 'run',      label: 'Run',      width: '1fr',  locked: true },
  { key: 'project',  label: 'Project',  width: '120px' },
  { key: 'duration', label: 'Duration', width: '80px' },
  { key: 'date',     label: 'Date',     width: '116px' },
  { key: 'actions',  label: 'Actions',  width: 'auto', locked: true },
]

const lockedKeys = (catalog) => new Set(catalog.filter(f => f.locked).map(f => f.key))

export function defaultConfig(catalog) {
  return catalog.map(f => ({ key: f.key, visible: true }))
}

export function resolveFields(catalog, config) {
  const byKey = new Map(catalog.map(f => [f.key, f]))
  const locked = lockedKeys(catalog)
  const cfg = Array.isArray(config) ? config : []
  const seen = new Set()
  const out = []
  for (const entry of cfg) {
    const meta = byKey.get(entry.key)
    if (!meta || seen.has(entry.key)) continue           // drop unknown / duplicate
    seen.add(entry.key)
    out.push({ ...meta, visible: locked.has(entry.key) ? true : !!entry.visible })
  }
  for (const meta of catalog) {                          // append newly-added catalog fields
    if (seen.has(meta.key)) continue
    out.push({ ...meta, visible: true })
  }
  return out
}

export function reorderField(config, catalog, fromKey, toKey) {
  const base = config.length ? config.slice() : defaultConfig(catalog)
  const from = base.findIndex(e => e.key === fromKey)
  const to = base.findIndex(e => e.key === toKey)
  if (from === -1 || to === -1 || from === to) return base
  const [moved] = base.splice(from, 1)
  base.splice(to, 0, moved)
  return base
}

export function toggleField(config, catalog, key) {
  if (lockedKeys(catalog).has(key)) return config.length ? config : defaultConfig(catalog)
  const base = config.length ? config.slice() : defaultConfig(catalog)
  return base.map(e => e.key === key ? { ...e, visible: !e.visible } : e)
}
