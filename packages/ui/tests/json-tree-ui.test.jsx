import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen, within } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, JsonEditorView } from '../src/index.js'

function memStorage() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
const renderEditor = () => render(
  <NexusDataProvider value={{ storage: memStorage(), getProfileKey: k => k, pushPref: () => {} }}>
    <JsonEditorView/>
  </NexusDataProvider>
)
const raw = () => JSON.parse(document.querySelector('textarea').value)
// The tree row whose key is `key` (the key is the row's first bold label).
const row = (key) => [...document.querySelectorAll('.je-row')].find(r => r.querySelector('.je-key')?.textContent === key)

afterEach(cleanup)

describe('desktop JSON tree (shared search and node editing)', () => {
  it('searching the JSON tree highlights matching paths', () => {
    renderEditor()
    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'bristol' } })
    expect(screen.getByText('1 match')).toBeTruthy()
    // The match is marked, and the group above it is opened to reach it.
    expect(document.querySelector('mark').textContent).toBe('Bristol')
    expect(row('address')).toBeTruthy()
    expect(row('city')).toBeTruthy()
    // Fields that don't match are hidden while searching.
    expect(row('name')).toBeUndefined()
    expect(screen.queryByText('Alice Johnson')).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'zzz' } })
    expect(screen.getByText(/Nothing matches/)).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: '' } })
    expect(screen.getByText('Alice Johnson')).toBeTruthy()
  })

  it('editing a node updates the document and rejects a duplicate key', () => {
    renderEditor()
    fireEvent.click(within(row('age')).getByTitle('Edit (or double-click)'))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'name' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByRole('alert').textContent).toMatch(/already a field called "name"/)
    expect(raw().age).toBe(28)

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'years' } })
    fireEvent.change(within(dialog).getByLabelText('Value'), { target: { value: '30' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(raw().years).toBe(30)
    expect(raw()).not.toHaveProperty('age')
  })

  it('Enter in the Name field saves, and a duplicate name shows the error instead', () => {
    renderEditor()
    fireEvent.click(within(row('age')).getByTitle('Edit (or double-click)'))
    let dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'name' } })
    fireEvent.keyDown(within(dialog).getByLabelText('Name'), { key: 'Enter' })
    expect(within(dialog).getByRole('alert').textContent).toMatch(/already a field called "name"/)
    expect(raw().age).toBe(28)

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'years' } })
    fireEvent.keyDown(within(dialog).getByLabelText('Name'), { key: 'Enter' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(raw().years).toBe(28)

    // A number value, and adding a field, submit on Enter too.
    fireEvent.click(within(row('score')).getByTitle('Edit (or double-click)'))
    dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Value'), { target: { value: '99' } })
    fireEvent.keyDown(within(dialog).getByLabelText('Value'), { key: 'Enter' })
    expect(raw().score).toBe(99)

    fireEvent.click(screen.getByTitle('Add field'))
    dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'nick' } })
    fireEvent.keyDown(within(dialog).getByLabelText('Name'), { key: 'Enter' })
    expect(raw().nick).toBe('')
  })

  it('a text value keeps Enter for new lines and saves on Ctrl+Enter', () => {
    renderEditor()
    fireEvent.click(within(row('name')).getByTitle('Edit (or double-click)'))
    const dialog = screen.getByRole('dialog')
    const value = within(dialog).getByLabelText('Value')
    fireEvent.change(value, { target: { value: 'Bob' } })
    fireEvent.keyDown(value, { key: 'Enter' })
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(raw().name).toBe('Alice Johnson')
    fireEvent.keyDown(value, { key: 'Enter', ctrlKey: true })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(raw().name).toBe('Bob')
  })

  it('refuses a value that is not a number', () => {
    renderEditor()
    fireEvent.click(within(row('score')).getByTitle('Edit (or double-click)'))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Value'), { target: { value: 'lots' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByRole('alert').textContent).toMatch(/not a number/)
    expect(raw().score).toBe(94.5)
  })
})
