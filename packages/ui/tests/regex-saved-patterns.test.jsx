import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, within } from '@testing-library/react'
import React from 'react'
import { SavedPatterns } from '../src/views/regex-tester/saved-patterns.jsx'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const doc = (id, pattern, extra = {}) => ({
  id, name: null, autoName: `/${pattern}/g`, content: { pattern, flags: { g: true, i: false, m: false, s: false, u: false } },
  createdAt: Date.now(), updatedAt: Date.now(), ...extra,
})
const DOCS = [doc('1', '\\d+'), doc('2', 'invoice-\\d+', { name: 'Invoices' }), doc('3', '[a-z]+@mail', { name: 'Mail' })]
const show = (over = {}) => {
  const p = { docs: DOCS, currentDocId: '1', onOpen: vi.fn(), onNew: vi.fn(), onRename: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn(), ...over }
  const r = render(<SavedPatterns {...p} />)
  return { ...p, ...r }
}
const rows = r => within(r.getByRole('list', { name: 'Saved patterns' })).queryAllByRole('listitem')

describe('SavedPatterns', () => {
  it('has the eyebrow, the count and a + button for a new pattern', () => {
    const p = show()
    expect(p.getByText('Saved patterns', { selector: '.nx-rt-eyebrow' })).toBeTruthy()
    expect(p.getByText('3', { selector: '.nx-rt-count' })).toBeTruthy()
    fireEvent.click(p.getByRole('button', { name: 'New pattern' }))
    expect(p.onNew).toHaveBeenCalledTimes(1)
  })

  it('lists each pattern with its name, when it changed and the pattern itself, the open one marked', () => {
    const p = show()
    expect(rows(p)).toHaveLength(3)
    const invoices = rows(p)[1]
    expect(within(invoices).getByText('Invoices')).toBeTruthy()
    expect(within(invoices).getByText('just now')).toBeTruthy()
    expect(within(invoices).getByText('/invoice-\\d+/g').className).toContain('nx-rt-pattern')
    expect(within(rows(p)[0]).getByRole('button').getAttribute('aria-current')).toBe('true')
    expect(within(invoices).getByRole('button').getAttribute('aria-current')).toBeNull()
  })

  it('names an unnamed pattern by the pattern, until it is renamed', () => {
    const p = show()
    expect(within(rows(p)[0]).getAllByText('/\\d+/g').length).toBeGreaterThan(0)
  })

  it('opens a pattern on click', () => {
    const p = show()
    fireEvent.click(within(rows(p)[2]).getByRole('button'))
    expect(p.onOpen).toHaveBeenCalledWith('3')
  })

  it('filters by the start of words in the name and in the pattern', () => {
    const p = show()
    const box = p.getByRole('searchbox', { name: 'Filter patterns' })
    fireEvent.change(box, { target: { value: 'inv' } })
    expect(rows(p).map(r => within(r).getByRole('button').title)).toEqual(['Invoices'])
    fireEvent.change(box, { target: { value: 'mail' } })
    expect(rows(p)).toHaveLength(1)
    fireEvent.change(box, { target: { value: 'nvoice' } })
    expect(rows(p)).toHaveLength(0)
    expect(p.getByText('No pattern matches.')).toBeTruthy()
  })

  it('says when there are none yet', () => {
    const p = show({ docs: [], currentDocId: null })
    expect(p.getByText('No saved patterns yet.')).toBeTruthy()
  })

  describe('right-click menu', () => {
    const open = (p, i = 1) => fireEvent.contextMenu(within(rows(p)[i]).getByRole('button'))

    it('offers Rename…, Duplicate and Delete…', () => {
      const p = show()
      open(p)
      expect(p.getAllByRole('menuitem').map(m => m.textContent)).toEqual(['Rename…', 'Duplicate', 'Delete…'])
    })

    it('Duplicate asks for a copy of that pattern', () => {
      const p = show()
      open(p)
      fireEvent.click(p.getByRole('menuitem', { name: 'Duplicate' }))
      expect(p.onDuplicate).toHaveBeenCalledWith('2')
      expect(p.queryByRole('menu')).toBeNull()
    })

    it('Rename… asks for a name, and a cancelled prompt renames nothing', () => {
      const prompt = vi.spyOn(window, 'prompt').mockReturnValueOnce('Bills').mockReturnValueOnce(null)
      const p = show()
      open(p)
      fireEvent.click(p.getByRole('menuitem', { name: 'Rename…' }))
      expect(prompt).toHaveBeenCalledWith('Rename pattern:', 'Invoices')
      expect(p.onRename).toHaveBeenCalledWith('2', 'Bills')
      open(p)
      fireEvent.click(p.getByRole('menuitem', { name: 'Rename…' }))
      expect(p.onRename).toHaveBeenCalledTimes(1)
    })

    it('Delete… asks first', () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
      const p = show()
      open(p)
      fireEvent.click(p.getByRole('menuitem', { name: 'Delete…' }))
      expect(p.onDelete).not.toHaveBeenCalled()
      open(p)
      fireEvent.click(p.getByRole('menuitem', { name: 'Delete…' }))
      expect(confirm).toHaveBeenCalledTimes(2)
      expect(p.onDelete).toHaveBeenCalledWith('2')
    })

    it('closes on Escape', () => {
      const p = show()
      open(p)
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(p.queryByRole('menu')).toBeNull()
    })
  })
})
