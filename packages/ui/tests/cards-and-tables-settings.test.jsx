import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, CardsAndTablesSettings } from '../src/index.js'

function memStorage() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

afterEach(cleanup)

it('persists a toggle to storage under the surface key', () => {
  const storage = memStorage()
  const { getAllByLabelText } = render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {} }}>
      <CardsAndTablesSettings />
    </NexusDataProvider>
  )
  // "Tags" appears in both the Work item cards and Work item table catalogs;
  // the first match belongs to the first-rendered card (wiCard).
  const boxes = getAllByLabelText('Tags')
  fireEvent.click(boxes[0])
  const saved = JSON.parse(storage.getItem('nexusmd.fields.wiCard'))
  expect(saved.find(e => e.key === 'tags').visible).toBe(false)
})
