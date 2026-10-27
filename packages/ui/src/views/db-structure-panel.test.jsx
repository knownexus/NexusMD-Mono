// packages/ui/src/views/db-structure-panel.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { StructurePanel } from './db-structure-panel.jsx'

afterEach(() => { cleanup() })

const structure = {
  columns: [
    { name: 'BookingID', dataType: 'int', isPrimaryKey: true, nullable: false },
    { name: 'Site', dataType: 'nvarchar', maxLength: 20, isPrimaryKey: true, nullable: false },
    { name: 'Note', dataType: 'nvarchar', maxLength: -1, nullable: true },
  ],
  foreignKeys: [
    { name: 'FK_Visit_Booking', columns: ['BookingID', 'Site'], refTable: 'maintenance.Booking', refColumns: ['ID', 'Site'], onDelete: 'CASCADE', onUpdate: 'NO ACTION' },
  ],
  referencedBy: [
    { name: 'FK_Task_Visit', table: 'maintenance.Task', columns: ['VisitID'], refColumns: ['BookingID'], onDelete: 'NO ACTION', onUpdate: 'NO ACTION' },
  ],
  indexes: [
    { name: 'IX_Visit_A', columns: [{ name: 'A', desc: true }, { name: 'B', desc: false }], unique: true, primaryKey: false, filter: '([A] IS NOT NULL)' },
    { name: 'IX_Expr', columns: [{ name: null, desc: false }], unique: false, primaryKey: false, filter: null },
  ],
}

const section = name => within(screen.getByRole('region', { name }))

describe('StructurePanel', () => {
  it('shows a composite foreign key as one row with its action', () => {
    render(<StructurePanel structure={structure} onOpenTable={vi.fn()} />)
    const row = section('Foreign keys').getByText(/BookingID, Site →/).closest('[data-key]')
    expect(row.textContent).toContain('BookingID, Site → maintenance.Booking (ID, Site)')
    expect(row.textContent).toContain('ON DELETE CASCADE')
    expect(row.textContent).not.toContain('NO ACTION')
  })

  it('opens the target table from a link in the key row and in the column', () => {
    const onOpenTable = vi.fn()
    render(<StructurePanel structure={structure} onOpenTable={onOpenTable} />)
    fireEvent.click(section('Foreign keys').getByRole('button', { name: 'Open maintenance.Booking' }))
    expect(onOpenTable).toHaveBeenCalledWith('maintenance.Booking')
    fireEvent.click(section('Columns').getAllByRole('button', { name: 'Open maintenance.Booking' })[0])
    expect(onOpenTable).toHaveBeenCalledTimes(2)
  })

  it('lists the keys that point here', () => {
    const onOpenTable = vi.fn()
    render(<StructurePanel structure={structure} onOpenTable={onOpenTable} />)
    expect(section('Referenced by').getByText(/\(VisitID\)/)).toBeTruthy()
    fireEvent.click(section('Referenced by').getByRole('button', { name: 'Open maintenance.Task' }))
    expect(onOpenTable).toHaveBeenCalledWith('maintenance.Task')
  })

  it('shows index direction, uniqueness and filter, and names an expression column', () => {
    render(<StructurePanel structure={structure} onOpenTable={vi.fn()} />)
    const row = section('Indexes').getByText('IX_Visit_A').closest('[data-key]')
    expect(row.textContent).toContain('A desc, B')
    expect(row.textContent).toContain('unique')
    expect(row.textContent).toContain('([A] IS NOT NULL)')
    expect(section('Indexes').getByText(/\(expression\)/)).toBeTruthy()
  })

  it('says None for an empty section', () => {
    render(<StructurePanel structure={{ ...structure, foreignKeys: [], referencedBy: [], indexes: [] }} onOpenTable={vi.fn()} />)
    expect(section('Foreign keys').getByText('None')).toBeTruthy()
    expect(section('Referenced by').getByText('None')).toBeTruthy()
    expect(section('Indexes').getByText('None')).toBeTruthy()
  })

  it('renders a target without a column list when it has no primary key', () => {
    const s = { ...structure, foreignKeys: [{ ...structure.foreignKeys[0], refColumns: [] }] }
    render(<StructurePanel structure={s} onOpenTable={vi.fn()} />)
    expect(section('Foreign keys').getByText(/BookingID, Site →/).closest('[data-key]').textContent).toContain('BookingID, Site → maintenance.Booking')
    expect(section('Foreign keys').getByText(/BookingID, Site →/).closest('[data-key]').textContent).not.toContain('()')
  })

  it('shows only the columns and a note for a view', () => {
    render(<StructurePanel structure={structure} isView onOpenTable={vi.fn()} />)
    expect(screen.getByText('Views have no keys or indexes of their own.')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Foreign keys' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Indexes' })).toBeNull()
    expect(section('Columns').getByText('BookingID')).toBeTruthy()
  })

  it('highlights and scrolls to the focused key', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    render(<StructurePanel structure={structure} onOpenTable={vi.fn()} focusKey="FK_Task_Visit" />)
    expect(section('Referenced by').getByText(/\(VisitID\)/).closest('[data-key]').getAttribute('data-focus')).toBe('true')
    expect(scrollIntoView).toHaveBeenCalled()
    delete Element.prototype.scrollIntoView
  })

  it('shows a spinner while loading and an error with a retry', () => {
    const onRefresh = vi.fn()
    const { rerender } = render(<StructurePanel structure={null} loading onOpenTable={vi.fn()} />)
    expect(screen.getByText(/Reading structure/)).toBeTruthy()
    rerender(<StructurePanel structure={null} error="boom" onRefresh={onRefresh} onOpenTable={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toContain('boom')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRefresh).toHaveBeenCalled()
  })
})
