import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@nexusmd/shell-sdk', async importOriginal => ({ ...(await importOriginal()), getProfileKey: k => `p1:${k}` }))

import { createTargetSources } from './shortcut-sources.js'
import { readTarget } from '@nexusmd/core'

function memStorage() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }
}

const REPOS = [
  { name: 'nexus-checkout', path: 'C:/repos/nexus-checkout', provider: 'local', remote: 'github.com/knownexus/nexus' },
  { name: 'scratch', path: 'C:/repos/scratch', provider: 'local', remote: '' },
]
const FILES = ['README.md', 'src/app.js', 'src/lib/a.js']

function caps(provided = ['git.listRepos', 'git.listFiles', 'documents.openDoc', 'editor.openPath']) {
  const call = vi.fn(async (name, ...args) => {
    if (name === 'git.listRepos') return REPOS
    if (name === 'git.listFiles') { if (args[0] === 'C:/repos/broken') throw new Error('No such repository.'); return { files: FILES, truncated: false } }
    return true
  })
  return { has: n => provided.includes(n), call }
}
const ids = sources => sources.map(s => s.id)
const make = (over = {}) => createTargetSources({ caps: caps(), picker: { pickFile: vi.fn(), pickDirectory: vi.fn() }, storage: memStorage(), ...over })
const by = (sources, id) => sources.find(s => s.id === id)

beforeEach(() => vi.clearAllMocks())

