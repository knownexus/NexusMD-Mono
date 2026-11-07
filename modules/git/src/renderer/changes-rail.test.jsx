import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ChangesRail, railLabel } from './changes-rail.jsx'

afterEach(cleanup)

const tree = (over = {}) => ({ path: '/r/feat', branch: 'feat', upstream: 'origin/feat', upstreamGone: false, ahead: 0, operation: '', operationInfo: null, changes: [{ area: 'staged' }, { area: 'unstaged' }], ...over })
const commit = (over = {}) => ({ oid: 'abcdef0123456789', subject: 'Fix the thing', when: Date.now() - 2 * 3600 * 1000, pushed: true, files: 3, add: 12, del: 4, merge: false, ...over })
const rail = (t, last = { loading: false, commit: commit(), commits: [] }, props = {}) => render(
  <ChangesRail tree={t} busy={false} onCommit={() => {}} onOperation={() => {}} lastCommit={last} onAmendMessage={() => {}} onShowInHistory={() => {}} {...props} />,
)

describe('ChangesRail', () => {
  it('shows the commit form while there is something to commit', () => {
    rail(tree())
    expect(screen.getByLabelText('Commit summary')).toBeTruthy()
    expect(screen.queryByText('Last commit')).toBeNull()
  })

  it('shows the last commit once the tree is clean', () => {
    rail(tree({ changes: [] }))
    expect(screen.getByText('Last commit')).toBeTruthy()
    expect(screen.getByText('Fix the thing')).toBeTruthy()
    expect(screen.getByText('abcdef0').className).toContain('nx-hash')
    expect(screen.getByText(/2 hours ago · pushed/)).toBeTruthy()
    expect(screen.getByText('3 files')).toBeTruthy()
    expect(screen.getByText('+12')).toBeTruthy()
    expect(screen.getByText('−4')).toBeTruthy()
    expect(screen.queryByLabelText('Commit summary')).toBeNull()
  })

  it('says not pushed for a commit that is only here', () => {
    rail(tree({ changes: [] }), { loading: false, commit: commit({ pushed: false }), commits: [] })
    expect(screen.getByText(/not pushed/)).toBeTruthy()
  })

  it('View in History opens the commit; Amend message… edits it while it is unpushed', () => {
    const onShowInHistory = vi.fn()
    const onAmendMessage = vi.fn()
    rail(tree({ changes: [] }), { loading: false, commit: commit({ pushed: false }), commits: [] }, { onShowInHistory, onAmendMessage })
    fireEvent.click(screen.getByRole('button', { name: 'View in History' }))
    expect(onShowInHistory).toHaveBeenCalledWith({ oid: 'abcdef0123456789' })
    fireEvent.click(screen.getByRole('button', { name: 'Amend message…' }))
    expect(onAmendMessage).toHaveBeenCalled()
  })

  it('disables Amend message… for a pushed commit and for a merge, with the reason', () => {
    rail(tree({ changes: [] }))
    expect(screen.getByRole('button', { name: 'Amend message…' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Amend message…' }).title).toBe('Already pushed')
    cleanup()
    rail(tree({ changes: [] }), { loading: false, commit: commit({ pushed: false, merge: true }), commits: [] })
    expect(screen.getByRole('button', { name: 'Amend message…' }).title).toBe("Merge commits can't be reworded here")
  })

  it('says so while the last commit loads and for a repository with no commits', () => {
    rail(tree({ changes: [] }), { loading: true, commit: null, commits: [] })
    expect(screen.getByText('Loading…')).toBeTruthy()
    cleanup()
    rail(tree({ changes: [] }), { loading: false, commit: null, commits: [] })
    expect(screen.getByText('No commits yet.')).toBeTruthy()
  })

  it('shows the operation instead while one is paused, and hands its buttons to onOperation', () => {
    const onOperation = vi.fn()
    rail(tree({ operation: 'Rebase in progress', operationInfo: { kind: 'rebase', step: 1, total: 2 }, changes: [] }), undefined, { onOperation })
    expect(screen.queryByLabelText('Commit summary')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(onOperation).toHaveBeenCalledWith('skip', {})
  })
})

describe('railLabel', () => {
  it('names the strip: the staged count, the last commit, or the operation position', () => {
    expect(railLabel(tree())).toBe('Commit · 1 staged')
    expect(railLabel(tree({ changes: [{ area: 'unstaged' }] }))).toBe('Commit · 0 staged')
    expect(railLabel(tree({ changes: [] }))).toBe('Last commit')
    expect(railLabel(tree({ operation: 'Rebase in progress', operationInfo: { kind: 'rebase', step: 3, total: 7 } }))).toBe('Rebase 3 of 7')
  })
})
