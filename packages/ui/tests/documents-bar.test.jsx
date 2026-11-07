import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import { DocumentsBar } from '../src/views/documents-bar.jsx'

afterEach(cleanup)
const tabs = [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }]
const bar = save => render(<DocumentsBar tabs={tabs} tab="a" onTab={() => {}} save={save} />)

describe('DocumentsBar save state', () => {
  it('shows Saving… with a warning dot while a save is under way', () => {
    const { getByText } = bar({ status: 'saving', savedAt: null })
    expect(getByText('Saving…').previousElementSibling.getAttribute('data-tone')).toBe('warn')
  })

  it('treats an unsaved new document as saving', () => {
    expect(bar({ status: 'unsaved', savedAt: null }).getByText('Saving…')).toBeTruthy()
  })

  it('shows Saved just now with a success dot right after a save', () => {
    const { getByText } = bar({ status: 'saved', savedAt: Date.now() })
    expect(getByText('Saved just now').previousElementSibling.getAttribute('data-tone')).toBe('ok')
  })

  it('keeps saying when it last saved once the status has cleared, and says nothing before any save', () => {
    expect(bar({ status: '', savedAt: Date.now() - 5 * 60000 }).getByText('Saved 5m ago')).toBeTruthy()
    cleanup()
    expect(bar({ status: '', savedAt: null }).container.querySelector('.nx-docs-save')).toBeNull()
    cleanup()
    expect(bar(null).container.querySelector('.nx-docs-save')).toBeNull()
  })
})
