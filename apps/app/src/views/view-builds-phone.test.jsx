import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

vi.mock('@capacitor/core', () => ({ CapacitorHttp: undefined, registerPlugin: () => ({}), Capacitor: { isNativePlatform: () => false } }))

import { BuildsView } from './view-builds.jsx'

afterEach(() => { cleanup(); delete window.matchMedia })

const run = { id: 7, source: 'ado', pipeline: 'CI', status: 'failed', branch: 'main', commit: 'abc1234', definitionId: 5, project: 'p', actor: 'sam', when: '1h', duration: '2m', reason: 'manual' }
const mount = (narrow) => {
  window.matchMedia = (q) => ({ matches: narrow && /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} })
  return render(<BuildsView builds={[run]} acknowledgedBuilds={[]} setAcknowledgedBuilds={() => {}}/>)
}

describe('Builds on a phone', () => {
  it('stacks each build as a card with wrapping actions, and drops the column headers', () => {
    const { container } = mount(true)
    const row = container.querySelector('.build-row')
    expect(row.style.display).toBe('flex')
    expect(row.style.flexWrap).toBe('wrap')
    expect(row.style.gridTemplateColumns).toBe('')
    // the column header row is hidden
    expect([...container.querySelectorAll('div')].find(d => d.style.position === 'sticky').style.display).toBe('none')
  })

  it('keeps the table on a wide screen', () => {
    const { container } = mount(false)
    expect(container.querySelector('.build-row').style.display).toBe('grid')
  })
})
