import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, DocumentsView } from '../src/index.js'

function memStorage() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

function renderDocuments(storage = memStorage()) {
  return render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {} }}>
      <DocumentsView/>
    </NexusDataProvider>
  )
}

afterEach(cleanup)

describe('DocumentsView', () => {
  it('defaults to the Markdown tab and switches to JSON Editor on click', () => {
    const { getByText, container } = renderDocuments()
    expect(container.querySelector('textarea').placeholder).toContain('Start writing')
    fireEvent.click(getByText('JSON Editor'))
    expect(getByText('Alice Johnson')).toBeTruthy()
  })

  it('persists the active tab across remount', () => {
    const storage = memStorage()
    const { getByText, unmount } = renderDocuments(storage)
    fireEvent.click(getByText('JSON Editor'))
    unmount()

    const { getByText: getByText2 } = renderDocuments(storage)
    expect(getByText2('Alice Johnson')).toBeTruthy()
  })
})
