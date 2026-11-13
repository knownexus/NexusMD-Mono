import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { savedDocs, resolveTarget, openTarget, takeTarget } from './shortcut-host.js'

beforeEach(() => { localStorage.clear() })
afterEach(() => { window.NexusMDNav = null; vi.restoreAllMocks() })

const git = (repo) => ({ target: 'git', kind: 'file', path: '/a', repo })

describe('resolveTarget on the phone', () => {
  it('opens a GitHub or Azure DevOps repository', () => {
    expect(resolveTarget(git({ provider: 'github', name: 'n', fullName: 'o/n' })).ok).toBe(true)
    expect(resolveTarget(git({ provider: 'ado', name: 'n', project: 'p' })).ok).toBe(true)
  })
  it('opens a desktop clone whose remote is on GitHub or Azure DevOps', () => {
    expect(resolveTarget(git({ provider: 'local', name: 'n', remote: 'github.com/o/n' })).ok).toBe(true)
    expect(resolveTarget(git({ provider: 'local', name: 'n', remote: 'dev.azure.com/org/p/n' })).ok).toBe(true)
  })
  it('greys out a clone with no remote, or one the phone cannot browse', () => {
    expect(resolveTarget(git({ provider: 'local', name: 'n' })).ok).toBe(false)
    expect(resolveTarget(git({ provider: 'local', name: 'n', remote: 'gitlab.com/o/n' })).ok).toBe(false)
  })
  it('checks a document is still saved, in its own tool', () => {
    localStorage.setItem('md_documents', JSON.stringify({ docs: [{ id: 'm1' }] }))
    localStorage.setItem('json_editor_documents', JSON.stringify([{ id: 'j1' }]))
    expect(resolveTarget({ target: 'doc', tool: 'markdown', docId: 'm1' }).ok).toBe(true)
    expect(resolveTarget({ target: 'doc', tool: 'json', docId: 'j1' }).ok).toBe(true)
    expect(resolveTarget({ target: 'doc', tool: 'json', docId: 'm1' }).ok).toBe(false)
  })
  it('opens an editor path made on the phone, not one made on desktop', () => {
    expect(resolveTarget({ target: 'editor', kind: 'file', path: '/editor/a.md', platform: 'mobile' }).ok).toBe(true)
    expect(resolveTarget({ target: 'editor', kind: 'file', path: 'C:\a.md', platform: 'desktop' }).ok).toBe(false)
  })
})

describe('savedDocs', () => {
  it('reads both layouts of the Markdown store, and survives bad data', () => {
    localStorage.setItem('md_documents', JSON.stringify({ docs: [{ id: 'a' }, null, { name: 'no id' }] }))
    expect(savedDocs().markdown).toEqual([{ id: 'a' }])
    localStorage.setItem('json_editor_documents', '{not json')
    expect(savedDocs().json).toEqual([])
  })
})

describe('openTarget and takeTarget', () => {
  it('asks the app to go to the page the target lives on, carrying the target', () => {
    const seen = []
    const h = (e) => seen.push(e.detail)
    window.addEventListener('helm:navigate', h)
    openTarget({ target: 'doc', tool: 'json', docId: 'd' })
    openTarget({ target: 'git', kind: 'file', path: '/a', repo: { name: 'n' } })
    openTarget({ target: 'editor', path: '/x' })
    openTarget({ target: 'nope' })
    window.removeEventListener('helm:navigate', h)
    expect(seen.map(d => d.view)).toEqual(['markdown', 'git', 'editor'])
    expect(seen[0].target.docId).toBe('d')
  })
  it('hands a target over once, and only to the screen it is for', () => {
    window.NexusMDNav = { view: 'git', target: { target: 'git', path: '/a' } }
    expect(takeTarget('editor')).toBeNull()
    expect(window.NexusMDNav.target).not.toBeNull()
    expect(takeTarget('git')).toEqual({ target: 'git', path: '/a' })
    expect(takeTarget('git')).toBeNull()
    expect(window.NexusMDNav.view).toBe('git')
  })
})
