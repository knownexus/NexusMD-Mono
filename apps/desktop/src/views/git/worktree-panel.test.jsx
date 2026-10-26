import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { WorktreePanel } from './worktree-panel.jsx'
import { historyCache } from './history-cache.js'

afterEach(cleanup)
beforeEach(() => {
  localStorage.clear()
  for (const k of ['details', 'files', 'diffs', 'pages']) historyCache[k].clear()
})

const oid = n => String(n).repeat(40)
const rec = (n, subject) => `* \x1e${oid(n)}\x1f\x1fAna\x1fa@b\x1f1\x1f\x1f${subject}`
const tree = (path, head, count = 3) => ({
  path, repo: 'A', repoRoot: 'C:/repos/A', branch: 'feat', head, upstream: null, ahead: 0, behind: 0, operation: '', changes: [],
  source: { ref: 'refs/heads/main', count },
})

function adapterWith(state) {
  return {
    log: vi.fn(async (_r, _c, _g, q) => ({ text: state.log, tip: oid(3), unpushed: [], truncated: false, limit: q.limit })),
    commitDetails: vi.fn(async (_r, _c, _g, o) => ({ details: [o, '', 'Ana', 'a@b', 'd', 'Ana', 'a@b', 'd', '', 'msg'].join('\0') })),
    commitFiles: vi.fn(async () => ({ files: '' })),
    commitDiff: vi.fn(async () => ({ text: '', truncated: false, binary: false, size: 0 })),
    diff: vi.fn(async () => ({ text: '', stamp: 's', truncated: false, binary: false, size: 0 })),
    refs: vi.fn(async () => ({ refs: `refs/heads/main\0${oid(1)}\0\0 \n`, originHead: null, shallow: false })),
  }
}

function Harness({ adapter, t }) {
  const [panel, setPanel] = React.useState('changes')
  return (
    <WorktreePanel adapter={adapter} repo={{ name: 'A', path: 'C:/repos/A' }} registered={['C:/repos/A']} version={1} tree={t}
      selected={[]} onSelectionChange={() => {}} focusId={null} onFocus={() => {}} onAction={() => {}} onWrite={() => {}} onCommit={() => {}} onHunk={() => {}}
      busy={false} status={null} split={0.5} onSplit={() => {}} panel={panel} onPanel={setPanel} onSync={() => {}} />
  )
}

const selectedOid = () => document.querySelector('[role=option][aria-selected="true"]')?.getAttribute('data-oid')
const backToHistory = () => {
  fireEvent.click(screen.getByRole('tab', { name: /^Changes/ }))
  fireEvent.click(screen.getByRole('tab', { name: 'History' }))
}

describe('WorktreePanel own commits', () => {
  it('doesn\'t say the previous commit is on the source while the strip is still loading', async () => {
    const withParent = (n, subject) => rec(n, subject).replace('\x1f\x1fAna', `\x1f${oid(n - 1)}\x1fAna`)
    const adapter = {
      ...adapterWith({ log: '' }),
      log: vi.fn((_r, _c, _g, q) => (q.filter === 'sinceBase' ? new Promise(() => {}) : Promise.resolve({
        text: [withParent(3, 'three'), withParent(2, 'two'), withParent(1, 'one')].join('\n') + '\n', tip: oid(3), unpushed: [oid(3), oid(2), oid(1)], truncated: false, limit: q.limit,
      }))),
    }
    render(<Harness adapter={adapter} t={tree('C:/repos/A', oid(3))} />)
    fireEvent.click(screen.getByRole('tab', { name: 'History' }))
    await screen.findByText('three', { selector: '[role=option] span' })
    fireEvent.contextMenu(document.querySelector(`[data-oid="${oid(3)}"]`))
    const squash = screen.getByRole('menuitem', { name: 'Squash into previous…' })
    expect(squash.title).not.toMatch(/previous commit is on/)
    expect(squash.disabled).toBe(false)
  })
})

describe('WorktreePanel strip requests', () => {
  it('applies a strip click once: back from Changes, History starts at the top, even after a reword', async () => {
    const state = { log: [rec(3, 'three'), rec(2, 'two'), rec(1, 'one')].join('\n') + '\n' }
    const adapter = adapterWith(state)
    const { rerender } = render(<Harness adapter={adapter} t={tree('C:/repos/A', oid(3))} />)
    fireEvent.click(await screen.findByText('two'))
    await waitFor(() => expect(selectedOid()).toBe(oid(2)))
    // two is reworded: its old oid is gone, and three is rewritten on top of it.
    state.log = [rec(6, 'three'), rec(5, 'two, better'), rec(1, 'one')].join('\n') + '\n'
    rerender(<Harness adapter={adapter} t={tree('C:/repos/A', oid(6))} />)
    backToHistory()
    await screen.findByText('two, better', { selector: '[role=option] span' })
    await waitFor(() => expect(selectedOid()).toBe(oid(6)))
  })

  it('doesn\'t carry a request over to another worktree', async () => {
    const state = { log: [rec(3, 'three'), rec(2, 'two'), rec(1, 'one')].join('\n') + '\n' }
    const adapter = adapterWith(state)
    const { rerender } = render(<Harness adapter={adapter} t={tree('C:/repos/A', oid(3), 5)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show all in History' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Since' }).getAttribute('aria-pressed')).toBe('true'))
    fireEvent.click(screen.getByRole('tab', { name: /^Changes/ }))
    rerender(<Harness adapter={adapter} t={tree('C:/repos/B', oid(3), 5)} />)
    fireEvent.click(screen.getByRole('tab', { name: 'History' }))
    await screen.findByText('three', { selector: '[role=option] span' })
    expect(screen.getByRole('button', { name: 'Since' }).getAttribute('aria-pressed')).toBe('false')
    await waitFor(() => expect(selectedOid()).toBe(oid(3)))
  })
})
