import React from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@capacitor/core', () => ({ CapacitorHttp: undefined }))

import { DocumentsPhone } from './documents-phone.jsx'

const DOC = JSON.stringify({ name: 'Alice', age: 28, tags: ['dev', 'mentor'], address: { city: 'Bristol' } })

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('documents_active_tab', JSON.stringify('json'))
  localStorage.setItem('json_editor_documents', JSON.stringify([{ id: 'j1', name: null, autoName: 'Alice', content: DOC, createdAt: 1, updatedAt: 1 }]))
})
afterEach(cleanup)

const mount = (onFlash = vi.fn()) => {
  render(<DocumentsPhone onFlash={onFlash}/>)
  fireEvent.click(screen.getByRole('button', { name: 'Tree' }))
  return onFlash
}
const text = () => JSON.parse(screen.getByLabelText('JSON').value)
const toEdit = () => fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

describe('editing the JSON tree', () => {
  it('changes a value, saves it into the document, and Undo puts it back', async () => {
    const onFlash = mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit name' }))
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'Bob' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    toEdit()
    expect(text().name).toBe('Bob')
    const [msg, , undo] = onFlash.mock.calls.at(-1)
    expect(msg).toBe('Updated name')
    undo()
    await waitFor(() => expect(text().name).toBe('Alice'))
  })

  it('renames a field and changes its type', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit age' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'years' } })
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'string' } })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'twenty-eight' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    toEdit()
    expect(text().years).toBe('twenty-eight')
    expect(text()).not.toHaveProperty('age')
  })

  it('refuses a name that is already taken and keeps the sheet open', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit age' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert').textContent).toMatch(/already a field called "name"/)
  })

  it('adds a field to a group', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit address' }))
    fireEvent.click(screen.getByRole('button', { name: /Add a field/ }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'country' } })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'UK' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }))
    toEdit()
    expect(text().address).toEqual({ city: 'Bristol', country: 'UK' })
  })

  it('deletes only after a second tap, and can undo it', async () => {
    const onFlash = mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit age' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(text).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete for sure' }))
    toEdit()
    expect(text()).not.toHaveProperty('age')
    onFlash.mock.calls.at(-1)[2]()
    await waitFor(() => expect(text().age).toBe(28))
  })

  it('searches names and values and shows only what matches', async () => {
    mount()
    fireEvent.change(await screen.findByLabelText('Search the tree'), { target: { value: 'bristol' } })
    expect(screen.getByText('1 match')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit city' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit name' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Search the tree'), { target: { value: 'zzz' } })
    expect(screen.getByText(/Nothing matches/)).toBeTruthy()
  })

  it('opens and closes a group with its caret without editing it', async () => {
    mount()
    const caret = await screen.findAllByRole('button', { name: 'Collapse' })
    fireEvent.click(caret[0])
    expect(screen.queryByRole('button', { name: 'Edit name' })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