describe('the desktop Dashboard’s shortcut sources', () => {
  it('offers each kind only when the app behind it is installed', () => {
    expect(ids(make())).toEqual(['git', 'doc-markdown', 'doc-json', 'editor'])
    expect(ids(make({ caps: caps(['git.listRepos', 'git.listFiles']) }))).toEqual(['git'])
    expect(ids(make({ caps: caps(['git.listRepos']) }))).toEqual([])
    expect(ids(make({ caps: caps(['documents.openDoc']) }))).toEqual(['doc-markdown', 'doc-json'])
    expect(ids(make({ caps: caps(['editor.openPath']) }))).toEqual(['editor'])
    expect(ids(make({ caps: caps(['editor.openPath']), picker: null }))).toEqual([])
    expect(ids(createTargetSources({}))).toEqual([])
  })

  describe('repositories', () => {
    it('lists the registered repositories, naming each by its remote where it has one', async () => {
      const roots = await by(make(), 'git').roots()
      expect(roots.map(r => [r.title, r.sub])).toEqual([['nexus-checkout', 'knownexus/nexus'], ['scratch', 'C:/repos/scratch']])
    })
    it('browses a repository folder by folder, from one listing of its files', async () => {
      const c = caps()
      const git = by(make({ caps: c }), 'git')
      const root = (await git.roots())[0]
      expect((await git.list(root, '/')).map(e => e.name)).toEqual(['src', 'README.md'])
      expect((await git.list(root, '/src')).map(e => e.name)).toEqual(['lib', 'app.js'])
      expect((await git.list(root, '/src/lib')).map(e => e.name)).toEqual(['a.js'])
      expect(c.call.mock.calls.filter(x => x[0] === 'git.listFiles')).toHaveLength(1)
    })
    it('asks again after a while, and again after a failure', async () => {
      let t = 1000
      const c = caps()
      const git = by(createTargetSources({ caps: c, storage: memStorage(), now: () => t }), 'git')
      const root = { id: 'C:/repos/nexus-checkout', repo: REPOS[0] }
      await git.list(root, '/')
      t += 31_000
      await git.list(root, '/')
      expect(c.call.mock.calls.filter(x => x[0] === 'git.listFiles')).toHaveLength(2)
      const broken = { id: 'C:/repos/broken', repo: REPOS[1] }
      await expect(git.list(broken, '/')).rejects.toThrow('No such repository.')
      await expect(git.list(broken, '/')).rejects.toThrow('No such repository.')
      expect(c.call.mock.calls.filter(x => x[0] === 'git.listFiles' && x[1] === 'C:/repos/broken')).toHaveLength(2)
    })
    it('names a clone of a GitHub repository by owner and name, whatever the folder is called', async () => {
      const git = by(make(), 'git')
      const root = (await git.roots())[0]
      const t = git.toTarget(root, { name: 'app.js', path: '/src/app.js', isFolder: false })
      expect(t).toEqual({
        target: 'git', kind: 'file', path: '/src/app.js',
        repo: { provider: 'github', name: 'nexus', fullName: 'knownexus/nexus', remote: 'github.com/knownexus/nexus' },
      })
      expect(readTarget(t)).not.toBeNull()
    })
    it('names a clone with no remote by its folder, and the repository itself as its top folder', async () => {
      const git = by(make(), 'git')
      const scratch = (await git.roots())[1]
      expect(git.toTarget(scratch, null)).toEqual({ target: 'git', kind: 'folder', path: '/', repo: { provider: 'local', name: 'scratch' } })
    })
  })

  describe('documents', () => {
    it('lists the saved documents of each tool in the profile’s own store, the newest first', async () => {
      const storage = memStorage()
      storage.setItem('p1:md_documents', JSON.stringify({ docs: [{ id: 'a', name: null, autoName: 'Old', updatedAt: 1 }, { id: 'b', name: 'Plan', autoName: 'Plan', updatedAt: Date.now() }] }))
      storage.setItem('p1:json_editor_documents', JSON.stringify([{ id: 'j', name: null, autoName: 'cfg', updatedAt: Date.now() }]))
      const sources = make({ storage })
      expect((await by(sources, 'doc-markdown').roots()).map(r => r.title)).toEqual(['Plan', 'Old'])
      expect((await by(sources, 'doc-json').roots()).map(r => r.title)).toEqual(['cfg'])
    })
    it('picks a document in its own tool, with nothing to browse', async () => {
      const storage = memStorage()
      storage.setItem('p1:json_editor_documents', JSON.stringify([{ id: 'j', autoName: 'cfg', updatedAt: 5 }]))
      const json = by(make({ storage }), 'doc-json')
      expect(json.list).toBeUndefined()
      expect(json.toTarget((await json.roots())[0])).toEqual({ target: 'doc', tool: 'json', docId: 'j', name: 'cfg' })
    })
    it('says nothing is saved yet', async () => {
      const md = by(make(), 'doc-markdown')
      expect(await md.roots()).toEqual([])
      expect(md.empty).toMatch(/No saved documents/)
    })
  })

  describe('the Editor', () => {
    it('offers to choose a file or a folder from this computer', async () => {
      expect((await by(make(), 'editor').roots()).map(r => r.id)).toEqual(['file', 'folder'])
    })
    it('picks a file with the file dialog, marked as made on desktop', async () => {
      const picker = { pickFile: vi.fn(async () => ({ path: 'C:\\notes\\todo.md', name: 'todo.md' })), pickDirectory: vi.fn() }
      const editor = by(make({ picker }), 'editor')
      const t = await editor.toTarget({ id: 'file' })
      expect(picker.pickFile).toHaveBeenCalledWith({ pathOnly: true })
      expect(t).toMatchObject({ target: 'editor', kind: 'file', name: 'todo.md', platform: 'desktop' })
      expect(t.path).toMatch(/todo\.md$/)
      expect(readTarget(t)).not.toBeNull()
    })
    it('picks a folder with the folder dialog', async () => {
      const picker = { pickFile: vi.fn(), pickDirectory: vi.fn(async () => 'C:/work/notes') }
      expect(await by(make({ picker }), 'editor').toTarget({ id: 'folder' })).toEqual({
        target: 'editor', kind: 'folder', path: 'C:/work/notes', name: 'notes', platform: 'desktop',
      })
    })
    it('gives nothing when the dialog is cancelled', async () => {
      const picker = { pickFile: vi.fn(async () => null), pickDirectory: vi.fn(async () => null) }
      const editor = by(make({ picker }), 'editor')
      expect(await editor.toTarget({ id: 'file' })).toBeNull()
      expect(await editor.toTarget({ id: 'folder' })).toBeNull()
    })
  })
})
