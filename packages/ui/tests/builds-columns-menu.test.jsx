import { it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, BuildsView } from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }
}
const BUILD = { id: 'b1', pipeline: 'API', status: 'success', branch: 'feature/x', project: 'Proj', definitionId: 5, commit: 'abc1234', reason: 'manual', duration: '1m', when: 'now', finishTime: '2026-01-02T10:00:00' }

const mount = (storage) => render(
  <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o' } }}>
    <BuildsView builds={[BUILD]} acknowledgedBuilds={[]} setAcknowledgedBuilds={() => {}} />
  </NexusDataProvider>
)
const tableMin = (container) => parseInt(container.querySelector('[data-testid="builds-table"]').style.minWidth, 10)

afterEach(cleanup)

it('hiding a column from the Columns menu removes its header and cells and shrinks the table', () => {
  const storage = memStorage({})
  const { getByRole, queryByText, getByLabelText, container } = mount(storage)
  expect(queryByText('feature/x')).not.toBeNull()
  const before = tableMin(container)

  fireEvent.click(getByRole('button', { name: /Columns/ }))
  const branchBox = getByLabelText('Branch')
  fireEvent.click(branchBox)

  expect(queryByText('feature/x')).toBeNull()            // the cell
  const header = [...container.querySelectorAll('div')].find(d => d.style.position === 'sticky')
  expect([...header.children].map(c => c.textContent)).not.toContain('Branch')   // the header
  expect(header.children.length).toBe(9)
  expect(container.querySelector('.build-row').children.length).toBe(9)
  expect(tableMin(container)).toBe(before - 160 - 8)
  // stored in the shared Settings → Fields config
  expect(JSON.parse(storage.m.get('nexusmd.fields.buildsTable')).find(e => e.key === 'branch').visible).toBe(false)
})

it('ignores a saved hidden column id that no longer exists', () => {
  const storage = memStorage({ 'nexusmd.fields.buildsTable': JSON.stringify([{ key: 'gone', visible: false }]) })
  const { container, queryByText } = mount(storage)
  expect(container.querySelector('.build-row').children.length).toBe(10)
  expect(queryByText('feature/x')).not.toBeNull()
})

it('moving a column in the menu reorders the table', () => {
  const storage = memStorage({})
  const { getByRole, getByLabelText, container } = mount(storage)
  fireEvent.click(getByRole('button', { name: /Columns/ }))
  const cellText = () => [...container.querySelector('.build-row').children].map(c => c.textContent)
  expect(cellText().indexOf('abc1234')).toBeGreaterThan(cellText().indexOf('feature/x'))
  fireEvent.click(getByLabelText('Move Commit left'))
  expect(cellText().indexOf('abc1234')).toBeLessThan(cellText().indexOf('feature/x'))
})
