import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import fs from 'fs'
import path from 'path'
import { parseLog, parseCommitDetails } from '@nexusmd/core'
import { HistoryPane, relativeTime } from './history-pane.jsx'
import { CommitDetail } from './commit-detail.jsx'

afterEach(cleanup)

// jsdom's import.meta.url isn't a file URL; vitest's __dirname is.
const LOG = fs.readFileSync(path.resolve(__dirname, '../../../../packages/core/src/modules/git/fixtures/log-merge.txt'), 'utf8')
const rows = parseLog(LOG)
const commits = rows.filter(r => r.commit).map(r => r.commit)

function history(over = {}) {
  return {
    refs: [{ ref: 'refs/heads/main' }, { ref: 'refs/remotes/origin/main' }, { ref: 'refs/tags/v1' }],
    filter: 'all', setFilter: vi.fn(), base: null, setBase: vi.fn(), needsBase: false,
    search: null, setSearch: vi.fn(() => true), searchError: null, limit: 200, loadMore: vi.fn(),
    rows, unpushed: new Set([commits[0].oid, commits[1].oid, commits[2].oid]), tip: commits[0].oid, truncated: false,
    loaded: true, loading: false, error: null, shallow: false, refresh: vi.fn(), ...over,
  }
}
const setup = (over = {}, props = {}) => {
  const onFocus = vi.fn()
  const onOpenFiles = vi.fn()
  render(<HistoryPane history={history(over)} focusOid={props.focusOid ?? null} onFocus={onFocus} onOpenFiles={onOpenFiles} />)
  return { onFocus, onOpenFiles }
}

