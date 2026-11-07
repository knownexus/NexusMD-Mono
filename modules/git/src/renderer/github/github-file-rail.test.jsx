import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { GithubFileRail } from './github-file-rail.jsx'

afterEach(cleanup)
const commits = [{ sha: 'a'.repeat(40), subject: 'Fix it', date: new Date(Date.now() - 3600 * 1000).toISOString() }]
const props = (over = {}) => ({
  branch: 'main', path: 'src/a.js', prs: [], commits, primary: { label: 'Open in Editor', onSelect: vi.fn() }, onOpenGithub: vi.fn(), onCopyPermalink: vi.fn(), onViewPrs: vi.fn(), ...over,
})
const show = over => { const p = props(over); render(<GithubFileRail {...p} />); return p }

describe('GithubFileRail', () => {
  it('names the file with its folder and the branch it is on', () => {
    show()
    expect(screen.getByText('a.js').className).toContain('nx-gw-rail-file')
    expect(screen.getByText('src · on main')).toBeTruthy()
  })

  it('shows an open pull request that changes the file, with its lines, and a link to the pull requests', () => {
    const p = show({ prs: [{ number: 7, title: 'Add search', add: 3, del: 1 }] })
    expect(screen.getByText('Open pull request')).toBeTruthy()
    expect(screen.getByText('#7 Add search')).toBeTruthy()
    expect(screen.getByText('+3')).toBeTruthy()
    expect(screen.getByText('−1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'View in Pull requests' }))
    expect(p.onViewPrs).toHaveBeenCalledTimes(1)
  })

  it('has no pull request card when none touch the file', () => {
    show()
    expect(screen.queryByText('Open pull request')).toBeNull()
  })

  it('lists the history on the branch, loading, and empty', () => {
    show()
    expect(screen.getByText('History on main')).toBeTruthy()
    expect(screen.getByText('Fix it')).toBeTruthy()
    expect(screen.getByText('aaaaaaa')).toBeTruthy()
    cleanup()
    show({ commits: null })
    expect(screen.getByText('Loading…')).toBeTruthy()
    cleanup()
    show({ commits: [] })
    expect(screen.getByText('No commits yet.')).toBeTruthy()
  })

  it('has the editor action first, then Open on GitHub and Copy permalink', () => {
    const p = show()
    fireEvent.click(screen.getByRole('button', { name: 'Open in Editor' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open on GitHub' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy permalink' }))
    expect(p.primary.onSelect).toHaveBeenCalledTimes(1)
    expect(p.onOpenGithub).toHaveBeenCalledTimes(1)
    expect(p.onCopyPermalink).toHaveBeenCalledTimes(1)
  })

  it('has no editor button when there is no editor action', () => {
    show({ primary: null })
    expect(screen.queryByRole('button', { name: 'Open in Editor' })).toBeNull()
  })
})
