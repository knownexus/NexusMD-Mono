import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FileRail } from './file-rail.jsx'

afterEach(cleanup)

const change = (area, xy = '.M') => ({ id: `${area}\0src/app.jsx`, path: 'src/app.jsx', area, xy })
const commits = [{ oid: 'a'.repeat(40), subject: 'Fix the thing', when: Date.now() - 3600 * 1000 }, { oid: 'b'.repeat(40), subject: 'Older', when: Date.now() - 86400 * 1000 }]
const props = (over = {}) => ({
  path: 'src/app.jsx', change: null, counts: null, commits, elsewhere: { label: 'Open in VS Code' },
  onViewDiff: vi.fn(), onStage: vi.fn(), onUnstage: vi.fn(), onDiscard: vi.fn(), onOpenCommit: vi.fn(),
  onEdit: vi.fn(), onElsewhere: vi.fn(), onReveal: vi.fn(), onNewWindow: vi.fn(), ...over,
})
const show = over => { const p = props(over); render(<FileRail {...p} />); return p }

describe('FileRail', () => {
  it('names the file and its folder', () => {
    show()
    expect(screen.getByText('app.jsx').className).toContain('nx-gw-rail-file')
    expect(screen.getByText('src')).toBeTruthy()
  })

  it('has no status card for a file that is not changed', () => {
    show()
    expect(screen.queryByText(/not staged/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'View diff' })).toBeNull()
  })

  it('says how a changed file is changed, with its line counts, and offers View diff, Stage and Discard…', () => {
    const p = show({ change: change('unstaged'), counts: { add: 9, del: 5 } })
    expect(screen.getByText('Modified · not staged')).toBeTruthy()
    expect(screen.getByText('+9')).toBeTruthy()
    expect(screen.getByText('−5')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'View diff' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stage' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard…' }))
    expect(p.onViewDiff).toHaveBeenCalledTimes(1)
    expect(p.onStage).toHaveBeenCalledWith(change('unstaged'))
    expect(p.onDiscard).toHaveBeenCalledWith(change('unstaged'))
  })

  it('offers Unstage, and no Discard…, for a staged file', () => {
    const p = show({ change: change('staged', 'M.') })
    expect(screen.getByText('Modified · staged')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Unstage' }))
    expect(p.onUnstage).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Discard…' })).toBeNull()
  })

  it('names an untracked file and offers Delete… for it', () => {
    show({ change: change('untracked', '??') })
    expect(screen.getByText('Untracked')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete…' })).toBeTruthy()
  })

  it('lists the recent commits and opens one in History', () => {
    const p = show()
    expect(screen.getByText('Fix the thing')).toBeTruthy()
    expect(screen.getByText('aaaaaaa')).toBeTruthy()
    fireEvent.click(screen.getByText('Older'))
    expect(p.onOpenCommit).toHaveBeenCalledWith('b'.repeat(40))
  })

  it('says so while the history loads, and when the file has none', () => {
    show({ commits: null })
    expect(screen.getByText('Loading…')).toBeTruthy()
    cleanup()
    show({ commits: [] })
    expect(screen.getByText('No commits yet.')).toBeTruthy()
  })

  it('has Edit here, the other app, Show in Explorer and New window at the bottom', () => {
    const p = show()
    const edit = screen.getByRole('button', { name: /^Edit here/ })
    expect(edit.textContent).toContain('Enter')
    fireEvent.click(edit)
    fireEvent.click(screen.getByRole('button', { name: 'Open in VS Code' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show in Explorer' }))
    fireEvent.click(screen.getByRole('button', { name: 'New window' }))
    for (const k of ['onEdit', 'onElsewhere', 'onReveal', 'onNewWindow']) expect(p[k]).toHaveBeenCalledTimes(1)
  })

  it('has no Edit here without a way to edit', () => {
    show({ onEdit: null })
    expect(screen.queryByRole('button', { name: /^Edit here/ })).toBeNull()
  })
})
