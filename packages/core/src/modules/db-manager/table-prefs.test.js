// packages/core/src/modules/db-manager/table-prefs.test.js
import { describe, it, expect } from 'vitest'
import {
  normalizeTablePrefs, toggleTableStarred, toggleTableHidden, setTableGroup, renameTableGroup,
  removeTableGroup, toggleSectionCollapsed, tableSections, groupSectionKey, schemaSectionKey,
  setTableGroupBy, TABLE_GROUP_BY, tablePrefix,
} from './table-prefs.js'

const empty = () => normalizeTablePrefs(null)

describe('normalizeTablePrefs', () => {
  it('fills in an empty object from nothing', () => {
    expect(normalizeTablePrefs(undefined)).toEqual({ starred: [], hidden: [], groups: [], assigned: {}, collapsed: [], groupBy: 'schema' })
    expect(normalizeTablePrefs('junk')).toEqual(empty())
  })

  it('keeps valid entries and drops malformed ones', () => {
    const p = normalizeTablePrefs({ starred: ['a', 3], hidden: 'x', assigned: { a: 'Core', b: '', c: 7 }, groups: ['Core'] })
    expect(p).toEqual({ starred: ['a'], hidden: [], groups: ['Core'], assigned: { a: 'Core' }, collapsed: [], groupBy: 'schema' })
  })

  it('lists any assigned group missing from the order', () => {
    expect(normalizeTablePrefs({ assigned: { a: 'Billing' }, groups: [] }).groups).toEqual(['Billing'])
  })
})

describe('starring and hiding', () => {
  it('toggles a table on and off', () => {
    const p = toggleTableStarred(empty(), 'users')
    expect(p.starred).toEqual(['users'])
    expect(toggleTableStarred(p, 'users').starred).toEqual([])
    expect(toggleTableHidden(empty(), 'logs').hidden).toEqual(['logs'])
  })
})

describe('groups', () => {
  it('creates a group when a table is first moved into it', () => {
    const p = setTableGroup(empty(), 'orders', '  Billing ')
    expect(p.groups).toEqual(['Billing'])
    expect(p.assigned).toEqual({ orders: 'Billing' })
  })

  it('drops a group once its last table moves out', () => {
    let p = setTableGroup(empty(), 'orders', 'Billing')
    p = toggleSectionCollapsed(p, groupSectionKey('Billing'))
    p = setTableGroup(p, 'orders', '')
    expect(p.groups).toEqual([])
    expect(p.assigned).toEqual({})
    expect(p.collapsed).toEqual([])
  })

  it('renames a group, keeping its tables and folded state', () => {
    let p = setTableGroup(empty(), 'orders', 'Billing')
    p = toggleSectionCollapsed(p, groupSectionKey('Billing'))
    p = renameTableGroup(p, 'Billing', 'Money')
    expect(p.groups).toEqual(['Money'])
    expect(p.assigned).toEqual({ orders: 'Money' })
    expect(p.collapsed).toEqual([groupSectionKey('Money')])
  })

  it('merges into an existing group when renamed onto it', () => {
    let p = setTableGroup(empty(), 'orders', 'A')
    p = setTableGroup(p, 'refunds', 'B')
    p = renameTableGroup(p, 'B', 'A')
    expect(p.groups).toEqual(['A'])
    expect(p.assigned).toEqual({ orders: 'A', refunds: 'A' })
  })

  it('ignores a blank rename', () => {
    const p = setTableGroup(empty(), 'orders', 'A')
    expect(renameTableGroup(p, 'A', '  ')).toBe(p)
  })

  it('removing a group returns its tables to their schema', () => {
    let p = setTableGroup(empty(), 'dbo.orders', 'Billing')
    p = removeTableGroup(p, 'Billing')
    expect(p.groups).toEqual([])
    expect(tableSections(['dbo.orders'], p).map(s => s.label)).toEqual(['dbo'])
  })
})

