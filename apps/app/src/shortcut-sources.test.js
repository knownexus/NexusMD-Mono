import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@capacitor/core', async orig => ({ ...(await orig()), CapacitorHttp: undefined }))
const git = vi.hoisted(() => ({
  repos: [
    { id: '7', name: 'api', project: 'Core', provider: 'ado' },
    { id: 'gh:acme/web', name: 'web', project: 'acme', fullName: 'acme/web', provider: 'github' },
  ],
  listRepoFolder: vi.fn(async () => [{ name: 'src', path: '/src', isFolder: true }]),
}))
vi.mock('./git-view.jsx', () => ({
  listRepoChoices: async () => ({ repos: git.repos, errors: [] }),
  listRepoFolder: git.listRepoFolder,
}))

import { targetSources } from './shortcut-sources.js'
import { editorWorkspace } from './adapters/editor-workspace.js'
import { readTarget } from '@nexusmd/core'

const source = id => targetSources.find(s => s.id === id)

beforeEach(() => { localStorage.clear() })

describe('the phone’s shortcut sources', () => {
  it('offers repositories, both kinds of document, and the Editor', () => {
    expect(targetSources.map(s => s.id)).toEqual(['git', 'doc-markdown', 'doc-json', 'editor'])
    for (const s of targetSources) expect(s.label && s.desc && s.icon, s.id).toBeTruthy()
  })

  describe('repositories', () => {
    it('lists every connected repository by name and owner', async () => {
      const roots = await source('git').roots()
      expect(roots.map(r => [r.title, r.sub])).toEqual([['api', 'Core'], ['web', 'acme']])
    })
    it('browses a repository through its default branch', async () => {
      const root = (await source('git').roots())[0]
      expect(await source('git').list(root, '/src')).toEqual([{ name: 'src', path: '/src', isFolder: true }])
      expect(git.listRepoFolder).toHaveBeenCalledWith(root.repo, '/src')
    })
    it('names the repository by who owns it, and a file as a file, a folder (or the repository itself) as a folder', async () => {
      const [api, web] = await source('git').roots()
      expect(source('git').toTarget(api, { name: 'a.js', path: '/src/a.js', isFolder: false })).toEqual({
        target: 'git', kind: 'file', path: '/src/a.js', repo: { provider: 'ado', name: 'api', project: 'Core' },
      })
      expect(source('git').toTarget(web, { name: 'src', path: '/src', isFolder: true })).toMatchObject({
        kind: 'folder', path: '/src', repo: { provider: 'github', name: 'web', fullName: 'acme/web', project: 'acme' },
      })
      expect(source('git').toTarget(web, null)).toMatchObject({ kind: 'folder', path: '/' })
    })
    it('makes targets that are usable shortcuts', async () => {
      const [api] = await source('git').roots()
      expect(readTarget(source('git').toTarget(api, { name: 'a.js', path: '/a.js', isFolder: false }))).not.toBeNull()
    })
  })

  describe('documents', () => {
    beforeEach(() => {
      localStorage.setItem('md_documents', JSON.stringify({ docs: [
        { id: 'old', name: null, autoName: 'Old notes', updatedAt: 1 },
        { id: 'new', name: 'Plan', autoName: 'Plan', updatedAt: Date.now() - 60_000 },
      ] }))
      localStorage.setItem('json_editor_documents', JSON.stringify([{ id: 'j1', name: null, autoName: 'cfg', updatedAt: Date.now() }]))
    })
    it('lists a tool’s saved documents, the newest first, with when they changed', async () => {
      const roots = await source('doc-markdown').roots()
      expect(roots.map(r => r.title)).toEqual(['Plan', 'Old notes'])
      expect(roots[0].sub).toMatch(/ago|just now/)
      expect((await source('doc-json').roots()).map(r => r.title)).toEqual(['cfg'])
    })
    it('picks a document in its own tool, with no folders to browse', async () => {
      expect(source('doc-markdown').list).toBeUndefined()
      const [plan] = await source('doc-markdown').roots()
      expect(source('doc-markdown').toTarget(plan)).toEqual({ target: 'doc', tool: 'markdown', docId: 'new', name: 'Plan' })
      const [cfg] = await source('doc-json').roots()
      expect(source('doc-json').toTarget(cfg)).toMatchObject({ tool: 'json', docId: 'j1' })
    })
    it('says nothing is saved yet when it is empty', async () => {
      localStorage.clear()
      expect(await source('doc-json').roots()).toEqual([])
      expect(source('doc-json').empty).toMatch(/No saved documents/)
    })
  })

  describe('the Editor workspace', () => {
    beforeEach(async () => {
      await editorWorkspace.write('/editor/top.md', 'x', { overwrite: true })
      await editorWorkspace.write('/editor/notes/a.md', 'x', { overwrite: true })
      await editorWorkspace.write('/editor/notes/deep/b.md', 'x', { overwrite: true })
    })
    it('offers the workspace as the one place to browse', async () => {
      expect(await source('editor').roots()).toEqual([{ id: '/editor', title: 'Workspace' }])
    })
    it('lists a folder by its path inside the workspace, folders and files', async () => {
      const root = (await source('editor').roots())[0]
      const top = await source('editor').list(root, '/')
      expect(top).toEqual(expect.arrayContaining([
        { name: 'top.md', path: '/top.md', isFolder: false }, { name: 'notes', path: '/notes', isFolder: true },
      ]))
      expect(await source('editor').list(root, '/notes')).toEqual(expect.arrayContaining([
        { name: 'a.md', path: '/notes/a.md', isFolder: false }, { name: 'deep', path: '/notes/deep', isFolder: true },
      ]))
    })
    it('makes targets with the real workspace path, marked as made on the phone', async () => {
      const root = (await source('editor').roots())[0]
      expect(source('editor').toTarget(root, { name: 'a.md', path: '/notes/a.md', isFolder: false })).toEqual({
        target: 'editor', kind: 'file', path: '/editor/notes/a.md', name: 'a.md', platform: 'mobile',
      })
      expect(source('editor').toTarget(root, { name: 'notes', path: '/notes', isFolder: true })).toMatchObject({ kind: 'folder', path: '/editor/notes' })
      expect(source('editor').toTarget(root, { name: '', path: '/', isFolder: true })).toMatchObject({ kind: 'folder', path: '/editor', name: 'Workspace' })
    })
  })
})
