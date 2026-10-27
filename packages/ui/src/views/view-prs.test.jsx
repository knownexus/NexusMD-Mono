import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PRView } from './view-prs.jsx'
import { NexusDataProvider } from '../data-context.jsx'

afterEach(cleanup)

const basePr = {
  id: 42, title: 'Fix the thing', url: 'https://dev.azure.com/org/proj/_git/repo/pullrequest/42',
  author: 'Alex', additions: 3, deletions: 1, status: 'active', reviewers: [],
}

// PRView defaults to the "needs my review" filter, which basePr (no reviewers/votes)
// never matches. Seed storage with filter 'all', mirroring the pattern already used in
// packages/ui/tests/pr-focused-filter.test.jsx, so the card actually renders for these tests.
function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
function renderPRView(props) {
  const storage = memStorage({ 'nexusmd.pr.filter': JSON.stringify('all') })
  return render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', TEAM: [] } }}>
      <PRView {...props} />
    </NexusDataProvider>
  )
}

describe('PRView card DevOps link', () => {
  it('renders a link button when pr.url is set and calls onOpenLink', () => {
    const onOpenLink = vi.fn()
    renderPRView({ prs: [basePr], onOpen: vi.fn(), onOpenLink })
    const link = screen.getByTestId('pr-open-link')
    fireEvent.click(link)
    expect(onOpenLink).toHaveBeenCalledWith(basePr.url)
  })

  it('does not render a link button when pr.url is empty', () => {
    renderPRView({ prs: [{ ...basePr, url: '' }], onOpen: vi.fn(), onOpenLink: vi.fn() })
    expect(screen.queryByTestId('pr-open-link')).toBeNull()
  })

  it('clicking the link does not trigger the row onOpen', () => {
    const onOpen = vi.fn()
    renderPRView({ prs: [basePr], onOpen, onOpenLink: vi.fn() })
    fireEvent.click(screen.getByTestId('pr-open-link'))
    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe('PRView opened from a link with a preset', () => {
  afterEach(() => { window.NexusMDNav = null })

  it('opens on the tab the link asked for (the Dashboard PR tile\'s segments)', () => {
    window.NexusMDNav = { view: 'prs', pendingFilter: { preset: 'drafts' } }
    const prs = [{ ...basePr, id: 1, title: 'Still a draft', status: 'draft' }, { ...basePr, id: 2, title: 'Ready to go' }]
    renderPRView({ prs, onOpen: vi.fn(), onOpenLink: vi.fn() })
    expect(screen.getByText('Still a draft')).toBeTruthy()
    expect(screen.queryByText('Ready to go')).toBeNull()
    expect(window.NexusMDNav).toBeNull()   // consumed, so a later visit keeps the user's own tab
  })

  it('ignores a preset that is not one of its tabs', () => {
    window.NexusMDNav = { view: 'prs', pendingFilter: { preset: 'nonsense' } }
    renderPRView({ prs: [basePr], onOpen: vi.fn(), onOpenLink: vi.fn() })
    expect(screen.getByText('Fix the thing')).toBeTruthy()   // still on the stored 'all' tab
  })
})
