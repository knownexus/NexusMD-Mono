import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { parseDiff } from '@nexusmd/core'
import { DiffPane } from './diff-pane.jsx'

afterEach(cleanup)

const TWO = [
  'diff --git a/f.txt b/f.txt', '--- a/f.txt', '+++ b/f.txt',
  '@@ -1,2 +1,2 @@', ' keep', '-old line', '+new line',
  '@@ -10 +10,2 @@', ' ten', '+added',
].join('\n') + '\n'
const change = (area, path = 'f.txt') => ({ path, originalPath: null, area, xy: '.M', sub: 'N...', id: `${area}\0${path}` })
const loaded = (text, extra = {}) => ({ key: 'k', result: { text, stamp: 's1', truncated: false, binary: false, size: text.length, ...extra }, files: parseDiff(text).files, error: null, loading: false })

describe('DiffPane', () => {
  it('labels which side is old and which is new, with line-number gutters and +/− signs', () => {
    render(<DiffPane change={change('unstaged')} diff={loaded(TWO)} onHunk={vi.fn()} />)
    const legend = screen.getByLabelText('Diff legend')
    expect(within(legend).getByText('− old: index')).toBeTruthy()
    expect(within(legend).getByText('+ new: working tree')).toBeTruthy()
    const rows = screen.getAllByTestId('diff-line')
    expect(rows.map(r => [r.dataset.kind, r.textContent])).toEqual([
      ['context', '11 keep'], ['del', '2−old line'], ['add', '2+new line'], ['context', '1010 ten'], ['add', '11+added'],
    ])
  })

  it('offers Stage hunk per hunk for unstaged changes and Unstage hunk for staged ones', () => {
    const onHunk = vi.fn()
    render(<DiffPane change={change('unstaged')} diff={loaded(TWO)} onHunk={onHunk} />)
    const buttons = screen.getAllByRole('button', { name: 'Stage hunk' })
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[1])
    expect(onHunk).toHaveBeenCalledWith(1, 's1')
    cleanup()
    render(<DiffPane change={change('staged')} diff={loaded(TWO)} onHunk={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: 'Unstage hunk' })).toHaveLength(2)
    expect(screen.getByText('− old: HEAD')).toBeTruthy()
  })

  it('disables hunk buttons while a write runs', () => {
    render(<DiffPane change={change('unstaged')} diff={loaded(TWO)} onHunk={vi.fn()} busy />)
    expect(screen.getAllByRole('button', { name: 'Stage hunk' }).every(b => b.disabled)).toBe(true)
  })

  it('disables hunk buttons while the diff reloads', () => {
    render(<DiffPane change={change('unstaged')} diff={{ ...loaded(TWO), loading: true }} onHunk={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: 'Stage hunk' }).every(b => b.disabled)).toBe(true)
  })

  it('hides hunk buttons for renamed, copied, mode-changed and staged-deleted files', () => {
    const body = TWO.slice(TWO.indexOf('@@'))
    const cases = [
      ['staged', 'diff --git a/was.txt b/f.txt\nsimilarity index 90%\nrename from was.txt\nrename to f.txt\n--- a/was.txt\n+++ b/f.txt\n'],
      ['staged', 'diff --git a/was.txt b/f.txt\ncopy from was.txt\ncopy to f.txt\n--- a/was.txt\n+++ b/f.txt\n'],
      ['unstaged', 'diff --git a/f.txt b/f.txt\nold mode 100644\nnew mode 100755\n--- a/f.txt\n+++ b/f.txt\n'],
      ['staged', 'diff --git a/f.txt b/f.txt\ndeleted file mode 100644\n--- a/f.txt\n+++ /dev/null\n'],
    ]
    for (const [area, header] of cases) {
      cleanup()
      render(<DiffPane change={change(area)} diff={loaded(header + body)} onHunk={vi.fn()} />)
      expect(screen.getAllByTestId('diff-line').length).toBeGreaterThan(0)
      expect(screen.queryByRole('button', { name: /hunk/ })).toBeNull()
    }
  })

  it('says an emptied tracked diff is no longer changed, and keeps the mode-change note for header-only diffs', () => {
    render(<DiffPane change={change('staged')} diff={loaded('')} onHunk={vi.fn()} />)
    expect(screen.getAllByRole('note').map(n => n.textContent)).toEqual(['No longer changed.'])
    cleanup()
    render(<DiffPane change={change('unstaged')} diff={loaded('diff --git a/f.txt b/f.txt\nold mode 100644\nnew mode 100755\n')} onHunk={vi.fn()} />)
    expect(screen.getAllByRole('note').map(n => n.textContent)).toEqual(['No textual changes (mode change or submodule).'])
  })

  it('shows untracked files as new with no hunk buttons', () => {
    render(<DiffPane change={change('untracked', 'n.txt')} diff={loaded('--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1 @@\n+hi\n')} onHunk={vi.fn()} />)
    expect(screen.getByText('+ new file')).toBeTruthy()
    expect(screen.queryByText(/old:/)).toBeNull()
    expect(screen.queryByRole('button', { name: /hunk/ })).toBeNull()
  })

  it('explains binary, oversized, conflicted, empty and vanished files', () => {
    const notes = (area, diff) => { cleanup(); render(<DiffPane change={change(area)} diff={diff} onHunk={vi.fn()} />); return screen.getAllByRole('note').map(n => n.textContent) }
    expect(notes('unstaged', loaded('Binary files a/f.txt and b/f.txt differ\n', { binary: true, size: 2048 }))).toEqual(['Binary file (2 KB). Stage or discard it as a whole.'])
    expect(notes('unstaged', loaded('', { truncated: true, size: 3 * 1024 * 1024 }))).toEqual(['This diff is too large to show (3.0 MB). Stage or discard the file as a whole.'])
    cleanup()
    render(<DiffPane change={change('conflict')} diff={loaded('')} onHunk={vi.fn()} />)
    expect(screen.queryAllByRole('note')).toEqual([])
    expect(notes('untracked', loaded(''))).toEqual(['Empty file.'])
    expect(notes('unstaged', loaded('', { gone: true }))).toEqual(['No longer changed.'])
    expect(screen.queryByRole('button', { name: /hunk/ })).toBeNull()
  })

  it('clicking a line calls onLine with its new line number', () => {
    const onLine = vi.fn()
    render(<DiffPane change={change('unstaged')} diff={loaded(TWO)} onHunk={vi.fn()} onLine={onLine} />)
    const rows = screen.getAllByTestId('diff-line')
    fireEvent.click(rows[1]) // deleted: no new-side line
    expect(onLine).not.toHaveBeenCalled()
    fireEvent.click(rows[0])
    fireEvent.click(rows[4])
    expect(onLine.mock.calls).toEqual([[1], [11]])
  })

  it('asks for a file when none is focused and shows load errors', () => {
    render(<DiffPane change={null} diff={{ result: null, files: [], error: null, loading: false }} onHunk={vi.fn()} />)
    expect(screen.getByText('Select a file to see its diff.')).toBeTruthy()
    cleanup()
    render(<DiffPane change={change('unstaged')} diff={{ result: null, files: [], error: 'boom', loading: false }} onHunk={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toBe('boom')
  })
})

