import { describe, it, expect, vi } from 'vitest'
import { absolutePath, openElsewhere } from './open-elsewhere.js'

describe('absolutePath', () => {
  it('joins in the worktree\'s own style', () => {
    expect(absolutePath('C:\\repos\\A', 'docs/guide.md')).toBe('C:\\repos\\A\\docs\\guide.md')
    expect(absolutePath('C:\\repos\\A\\', 'README.md')).toBe('C:\\repos\\A\\README.md')
    expect(absolutePath('/home/me/A', 'docs/guide.md')).toBe('/home/me/A/docs/guide.md')
    expect(absolutePath('C:/repos/A/', 'docs/guide.md')).toBe('C:/repos/A/docs/guide.md')
  })
})

describe('openElsewhere', () => {
  const adapter = { openExternal: vi.fn() }
  const repo = { name: 'A', path: 'C:/repos/A' }
  it('is the Editor when it offers editor.openPath', () => {
    const host = { capabilities: { has: n => n === 'editor.openPath', call: vi.fn() } }
    const o = openElsewhere({ host, adapter, repo, worktreePath: 'C:/repos/A', registered: [] })
    expect(o.label).toBe('Open in Editor')
    o.run('a.md')
    expect(host.capabilities.call).toHaveBeenCalledWith('editor.openPath', 'C:/repos/A/a.md')
  })
  it('is the default app otherwise', () => {
    for (const host of [null, undefined, {}, { capabilities: { has: () => false } }]) {
      const o = openElsewhere({ host, adapter, repo, worktreePath: 'C:/repos/A', registered: ['x'] })
      expect(o.label).toBe('Open with default app')
    }
    openElsewhere({ host: null, adapter, repo, worktreePath: 'C:/repos/A', registered: ['x'] }).run('a.md')
    expect(adapter.openExternal).toHaveBeenCalledWith(repo, 'C:/repos/A', ['x'], 'a.md')
  })
})
