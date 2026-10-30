import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@nexusmd/core', async (orig) => ({ ...(await orig()), getGithubFile: vi.fn() }))
import { getGithubFile } from '@nexusmd/core'
import { githubFileActions, githubBlobUrl, localTreeFor } from './github-open.js'

afterEach(() => vi.clearAllMocks())
const hostWith = provided => {
  const calls = []
  return { calls, host: { capabilities: { has: n => provided.includes(n), call: (...a) => { calls.push(a); return true } } } }
}
const LOCAL = [{ path: 'C:\\repos\\web', branch: 'main', main: true }, { path: 'C:\\repos\\web\\feat', branch: 'feat', main: false }]
const labels = actions => actions.map(a => a.label)

describe('githubFileActions', () => {
  it('opens the local copy from disk, in the worktree on the branch being browsed', () => {
    const { host, calls } = hostWith(['editor.openPath', 'editor.openText'])
    const actions = githubFileActions({ host, client: {}, repo: 'acme/web', branch: 'feat', local: LOCAL })('src/a.js')
    expect(labels(actions)).toEqual(['Open in Editor', 'Open on GitHub'])
    actions[0].onSelect()
    expect(calls).toEqual([['editor.openPath', 'C:\\repos\\web\\feat\\src\\a.js']])
  })

  it('names the branch when the local copy is on another one', () => {
    const { host } = hostWith(['editor.openPath'])
    const [first] = githubFileActions({ host, client: {}, repo: 'acme/web', branch: 'release', local: LOCAL })('a.js')
    expect(first.label).toBe('Open local copy (main)')
    expect(first.title).toBe('Your local copy is on main, not release: C:\\repos\\web')
  })

  it('opens the GitHub version read-only when there is no local copy', async () => {
    getGithubFile.mockResolvedValue({ text: 'hello', reason: null, url: 'u' })
    const { host, calls } = hostWith(['editor.openPath', 'editor.openText'])
    const client = {}
    const [first] = githubFileActions({ host, client, repo: 'acme/web', branch: 'main' })('src/a.js')
    expect(first.label).toBe('Open in Editor')
    await first.onSelect()
    expect(getGithubFile).toHaveBeenCalledWith(client, 'acme/web', { path: 'src/a.js', ref: 'main' })
    expect(calls).toEqual([['editor.openText', { id: 'github:acme/web@main:src/a.js', name: 'a.js', text: 'hello', origin: 'acme/web on GitHub, main: src/a.js' }]])
  })

  it('sends a file it cannot show as text to GitHub instead', async () => {
    getGithubFile.mockResolvedValue({ text: null, reason: 'binary', url: 'https://github.com/acme/web/blob/main/x.png' })
    const openUrl = vi.fn()
    const { host, calls } = hostWith(['editor.openText'])
    await githubFileActions({ host, client: {}, repo: 'acme/web', branch: 'main', openUrl })('x.png')[0].onSelect()
    expect(openUrl).toHaveBeenCalledWith('https://github.com/acme/web/blob/main/x.png')
    expect(calls).toEqual([])
  })

  it('offers only Open on GitHub without the Editor app, or with an Editor too old for read-only text', () => {
    const openUrl = vi.fn()
    expect(labels(githubFileActions({ host: null, client: {}, repo: 'acme/web', branch: 'main', openUrl })('a.js'))).toEqual(['Open on GitHub'])
    const actions = githubFileActions({ host: hostWith(['editor.openPath']).host, client: {}, repo: 'acme/web', branch: 'feature/x', openUrl })('docs/read me.md')
    expect(labels(actions)).toEqual(['Open on GitHub'])
    actions[0].onSelect()
    expect(openUrl).toHaveBeenCalledWith('https://github.com/acme/web/blob/feature/x/docs/read%20me.md')
  })
})

describe('helpers', () => {
  it('githubBlobUrl keeps the slashes of a branch and a path', () => {
    expect(githubBlobUrl('a/b', 'feat/one', 'src/x#1.js')).toBe('https://github.com/a/b/blob/feat/one/src/x%231.js')
  })
  it('localTreeFor prefers the branch, then the main worktree', () => {
    expect(localTreeFor(LOCAL, 'feat').path).toBe('C:\\repos\\web\\feat')
    expect(localTreeFor(LOCAL, 'other').path).toBe('C:\\repos\\web')
    expect(localTreeFor([], 'x')).toBeNull()
  })
})
