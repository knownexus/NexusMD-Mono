import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { DocumentsModal } from '../src/views/documents-modal.jsx'

afterEach(cleanup)

function makeDocs() {
  return [
    { id: '1', name: null, autoName: 'First doc', content: 'a', createdAt: 1, updatedAt: 2000 },
    { id: '2', name: 'Custom Name', autoName: 'Second doc', content: 'b', createdAt: 1, updatedAt: 1000 },
  ]
}

function renderModal(overrides = {}) {
  const props = {
    docs: makeDocs(),
    currentDocId: null,
    hasUnsavedContent: false,
    onOpen: vi.fn(),
    onNew: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onClose: vi.fn(),
    renderPreview: doc => <div>preview:{doc.id}</div>,
    metaText: doc => `meta:${doc.id}`,
    ...overrides,
  }
  const utils = render(<DocumentsModal {...props}/>)
  return { ...utils, props }
}

describe('DocumentsModal', () => {
  it('lists documents sorted by most-recently-updated first, with name/meta/preview', () => {
    const { getAllByText, getByText } = renderModal()
    expect(getByText('First doc')).toBeTruthy()
    expect(getByText('Custom Name')).toBeTruthy()
    expect(getByText('preview:1')).toBeTruthy()
    expect(getByText('meta:2')).toBeTruthy()
    const names = getAllByText(/^(First doc|Custom Name)$/).map(el => el.textContent)
    expect(names).toEqual(['First doc', 'Custom Name'])
  })

  it('shows an empty state when there are no documents', () => {
    const { getByText } = renderModal({ docs: [] })
    expect(getByText('No saved documents yet.')).toBeTruthy()
  })

  it('opens a document on click when there is no unsaved content', () => {
    const { getByText, props } = renderModal()
    fireEvent.click(getByText('First doc'))
    expect(props.onOpen).toHaveBeenCalledWith('1')
  })

  it('asks for confirmation before discarding unsaved content to open another doc', () => {
    const { getByText, props } = renderModal({ hasUnsavedContent: true })
    fireEvent.click(getByText('First doc'))
    expect(props.onOpen).not.toHaveBeenCalled()
    expect(getByText('Open anyway')).toBeTruthy()
    fireEvent.click(getByText('Open anyway'))
    expect(props.onOpen).toHaveBeenCalledWith('1')
  })

  it('renames a document', () => {
    const { getAllByTitle, props } = renderModal()
    fireEvent.click(getAllByTitle('Rename')[0])
    const input = document.querySelector('input')
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.blur(input)
    expect(props.onRename).toHaveBeenCalledWith('1', 'Renamed')
  })

  it('deletes a document after confirming', () => {
    const { getAllByTitle, getByText, props } = renderModal()
    fireEvent.click(getAllByTitle('Delete')[0])
    fireEvent.click(getByText('Delete?'))
    expect(props.onDelete).toHaveBeenCalledWith('1')
  })

  it('calls onNew when clicking New Document', () => {
    const { getByText, props } = renderModal()
    fireEvent.click(getByText('+ New Document'))
    expect(props.onNew).toHaveBeenCalled()
  })

  it('closes when clicking the backdrop', () => {
    const { container, props } = renderModal()
    fireEvent.click(container.firstChild)
    expect(props.onClose).toHaveBeenCalled()
  })
})
