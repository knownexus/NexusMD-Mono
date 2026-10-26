// packages/core/src/modules/db-manager/table-prefs.test.js
import { describe, it, expect } from 'vitest'
import {
  normalizeTablePrefs, toggleTableStarred, toggleTableHidden, setTableGroup, renameTableGroup,
  removeTableGroup, toggleSectionCollapsed, tableSections, groupSectionKey, schemaSectionKey,
} from './table-prefs.js'

const empty = () => normalizeTablePrefs(null)

describe('normalizeTablePrefs', () => {
  it('fills in an empty object from nothing', () => {
    expect(normalizeTablePrefs(undefined)).toEqual({ starred: [], hidden: [], groups: [], assigned: {}, collapsed: [] })
    expect(normalizeTablePrefs('junk')).toEqual(empty())
  })

  it('keeps valid entries and drops malformed ones', () => {
    const p = normalizeTablePrefs({ starred: ['a', 3], hidden: 'x', assigned: { a: 'Core', b: '', c: 7 }, groups: ['Core'] })
    expect(p).toEqual({ starred: ['a'], hidden: [], groups: ['Core'], assigned: { a: 'Core' }, collapsed: [] })
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
