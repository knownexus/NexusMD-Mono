// packages/ui/src/views/db-grid-menus.test.js
import { describe, it, expect, vi } from 'vitest'
import { headerMenuItems, rowMenuItems } from './db-grid-menus.js'

const labels = items => items.map(it => (it.separator ? '—' : it.label))
const find = (items, label) => items.find(it => it.label === label)

const header = (over = {}) => headerMenuItems({
  column: 'StaffID',
  sorted: null,
  anyMinimised: false,
  foreignKey: null,
  onSort: vi.fn(), onMinimise: vi.fn(), onRestoreAll: vi.fn(), onCopyName: vi.fn(), onCopyValues: vi.fn(), onFilterEmpty: vi.fn(), onGoToKey: vi.fn(),
  ...over,
})

const row = (over = {}) => rowMenuItems({
  canEdit: true, editReason: null, columnReadonly: false, columnBoolean: false, nullable: true,
  isView: false, count: 1, canDelete: true, deleteReason: 'No primary key, so this row can’t be deleted on its own', canDuplicate: true,
  follows: [], references: [],
  onEdit: vi.fn(), onSetNull: vi.fn(), onCopyCell: vi.fn(), onCopyRows: vi.fn(), onCopyInsert: vi.fn(), onDuplicate: vi.fn(), onFollow: vi.fn(), onDelete: vi.fn(),
  ...over,
})

describe('headerMenuItems', () => {
  it('lists a sorted foreign key column’s items in order', () => {
    const fk = { name: 'FK_staff', columns: ['StaffID'], refTable: 'staff', refColumns: ['id'] }
    expect(labels(header({ sorted: 'asc', anyMinimised: true, foreignKey: fk }))).toEqual([
      'Sort ascending', 'Sort descending', 'Clear sort', '—',
      'Minimise column', 'Show all minimised columns', '—',
      'Copy column name', 'Copy values', '—',
      'Show only empty (NULL)', 'Show only not empty', 'Go to foreign key target…',
    ])
  })

  it('leaves out Clear sort when the column isn’t sorted, and the key item on a plain column', () => {
    const items = header()
    expect(find(items, 'Clear sort')).toBeUndefined()
    expect(find(items, 'Show all minimised columns')).toBeUndefined()
    expect(find(items, 'Go to foreign key target…')).toBeUndefined()
  })

  it('wires each item to its action', () => {
    const fk = { name: 'FK_staff', columns: ['StaffID'], refTable: 'staff', refColumns: ['id'] }
    const ctx = { sorted: 'desc', foreignKey: fk, onSort: vi.fn(), onFilterEmpty: vi.fn(), onGoToKey: vi.fn() }
    const items = header(ctx)
    find(items, 'Sort descending').onSelect()
    find(items, 'Clear sort').onSelect()
    find(items, 'Show only not empty').onSelect()
    find(items, 'Go to foreign key target…').onSelect()
    expect(ctx.onSort.mock.calls).toEqual([['desc'], [null]])
    expect(ctx.onFilterEmpty).toHaveBeenCalledWith(false)
    expect(ctx.onGoToKey).toHaveBeenCalledWith(fk)
  })
})

describe('rowMenuItems', () => {
  it('lists a row’s items in order', () => {
    const follows = [{ key: 'FK_staff', table: 'staff', where: [], label: 'StaffID → staff' }]
    const references = [{ key: 'FK_appt', table: 'appointments', where: [], label: 'appointments by patient_id' }]
    const items = row({ follows, references })
    expect(labels(items)).toEqual([
      'Edit cell', 'Set to NULL', '—',
      'Copy cell', 'Copy row', 'Copy as INSERT', 'Duplicate row…', '—',
      'Follow StaffID → staff', 'Show rows that reference this', '—',
      'Delete row',
    ])
    expect(labels(find(items, 'Show rows that reference this').submenu)).toEqual(['appointments by patient_id'])
    expect(find(items, 'Delete row').danger).toBe(true)
  })

  it('disables Edit cell and Set to NULL with the reason when editing is off', () => {
    const reason = 'This table has no primary key'
    // Before the column details load, nullability isn't known either: still listed, disabled.
    const items = row({ canEdit: false, editReason: reason, canDelete: false, nullable: null })
    expect(find(items, 'Edit cell')).toMatchObject({ disabled: true, title: reason })
    expect(find(items, 'Set to NULL')).toMatchObject({ disabled: true, title: reason })
    expect(find(items, 'Delete row')).toMatchObject({ disabled: true, title: 'No primary key, so this row can’t be deleted on its own' })
  })

  it('offers Set to NULL only on a nullable column the database doesn’t write', () => {
    expect(find(row({ nullable: false }), 'Set to NULL')).toBeUndefined()
    expect(find(row({ nullable: null }), 'Set to NULL')).toBeDefined()
    expect(find(row({ columnReadonly: true }), 'Set to NULL')).toBeUndefined()
  })

  it('names the ticked rows when several are', () => {
    const l = labels(row({ count: 3 }))
    expect(l).toContain('Copy 3 rows')
    expect(l).toContain('Copy 3 rows as INSERT')
    expect(l).toContain('Delete 3 rows')
    expect(l).not.toContain('Copy row')
    expect(l).toContain('Copy cell')
  })

  it('has no reverse submenu or follow group when nothing points either way', () => {
    const items = row()
    expect(find(items, 'Show rows that reference this')).toBeUndefined()
    expect(labels(items)).toEqual([
      'Edit cell', 'Set to NULL', '—', 'Copy cell', 'Copy row', 'Copy as INSERT', 'Duplicate row…', '—', 'Delete row',
    ])
  })

  it('leaves editing, duplicating, following and deleting out of a view', () => {
    const follows = [{ key: 'FK_staff', table: 'staff', where: [], label: 'StaffID → staff' }]
    expect(labels(row({ isView: true, follows }))).toEqual(['Copy cell', 'Copy row', 'Copy as INSERT'])
  })

  it('follows the target it was built from', () => {
    const target = { key: 'FK_staff', table: 'staff', where: [{ column: 'id', value: 4 }], label: 'StaffID → staff' }
    const ref = { key: 'FK_appt', table: 'appointments', where: [], label: 'appointments by patient_id' }
    const ctx = { follows: [target], references: [ref], onFollow: vi.fn() }
    const items = row(ctx)
    find(items, 'Follow StaffID → staff').onSelect()
    find(items, 'Show rows that reference this').submenu[0].onSelect()
    expect(ctx.onFollow.mock.calls).toEqual([[target], [ref]])
  })
})
