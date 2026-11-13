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

describe('PRView with GitHub pull requests', () => {
  it('shows the repo-qualified number, not the internal id', () => {
    renderPRView({ prs: [{ ...basePr, id: 'gh:acme/web#7', displayId: 'acme/web#7', source: 'github' }], onOpen: vi.fn(), onOpenLink: vi.fn() })
    expect(screen.getByText('acme/web#7')).toBeTruthy()
    expect(screen.queryByText('#gh:acme/web#7')).toBeNull()
  })
})

describe('PRView All and Mine tabs', () => {
  const pr = (id, title, over = {}) => ({ ...basePr, id, title, author: 'sam-lee', ...over })
  const PRS = [
    pr(1, 'Mine, ready', { author: 'alex-doe' }),
    pr(2, 'Mine, draft', { author: 'alex-doe', status: 'draft' }),
    pr(3, 'Mine, merged', { author: 'alex-doe', status: 'merged' }),
    pr(4, 'Theirs, ready'),
    pr(5, 'Theirs, draft', { status: 'draft' }),
  ]
  function renderWith(props, { filter = 'needsMe', me = { name: 'Alex Doe' } } = {}) {
    const storage = memStorage({ 'nexusmd.pr.filter': JSON.stringify(filter) })
    return render(
      <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', TEAM: [], ME: me } }}>
        <PRView onOpen={vi.fn()} onOpenLink={vi.fn()} {...props} />
      </NexusDataProvider>,
    )
  }
  // The tabs are plain divs, so they are found by their class and the start of their text.
  const chip = name => {
    const hit = [...document.querySelectorAll('.filter-chip')].find(el => el.textContent.startsWith(name))
    if (!hit) throw new Error(`no ${name} tab`)
    return hit
  }
  afterEach(() => { window.NexusMDNav = null })

  it('All shows every pull request, drafts and merged ones too, and counts them', () => {
    renderWith({ prs: PRS })
    expect(chip('All').textContent).toMatch(/5/)
    fireEvent.click(chip('All'))
    for (const p of PRS) expect(screen.getByText(p.title)).toBeTruthy()
  })

  it('Mine shows only the ones I opened, whatever their state, and counts them', () => {
    renderWith({ prs: PRS })
    expect(chip('Mine').textContent).toMatch(/3/)
    fireEvent.click(chip('Mine'))
    for (const t of ['Mine, ready', 'Mine, draft', 'Mine, merged']) expect(screen.getByText(t)).toBeTruthy()
    for (const t of ['Theirs, ready', 'Theirs, draft']) expect(screen.queryByText(t)).toBeNull()
  })

  it('moving between All and Mine changes the list', () => {
    renderWith({ prs: PRS }, { filter: 'all' })
    expect(screen.getByText('Theirs, ready')).toBeTruthy()
    fireEvent.click(chip('Mine'))
    expect(screen.queryByText('Theirs, ready')).toBeNull()
    fireEvent.click(chip('All'))
    expect(screen.getByText('Theirs, ready')).toBeTruthy()
  })

  it('opens on Mine or All when a link asks for it', () => {
    window.NexusMDNav = { view: 'prs', pendingFilter: { preset: 'mine' } }
    renderWith({ prs: PRS })
    expect(screen.getByText('Mine, draft')).toBeTruthy()
    expect(screen.queryByText('Theirs, ready')).toBeNull()
  })

  it('shows Mine as empty when the current user is not known, rather than guessing', () => {
    renderWith({ prs: PRS }, { filter: 'mine', me: null })
    expect(screen.getByText('No pull requests match.')).toBeTruthy()
    expect(chip('Mine').textContent).toMatch(/0/)
  })

  it('leaves the other tabs as they were: Needs my review still holds only review requests, Active still no drafts', () => {
    renderWith({ prs: PRS }, { filter: 'active' })
    expect(screen.getByText('Mine, ready')).toBeTruthy()
    expect(screen.queryByText('Mine, draft')).toBeNull()
    fireEvent.click(chip('Needs my review'))
    expect(screen.getByText('No pull requests match.')).toBeTruthy()
  })
})
