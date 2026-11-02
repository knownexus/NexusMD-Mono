import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'

let profile = { activeProfile: { type: 'manual' } }
vi.mock('@nexusmd/ui', async importOriginal => ({
  ...(await importOriginal()),
  useProfile: () => profile,
}))
vi.mock('@nexusmd/shell-sdk', async importOriginal => ({
  ...(await importOriginal()),
  getProfileKey: k => `nexusmd.p.p1.${k}`,
}))

import { NexusDataProvider } from '@nexusmd/ui'
import manifest from '../../app.manifest.json'
import workModule from './index.js'
import { ListsApp } from './lists-view.jsx'
import { resetOffScreensCache } from './work-screens.js'

const KEY = 'nexusmd.p.p1.nexusmd.lists'

function OffViews() { return <div data-testid="off">{JSON.stringify(workModule.useOffViews())}</div> }
const offViews = () => JSON.parse(screen.getByTestId('off').textContent)
const mountLists = () => render(<NexusDataProvider value={{ data: { TEAM: [] } }}><ListsApp /></NexusDataProvider>)

beforeEach(() => {
  localStorage.clear()
  resetOffScreensCache()
  profile = { activeProfile: { type: 'manual' } }
})
afterEach(cleanup)

describe('Lists on desktop', () => {
  it('Lists nav entry is shown for a manual profile and hidden for an ADO profile', () => {
    expect(manifest.nav.find(n => n.id === 'lists')).toMatchObject({ id: 'lists', label: 'Lists', icon: 'work' })
    expect(workModule.views.lists).toBe(ListsApp)

    render(<OffViews />)
    expect(offViews()).not.toContain('lists')
    cleanup()

    profile = { activeProfile: { type: 'ado' } }
    render(<OffViews />)
    expect(offViews()).toContain('lists')
  })

  it('adding an item writes nexusmd.lists and dispatches nexusmd:data-changed for lists', () => {
    localStorage.setItem(KEY, JSON.stringify({ lists: [{ id: 'l1', name: 'Groceries', fields: [], statuses: ['Open'], items: [] }] }))
    const seen = []
    const onChanged = e => seen.push(e.detail)
    document.addEventListener('nexusmd:data-changed', onChanged)
    try {
      mountLists()
      expect(screen.getAllByText('Groceries').length).toBeGreaterThan(0)
      fireEvent.click(screen.getByText('+ Add item'))
      fireEvent.change(screen.getByRole('dialog').querySelector('input'), { target: { value: 'Milk' } })
      fireEvent.click(screen.getByText('Save'))
    } finally { document.removeEventListener('nexusmd:data-changed', onChanged) }
    const saved = JSON.parse(localStorage.getItem(KEY))
    expect(saved.lists[0].items.map(i => i.title)).toEqual(['Milk'])
    expect(seen).toContainEqual({ collId: 'lists' })
  })

  it('a pulled sync update (nexusmd:sync-applied for lists) re-renders the new data', () => {
    localStorage.setItem(KEY, JSON.stringify({ lists: [{ id: 'l1', name: 'Before', fields: [], items: [] }] }))
    mountLists()
    expect(screen.getAllByText('Before').length).toBeGreaterThan(0)
    localStorage.setItem(KEY, JSON.stringify({ lists: [{ id: 'l1', name: 'After', fields: [], items: [] }] }))
    act(() => { document.dispatchEvent(new CustomEvent('nexusmd:sync-applied', { detail: { collId: 'planner' } })) })
    expect(screen.queryByText('After')).toBeNull()
    act(() => { document.dispatchEvent(new CustomEvent('nexusmd:sync-applied', { detail: { collId: 'lists' } })) })
    expect(screen.getAllByText('After').length).toBeGreaterThan(0)
    expect(screen.queryByText('Before')).toBeNull()
  })
})