describe('DiffPane in the history (read-only)', () => {
  const TEXT = 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+b\n'
  const change = { id: 'commit\0f', area: 'commit', path: 'f' }
  const view = result => ({ result, files: parseDiff(result.text).files, error: null, loading: false })
  it('uses the sides it is given and has no hunk buttons', () => {
    render(<DiffPane change={change} diff={view({ text: TEXT, truncated: false, binary: false, size: 10 })} sides={{ old: '1538ae7', new: 'b877e68', staging: null }} readOnly />)
    expect(screen.getByLabelText('Diff legend').textContent).toContain('− old: 1538ae7')
    expect(screen.getByLabelText('Diff legend').textContent).toContain('+ new: b877e68')
    expect(screen.queryByRole('button', { name: /hunk/ })).toBeNull()
  })
  it('words binary and large files without staging advice', () => {
    const { unmount } = render(<DiffPane change={change} diff={view({ text: '', truncated: false, binary: true, size: 2048 })} sides={{ old: 'a', new: 'b', staging: null }} readOnly />)
    expect(screen.getByText('Binary file (2 KB).')).toBeTruthy()
    unmount()
    render(<DiffPane change={change} diff={view({ text: '', truncated: true, binary: false, size: 2 * 1024 * 1024 })} sides={{ old: 'a', new: 'b', staging: null }} readOnly />)
    expect(screen.getByText('This diff is too large to show (2.0 MB).')).toBeTruthy()
  })
})