describe('HistoryPane', () => {
  it('draws one option per commit with graph glyphs, ref chips and unpushed marks', () => {
    setup()
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(5)
    expect(options[0].textContent).toContain('●')
    expect(options[0].textContent).toContain('Merge side')
    expect(within(options[0]).getByText('main').dataset.kind).toBe('branch')
    expect(within(options[0]).getByText('HEAD').dataset.kind).toBe('head')
    expect(within(options[3]).getByText('tag: v1')).toBeTruthy()
    expect(within(options[3]).getByText('origin/main').dataset.kind).toBe('remote')
    expect(screen.getAllByLabelText('Not pushed')).toHaveLength(3)
  })

  it('splits your commits from upstream ones with dividers and colours their dots', () => {
    render(<HistoryPane history={history()} focusOid={null} onFocus={() => {}} upstream="origin/main" />)
    const list = screen.getByRole('listbox', { name: 'Commits' })
    expect([...list.querySelectorAll('.nx-gw-hdivider')].map(d => d.textContent)).toEqual(['Local commits', 'On origin/main'])
    expect([...list.querySelectorAll('.nx-gw-hdot')].map(d => d.dataset.tone)).toEqual(['yours', 'yours', 'yours', 'upstream', 'upstream'])
    cleanup()
    render(<HistoryPane history={history()} focusOid={null} onFocus={() => {}} rebasing />)
    expect(screen.getByText('Your commits · being rebased')).toBeTruthy()
    expect(screen.getByText('Already pushed')).toBeTruthy()
    cleanup()
    setup({ unpushed: new Set() })
    expect(document.querySelectorAll('.nx-gw-hdivider')).toHaveLength(0)
  })

  it('↑/↓ move between commits and skip connector rows; Enter opens the files', () => {
    const { onFocus, onOpenFiles } = setup({}, { focusOid: commits[0].oid })
    const list = screen.getByRole('listbox', { name: 'Commits' })
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(onFocus).toHaveBeenLastCalledWith(commits[1].oid)
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(onOpenFiles).toHaveBeenCalled()
  })

  it('a disabled menu item renders disabled with its reason as the title', () => {
    const commitMenu = () => [{ label: 'Reword…', onSelect: vi.fn(), disabled: true, reason: 'Already pushed' }, { label: 'Revert…', onSelect: vi.fn() }]
    render(<HistoryPane history={history()} focusOid={null} onFocus={() => {}} commitMenu={commitMenu} />)
    fireEvent.contextMenu(screen.getAllByRole('option')[0])
    const reword = screen.getByRole('menuitem', { name: 'Reword…' })
    expect(reword.disabled).toBe(true)
    expect(reword.title).toBe('Already pushed')
    expect(screen.getByRole('menuitem', { name: 'Revert…' }).disabled).toBe(false)
  })

  it('Ctrl-click and Shift-click go to onSelect; a plain click still focuses', () => {
    const onSelect = vi.fn()
    const onFocus = vi.fn()
    render(<HistoryPane history={history()} focusOid={commits[0].oid} onFocus={onFocus} onSelect={onSelect} selected={new Set([commits[0].oid, commits[1].oid])} />)
    const options = screen.getAllByRole('option')
    expect(options.map(o => o.getAttribute('aria-selected'))).toEqual(['true', 'true', 'false', 'false', 'false'])
    fireEvent.click(options[2], { ctrlKey: true })
    expect(onSelect).toHaveBeenLastCalledWith(commits[2].oid, { additive: true, range: false })
    fireEvent.click(options[3], { shiftKey: true })
    expect(onSelect).toHaveBeenLastCalledWith(commits[3].oid, { additive: false, range: true })
    expect(onFocus).not.toHaveBeenCalled()
    fireEvent.click(options[1])
    expect(onFocus).toHaveBeenCalledWith(commits[1].oid)
  })

  it('/ focuses the search; Enter runs it and Escape clears it', () => {
    const h = history()
    render(<HistoryPane history={h} focusOid={null} onFocus={() => {}} />)
    const list = screen.getByRole('listbox', { name: 'Commits' })
    fireEvent.keyDown(list, { key: '/' })
    const box = screen.getByRole('textbox', { name: 'Search history' })
    expect(document.activeElement).toBe(box)
    expect(box.placeholder).toBe('words · @author · :path')
    fireEvent.change(box, { target: { value: '@ana' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(h.setSearch).toHaveBeenLastCalledWith('@ana')
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(h.setSearch).toHaveBeenLastCalledWith('')
    expect(box.value).toBe('')
  })

  it('shows a search error under the box', () => {
    setup({ searchError: 'Type a name after @' })
    expect(screen.getByRole('note').textContent).toBe('Type a name after @')
  })

  it('disables Unpushed when the repository has no remotes', () => {
    setup({ unpushed: null })
    expect(screen.getByRole('button', { name: 'Unpushed' }).disabled).toBe(true)
    expect(screen.getByText('No remotes')).toBeTruthy()
  })

  it('offers a base picker for Since and asks for one when there is no default', () => {
    const h = history({ filter: 'sinceBase', needsBase: true })
    render(<HistoryPane history={h} focusOid={null} onFocus={() => {}} />)
    expect(screen.getByText('Pick a base to compare with.')).toBeTruthy()
    const select = screen.getByRole('combobox', { name: 'Base' })
    expect([...select.options].map(o => o.textContent)).toEqual(['(pick a base)', 'main', 'origin/main'])
    fireEvent.change(select, { target: { value: 'refs/remotes/origin/main' } })
    expect(h.setBase).toHaveBeenCalledWith('refs/remotes/origin/main')
  })

  it('offers Load more only while the page is cut short', () => {
    setup()
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
    cleanup()
    const h = history({ truncated: true })
    render(<HistoryPane history={h} focusOid={null} onFocus={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(h.loadMore).toHaveBeenCalled()
  })

  it('notes a shallow clone and an empty branch', () => {
    setup({ shallow: true, rows: [], tip: null })
    expect(screen.getByText("Shallow clone - older history isn't here.")).toBeTruthy()
    expect(screen.getByText('No commits yet.')).toBeTruthy()
  })

  it('writes relative times', () => {
    const now = Date.UTC(2026, 9, 15)
    expect(relativeTime(now - 3 * 86400000, now)).toMatch(/3 days ago/)
    expect(relativeTime(now, now)).toMatch(/minute|now/)
  })
})

describe('CommitDetail', () => {
  const merge = parseCommitDetails([commits[0].oid, `${'1'.repeat(40)} ${'2'.repeat(40)}`, 'Ana Ñ', 'ana@example.com', '2026-10-14T10:00:00Z',
    'Bot', 'bot@example.com', '2026-10-14T11:00:00Z', 'HEAD -> refs/heads/main', 'Merge side\n\nBody'].join('\0'))
  const commit = over => ({ details: merge, parent: '1'.repeat(40), files: [{ status: 'A', score: null, oldPath: null, path: 's' }, { status: 'R', score: 90, oldPath: 'old', path: 'new' }], diff: null, missing: false, error: null, ...over })
  const show = (over = {}, props = {}) => {
    const handlers = { onParent: vi.fn(), onFile: vi.fn(), onJump: vi.fn() }
    render(<CommitDetail commit={commit(over)} oid={merge.oid} parentIndex={0} focusedPath={props.focusedPath ?? null} {...handlers} />)
    return handlers
  }

  it('shows the short hash, subject, who, when, the message body and the parents as links', () => {
    const { onJump } = show()
    expect(screen.getByText(merge.oid.slice(0, 7)).title).toBe(merge.oid)
    expect(screen.getByRole('heading', { name: 'Merge side' })).toBeTruthy()
    expect(screen.getByText(/^Ana Ñ committed /)).toBeTruthy()
    expect(screen.getByText(/Committed by Bot/)).toBeTruthy()
    expect(screen.getByText(/Body/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '2222222' }))
    expect(onJump).toHaveBeenCalledWith('2'.repeat(40))
  })

  it('a merge can be compared with either parent', () => {
    const { onParent } = show()
    const select = screen.getByRole('combobox', { name: 'Compare with parent' })
    expect([...select.options].map(o => o.textContent)).toEqual(['1 (main line) · 1111111', '2 (merged in) · 2222222'])
    fireEvent.change(select, { target: { value: '1' } })
    expect(onParent).toHaveBeenCalledWith(1)
  })

  it('lists the files with renames and line counts, and focuses one', () => {
    const { onFile } = show({ files: [{ status: 'A', score: null, oldPath: null, path: 's', added: 3, removed: 0 }, { status: 'R', score: 90, oldPath: 'old', path: 'new', added: null, removed: null }] })
    expect(screen.getByText('2 files changed')).toBeTruthy()
    expect(screen.getByLabelText('3 added, 0 removed').textContent).toBe('+3 −0')
    const list = screen.getByRole('listbox', { name: 'Files in commit' })
    expect(within(list).getByText('← old')).toBeTruthy()
    fireEvent.click(within(list).getByText('s'))
    expect(onFile).toHaveBeenCalledWith('s')
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(onFile).toHaveBeenLastCalledWith('s')
  })

  it('shows the focused file\'s diff read-only, against the parent', () => {
    const text = 'diff --git a/s b/s\nnew file mode 100644\n--- /dev/null\n+++ b/s\n@@ -0,0 +1 @@\n+s\n'
    show({ diff: { result: { text, truncated: false, binary: false, size: 10 }, files: [{ path: 's', meta: [], hunks: [{ header: '@@ -0,0 +1 @@', lines: [{ kind: 'add', text: 's', oldNo: null, newNo: 1 }] }] }], error: null, loading: false } }, { focusedPath: 's' })
    expect(screen.getByLabelText('Diff legend').textContent).toContain('− old: 1111111')
    expect(screen.queryByRole('button', { name: /hunk/ })).toBeNull()
  })

  it('offers the actions it is given after Copy hash; a danger one is marked', () => {
    const onSelect = vi.fn()
    render(<CommitDetail commit={commit()} oid={merge.oid} parentIndex={0} focusedPath={null} onParent={() => {}} onFile={() => {}} onJump={() => {}}
      actions={[{ label: 'Cherry-pick…', onSelect }, { label: 'Reset to here…', danger: true, disabled: true, title: 'The branch is already at this commit', onSelect }]} />)
    const buttons = within(screen.getByRole('region', { name: 'Commit' })).getAllByRole('button').map(b => b.textContent)
    expect(buttons.slice(0, 3)).toEqual(['Copy hash', 'Cherry-pick…', 'Reset to here…'])
    fireEvent.click(screen.getByRole('button', { name: 'Cherry-pick…' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    const reset = screen.getByRole('button', { name: 'Reset to here…' })
    expect(reset.disabled).toBe(true)
    expect(reset.className).toContain('danger')
  })

  it('says when the commit is gone', () => {
    show({ missing: true })
    expect(screen.getByText('This commit no longer exists - refresh.')).toBeTruthy()
  })

  it('copies the full id', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Copy hash' }))
    expect(writeText).toHaveBeenCalledWith(merge.oid)
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy()
  })
})
