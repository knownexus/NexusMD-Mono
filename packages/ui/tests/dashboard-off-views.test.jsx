import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, EMPTY_NEXUS_DATA, DashboardView } from '../src/index.js'

afterEach(cleanup)
beforeEach(() => {
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}), text: () => Promise.resolve('') }))
})

function memStorage() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, removeItem: (k) => { m.delete(k) } }
}

function renderDashboard(offViews) {
  const value = {
    data: { ...EMPTY_NEXUS_DATA }, api: { load: () => Promise.resolve() }, storage: memStorage(),
    getProfileKey: (k) => k, namespace: 'nexusmd', googleAuth: null,
  }
  return render(
    <NexusDataProvider value={value}>
      <DashboardView
        onOpenItem={() => {}} onOpenPR={() => {}}
        widgetOrder={['review', 'blockers', 'team', 'triage']} setWidgetOrder={() => {}}
        widgetWidths={{}} setWidgetWidths={() => {}}
        widgetHeights={{}} setWidgetHeights={() => {}}
        needsMeCriteria={{ votes: [0] }} setPlannerData={() => {}}
        quickLinks={[]} offViews={offViews}
      />
    </NexusDataProvider>,
  )
}

const text = container => container.textContent

describe('DashboardView with Work screens switched off', () => {
  it('shows every screen\'s widgets when nothing is off', () => {
    const { container } = renderDashboard([])
    expect(text(container)).toContain('Needs your review')
    expect(text(container)).toContain('Team — working on now')
    expect(text(container)).toContain('Triage queue')
    expect(container.querySelector('[title="Failed builds"]')).not.toBeNull()
  })

  it('drops the widgets, tiles and links of the screens that are off, and keeps the rest', () => {
    const { container } = renderDashboard(['prs', 'team', 'triage', 'builds'])
    expect(text(container)).not.toContain('Needs your review')
    expect(text(container)).not.toContain('Team — working on now')
    expect(text(container)).not.toContain('Triage queue')
    expect(container.querySelector('[title="Failed builds"]')).toBeNull()
    expect(text(container)).toContain('Blockers & risks')
  })
})
