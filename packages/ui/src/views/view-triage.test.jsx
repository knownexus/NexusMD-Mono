import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { NexusDataProvider, EMPTY_NEXUS_DATA } from '../data-context.jsx'
import { TriageRow } from './view-triage.jsx'

afterEach(cleanup)

const item = {
  id: 7, title: 'Fix the thing', type: 'Bug', state: 'New', url: 'https://example.test/7', project: 'P',
  bucket: 'Flesh out', priority: 'Medium', area: 'Other', suggestedOwner: 'TBD', status: 'Not started', action: '', tags: '',
}
const wrap = (ui) => (
  <NexusDataProvider value={{ data: EMPTY_NEXUS_DATA, workItemSource: { loadDetail: async () => null, loadComments: async () => [], loadRawFields: async () => ({}) } }}>
    {ui}
  </NexusDataProvider>
)

describe('TriageRow', () => {
  it('persists edits through saveTriage when the host supplies one', async () => {
    const saveTriage = vi.fn().mockResolvedValue(undefined)
    const onUpdate = vi.fn()
    render(wrap(<TriageRow it={item} onUpdate={onUpdate} saveTriage={saveTriage} />))
    fireEvent.click(screen.getByText('Fix the thing'))
    fireEvent.change(screen.getByDisplayValue('Medium'), { target: { value: 'High' } })
    await waitFor(() => expect(saveTriage).toHaveBeenCalledWith(7, { priority: 'High' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(7, { priority: 'High' }))
  })

  it('applies the host select style to the inline selects', () => {
    render(wrap(<TriageRow it={item} saveTriage={async () => {}} selectStyle={{ height: 44 }} />))
    fireEvent.click(screen.getByText('Fix the thing'))
    expect(screen.getByDisplayValue('Medium').style.height).toBe('44px')
  })
})
