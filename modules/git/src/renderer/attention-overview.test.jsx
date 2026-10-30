import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { AttentionOverview } from './attention-overview.jsx'

afterEach(cleanup)

const tree = over => ({ repo: 'R', repoRoot: 'C:/r', path: 'C:/r', branch: 'feat', upstream: null, upstreamGone: false, ahead: 0, behind: 0, operation: '', error: '', changes: [], ...over })
const show = t => render(<AttentionOverview trees={[t]} repoCount={1} onOpen={() => {}} onAction={() => {}} />)

describe('AttentionOverview not published card', () => {
  it('prefixes the commits off the source', () => {
    show(tree({ source: { ref: 'refs/heads/master', count: 3 } }))
    expect(screen.getByText('3 commits off master · Only exists on this machine')).toBeTruthy()
  })
  it('says to push again when the branch on origin was deleted', () => {
    show(tree({ upstream: 'origin/feat', upstreamGone: true }))
    expect(screen.getByText('Its branch on origin was deleted — push it again or delete it locally')).toBeTruthy()
  })
  it('is unchanged without commits off the source', () => {
    show(tree({ source: { ref: 'refs/heads/master', count: 0 } }))
    expect(screen.getByText('Only exists on this machine')).toBeTruthy()
  })
})

describe('AttentionOverview row More menu', () => {
  const linked = over => tree({ path: 'C:/r/feat', upstream: 'origin/feat', ahead: 2, ...over })
  const menu = (t, onAction = vi.fn()) => {
    render(<AttentionOverview trees={[t]} repoCount={1} onOpen={() => {}} onAction={onAction} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'More for feat' })[0])
    return { onAction, item: name => screen.getByRole('menuitem', { name }) }
  }

  it('offers Reset to remote and Delete branch on a linked worktree with an upstream', () => {
    const t = linked()
    const { onAction, item } = menu(t)
    fireEvent.click(item('Reset to remote…'))
    expect(onAction).toHaveBeenLastCalledWith('resetUpstream', t)
    fireEvent.click(screen.getAllByRole('button', { name: 'More for feat' })[0])
    fireEvent.click(item('Delete branch…'))
    expect(onAction).toHaveBeenLastCalledWith('branchDelete', t)
  })

  it("won't delete the main folder's branch", () => {
    const { item } = menu(tree({ upstream: 'origin/feat', ahead: 1 }))
    expect(item('Delete branch…').disabled).toBe(true)
    expect(item('Delete branch…').title).toBe("It's checked out in the repository's main folder")
    expect(item('Reset to remote…').disabled).toBe(false)
  })

  it("won't reset a branch without a branch on the remote", () => {
    expect(menu(linked({ upstream: null })).item('Reset to remote…').title).toBe('It has no branch on the remote')
    cleanup()
    expect(menu(linked({ upstreamGone: true })).item('Reset to remote…').title).toBe('Its branch on the remote was deleted')
  })

  it('offers neither during a rebase or merge', () => {
    const { item } = menu(linked({ operation: 'Rebase in progress' }))
    for (const name of ['Reset to remote…', 'Delete branch…']) {
      expect(item(name).disabled).toBe(true)
      expect(item(name).title).toBe('Finish or abort the Rebase in progress first')
    }
  })
})
