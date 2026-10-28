import { describe, it, expect } from 'vitest'
import { popoutSpec, parsePopoutHash } from './popout-spec.js'

const repo = { name: 'A', path: 'C:/repos/A', extra: 'dropped' }
const registered = ['C:/repos/A']

describe('popoutSpec', () => {
  it('names the screen, the file and the worktree, copying only what the window needs', () => {
    const spec = popoutSpec('editor', { repo, worktree: 'C:/repos/A', registered, path: 'src/app.jsx' })
    expect(spec).toEqual({ kind: 'editor', repo: { name: 'A', path: 'C:/repos/A' }, worktree: 'C:/repos/A', registered, path: 'src/app.jsx' })
    expect(spec.registered).not.toBe(registered)
  })
  it('carries the change id for a diff only', () => {
    const change = { id: 'unstaged:src/app.jsx', path: 'src/app.jsx' }
    expect(popoutSpec('diff', { repo, worktree: 'w', registered, path: change.path, change }).changeId).toBe(change.id)
    expect(popoutSpec('conflict', { repo, worktree: 'w', registered, path: change.path, change })).not.toHaveProperty('changeId')
  })
  it('carries the change itself for a diff, with only the status fields', () => {
    const change = { id: 'unstaged\0new.txt', area: 'unstaged', path: 'new.txt', originalPath: 'old.txt', xy: '.R', sub: 'N...', extra: {}, originalPathX: null }
    expect(popoutSpec('diff', { repo, worktree: 'w', registered, path: change.path, change }).change)
      .toEqual({ id: 'unstaged\0new.txt', area: 'unstaged', path: 'new.txt', originalPath: 'old.txt', xy: '.R', sub: 'N...' })
    const plain = { id: 'untracked\0a.txt', area: 'untracked', path: 'a.txt', originalPath: null }
    expect(popoutSpec('diff', { repo, worktree: 'w', registered, path: plain.path, change: plain }).change)
      .toEqual({ id: 'untracked\0a.txt', area: 'untracked', path: 'a.txt' })
    expect(popoutSpec('conflict', { repo, worktree: 'w', registered, path: plain.path, change: plain })).not.toHaveProperty('change')
  })
})

describe('parsePopoutHash', () => {
  const spec = popoutSpec('conflict', { repo, worktree: 'C:/repos/A', registered, path: 'a b/ü.txt' })
  const hash = `#popout=${encodeURIComponent(JSON.stringify(spec))}`
  it('reads back what main put in the URL, with or without the #', () => {
    expect(parsePopoutHash(hash)).toEqual(spec)
    expect(parsePopoutHash(hash.slice(1))).toEqual(spec)
  })
  it('is null for the app itself and for anything malformed', () => {
    for (const h of ['', '#', '#/dashboard', '#popout=', '#popout=%7Bnot-json', `#popout=${encodeURIComponent('{"kind":"shell"}')}`,
      `#popout=${encodeURIComponent(JSON.stringify({ ...spec, registered: 'x' }))}`]) {
      expect(parsePopoutHash(h)).toBeNull()
    }
    expect(parsePopoutHash(undefined)).toBeNull()
  })
})
