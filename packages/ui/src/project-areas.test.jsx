import React from 'react'
import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { DEFAULT_PROJECT_AREAS, useProjectAreas } from './project-areas.js'

afterEach(cleanup)

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, v),
    removeItem: k => m.delete(k),
    _map: m,
  }
}

function Harness({ storage, getProfileKey, onReady }) {
  const [areas, setAreas] = useProjectAreas({ storage, getProfileKey })
  onReady(areas, setAreas)
  return <div data-testid="count">{areas.length}</div>
}

describe('DEFAULT_PROJECT_AREAS', () => {
  it('is a non-empty array of area nodes with id/name/items/children', () => {
    expect(Array.isArray(DEFAULT_PROJECT_AREAS)).toBe(true)
    expect(DEFAULT_PROJECT_AREAS.length).toBeGreaterThan(0)
    for (const node of DEFAULT_PROJECT_AREAS) {
      expect(typeof node.id).toBe('string')
      expect(typeof node.name).toBe('string')
      expect(Array.isArray(node.items)).toBe(true)
      expect(Array.isArray(node.children)).toBe(true)
    }
  })
})

describe('useProjectAreas', () => {
  it('falls back to DEFAULT_PROJECT_AREAS when storage is empty', () => {
    const storage = memStorage()
    let latest
    render(<Harness storage={storage} getProfileKey={k => k} onReady={(a) => { latest = a }} />)
    expect(latest).toEqual(DEFAULT_PROJECT_AREAS)
  })

  it('loads a previously persisted tree from storage', () => {
    const custom = [{ id: 'x', name: 'X', items: ['a'], children: [] }]
    const storage = memStorage({ 'nexusmd.projectAreas.v1': JSON.stringify(custom) })
    let latest
    render(<Harness storage={storage} getProfileKey={k => k} onReady={(a) => { latest = a }} />)
    expect(latest).toEqual(custom)
  })

  it('persists changes back to storage', () => {
    const storage = memStorage()
    let setter
    render(<Harness storage={storage} getProfileKey={k => k} onReady={(_, s) => { setter = s }} />)
    const next = [{ id: 'y', name: 'Y', items: [], children: [] }]
    act(() => setter(next))
    expect(JSON.parse(storage._map.get('nexusmd.projectAreas.v1'))).toEqual(next)
  })

  it('scopes the storage key through getProfileKey', () => {
    const storage = memStorage()
    render(<Harness storage={storage} getProfileKey={k => 'profileA.' + k} onReady={() => {}} />)
    expect(storage._map.has('profileA.nexusmd.projectAreas.v1')).toBe(false) // nothing written yet
  })
})
