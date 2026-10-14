import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import { commitTargets } from '@nexusmd/core'
import { CommitDialog } from './commit-dialog.jsx'

afterEach(cleanup)

const staged = path => ({ path, originalPath: null, xy: 'M.', area: 'staged', sub: 'N...', id: `staged\0${path}` })
const tree = (name, extra = {}) => ({
  repo: 'App', repoRoot: 'C:/repos/App', path: name === 'checkout' ? 'C:/repos/App' : `C:/repos/App/${name}`,
  branch: name === 'checkout' ? 'main' : name, rebasingBranch: null, operation: '', error: '', changes: [staged(`${name}.txt`)], ...extra,
})
const TREES = [tree('checkout'), tree('feature'), tree('merging', { operation: 'Merge in progress' })]
const REG = ['C:/repos/App']
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

function renderDialog({ ticked = ['C:/repos/App'], adapter: over = {}, ...props } = {}) {
  const adapter = {
    stamp: vi.fn(async (_repo, path) => `stamp:${path}`),
    commit: vi.fn(async () => ({ ok: true, detail: '[main abc] msg' })),
    ...over,
  }
  const targets = commitTargets(TREES, null).map(t => ({ ...t, ticked: ticked.includes(t.id) && !t.unavailable }))
  const handlers = { onClose: vi.fn(), onDone: vi.fn(), onRetry: vi.fn() }
  render(<CommitDialog targets={targets} adapter={adapter} registered={REG} {...handlers} {...props} />)
  return { adapter, ...handlers }
}
const commitButton = () => screen.getByRole('button', { name: 'Commit' })

describe('CommitDialog', () => {
  it('lists worktrees with staged changes and explains unavailable ones', async () => {
    renderDialog()
    expect(screen.getByLabelText('App › checkout → main').checked).toBe(true)
    expect(screen.getByLabelText('App › feature → feature').checked).toBe(false)
    expect(screen.getByLabelText('App › merging → merging').disabled).toBe(true)
    expect(screen.getByText('— Merge in progress: continue or abort it first')).toBeTruthy()
    expect(screen.getByText('Each worktree commits separately; if one fails the others are not undone.')).toBeTruthy()
  })

  it('waits for a message and the review stamps before committing', async () => {
    const { adapter } = renderDialog()
    expect(commitButton().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'Fix it' } })
    await waitFor(() => expect(commitButton().disabled).toBe(false))
    expect(adapter.stamp).toHaveBeenCalledWith({ name: 'App', path: 'C:/repos/App' }, 'C:/repos/App', REG, { kind: 'commit' })
  })

  it('commits each ticked worktree in turn with the shared message and shows per-target results', async () => {
    const { adapter, onDone } = renderDialog({
      ticked: ['C:/repos/App', 'C:/repos/App/feature'],
      adapter: { commit: vi.fn(async (_r, path) => (path.endsWith('feature') ? { ok: false, detail: 'hook says no' } : { ok: true, detail: '[main abc] Fix it' })) },
    })
    fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'Fix it' } })
    await waitFor(() => expect(commitButton().disabled).toBe(false))
    fireEvent.click(commitButton())
    const results = await screen.findByRole('list', { name: 'Commit results' })
    expect(adapter.commit.mock.calls).toEqual([
      [{ name: 'App', path: 'C:/repos/App' }, 'C:/repos/App', REG, 'Fix it', 'stamp:C:/repos/App'],
      [{ name: 'App', path: 'C:/repos/App' }, 'C:/repos/App/feature', REG, 'Fix it', 'stamp:C:/repos/App/feature'],
    ])
    expect(within(results).getByText('✓ App › checkout → main')).toBeTruthy()
    expect(within(results).getByText('✗ App › feature → feature')).toBeTruthy()
    expect(within(results).getByText('hook says no')).toBeTruthy()
    expect(onDone).toHaveBeenCalled()
  })

  it('uses a message per worktree when asked', async () => {
    const { adapter } = renderDialog({ ticked: ['C:/repos/App', 'C:/repos/App/feature'] })
    fireEvent.click(screen.getByLabelText('Message per worktree'))
    fireEvent.change(screen.getByLabelText('Message for App › checkout → main'), { target: { value: 'One' } })
    expect(commitButton().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Message for App › feature → feature'), { target: { value: 'Two' } })
    await waitFor(() => expect(commitButton().disabled).toBe(false))
    fireEvent.click(commitButton())
    await screen.findByRole('list', { name: 'Commit results' })
    expect(adapter.commit.mock.calls.map(c => c[3])).toEqual(['One', 'Two'])
  })

  it('commits once when Commit is clicked twice, and Ctrl+Enter commits too', async () => {
    const pending = deferred()
    const { adapter } = renderDialog({ adapter: { commit: vi.fn(() => pending.promise) } })
    const box = screen.getByLabelText('Commit message')
    fireEvent.change(box, { target: { value: 'Fix it' } })
    await waitFor(() => expect(commitButton().disabled).toBe(false))
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: /Commit/ }))
    await act(async () => { pending.resolve({ ok: true, detail: 'ok' }) })
    expect(adapter.commit).toHaveBeenCalledTimes(1)
  })

  it('offers Retry failed with only the failed worktrees and the messages typed so far', async () => {
    const { onRetry } = renderDialog({
      ticked: ['C:/repos/App', 'C:/repos/App/feature'],
      adapter: { commit: vi.fn(async (_r, path) => ({ ok: !path.endsWith('feature'), detail: 'x' })) },
    })
    fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'Fix it' } })
    await waitFor(() => expect(commitButton().disabled).toBe(false))
    fireEvent.click(commitButton())
    fireEvent.click(await screen.findByRole('button', { name: 'Retry failed' }))
    expect(onRetry).toHaveBeenCalledWith(['C:/repos/App/feature'], { shared: 'Fix it', perTarget: {} })
  })

  it('ignores Escape while a commit is running and then shows the results', async () => {
    const pending = deferred()
    const { onClose } = renderDialog({ adapter: { commit: vi.fn(() => pending.promise) } })
    fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'Fix it' } })
    await waitFor(() => expect(commitButton().disabled).toBe(false))
    fireEvent.click(commitButton())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => { pending.resolve({ ok: true, detail: 'ok' }) })
    expect(await screen.findByRole('list', { name: 'Commit results' })).toBeTruthy()
  })
})