describe('tableSections', () => {
  it('lists the user groups first, then schemas, skipping empty sections', () => {
    let p = setTableGroup(empty(), 'dbo.Invoices', 'Billing')
    p = setTableGroup(p, 'sales.Refunds', 'Billing')
    p = setTableGroup(p, 'dbo.Audit', 'Admin')
    const sections = tableSections(['dbo.Users', 'dbo.Invoices', 'sales.Refunds', 'sales.Leads', 'version'], p)
    expect(sections.map(s => [s.key, s.names])).toEqual([
      [groupSectionKey('Billing'), ['dbo.Invoices', 'sales.Refunds']],
      [schemaSectionKey('dbo'), ['dbo.Users']],
      [schemaSectionKey('sales'), ['sales.Leads']],
      [schemaSectionKey(''), ['version']],
    ])
    expect(sections.at(-1).label).toBe('Tables')
  })

  it('puts views in a Views section last, unless they’re in a group', () => {
    let p = setTableGroup(empty(), 'ActiveMembers', 'People')
    const sections = tableSections(['Member', 'ActiveMembers', 'Lapsed'], p, { views: ['ActiveMembers', 'Lapsed'] })
    expect(sections.map(s => [s.key, s.names])).toEqual([
      [groupSectionKey('People'), ['ActiveMembers']],
      [schemaSectionKey(''), ['Member']],
      ['views:', ['Lapsed']],
    ])
    expect(sections.at(-1)).toMatchObject({ kind: 'views', label: 'Views' })
  })

  it('keeps a group called like a schema apart from that schema', () => {
    const p = setTableGroup(empty(), 'dbo.Invoices', 'dbo')
    const keys = tableSections(['dbo.Invoices', 'dbo.Users'], p).map(s => s.key)
    expect(keys).toEqual(['group:dbo', 'schema:dbo'])
  })
})

describe('grouping the list another way', () => {
  const labelled = sections => sections.map(s => [s.label, s.names])

  it('keeps a known grouping and falls back to schema for anything else', () => {
    expect(TABLE_GROUP_BY.map(g => g.id)).toEqual(['schema', 'name', 'changed', 'prefix', 'type'])
    expect(normalizeTablePrefs({ groupBy: 'prefix' }).groupBy).toBe('prefix')
    expect(normalizeTablePrefs({ groupBy: 'size' }).groupBy).toBe('schema')
    expect(setTableGroupBy(empty(), 'name').groupBy).toBe('name')
    expect(setTableGroupBy(empty(), 'nope').groupBy).toBe('schema')
  })

  it('by name: a section per first letter, ignoring the schema, the rest under #', () => {
    const p = setTableGroupBy(empty(), 'name')
    const sections = tableSections(['dbo.users', 'audit.Accounts', 'apples', '_tmp', 'Ugly', '2024_log'], p)
    expect(labelled(sections)).toEqual([
      ['A', ['audit.Accounts', 'apples']],
      ['U', ['Ugly', 'dbo.users']],
      ['#', ['2024_log', '_tmp']],
    ])
    expect(sections[0]).toMatchObject({ key: 'name:A', kind: 'name' })
  })

  it('by last changed: newest first in day buckets, unknown last', () => {
    const now = new Date(2026, 9, 29, 15, 0).getTime()
    const at = (d, h = 12) => ({ at: new Date(2026, 9, d, h).toISOString(), kind: 'data' })
    const changed = { a: at(29, 9), b: at(28), c: at(20), d: { at: new Date(2026, 6, 1).toISOString(), kind: 'structure' }, e: at(29, 14), f: { at: 'junk' } }
    const p = setTableGroupBy(empty(), 'changed')
    expect(labelled(tableSections(['a', 'b', 'c', 'd', 'e', 'f', 'g'], p, { changed, now }))).toEqual([
      ['Today', ['e', 'a']],
      ['Last 7 days', ['b']],
      ['Last 30 days', ['c']],
      ['Older', ['d']],
      ['Not known', ['f', 'g']],
    ])
  })

  it('by prefix: the first word of the name; a prefix with one table goes under Other', () => {
    expect(['tbl_Patient', 'PatientVisit', 'patient-notes', 'dbo.Orders', 'HTTPLog', 'x'].map(tablePrefix))
      .toEqual(['tbl', 'Patient', 'patient', 'Orders', 'HTTP', 'x'])
    const p = setTableGroupBy(empty(), 'prefix')
    expect(labelled(tableSections(['PatientVisit', 'patient_notes', 'Patients', 'OrderLine', 'Order', 'Staff'], p))).toEqual([
      ['Order', ['Order', 'OrderLine']],
      ['Patient', ['patient_notes', 'PatientVisit']],
      ['Other', ['Patients', 'Staff']],
    ])
  })

  it('by type: tables, then views', () => {
    const p = setTableGroupBy(empty(), 'type')
    expect(labelled(tableSections(['b', 'v1', 'a'], p, { views: ['v1'] }))).toEqual([['Tables', ['a', 'b']], ['Views', ['v1']]])
  })

  it('your own groups stay first in every grouping', () => {
    const p = setTableGroupBy(setTableGroup(empty(), 'zeta', 'Mine'), 'name')
    expect(labelled(tableSections(['alpha', 'zeta'], p))).toEqual([['Mine', ['zeta']], ['A', ['alpha']]])
  })
})
