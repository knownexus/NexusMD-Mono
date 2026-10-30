import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSafApi, createEditorApi } from './editor-saf.js'
import { createEditorStore } from '@nexusmd/app-editor/editor-store'

// A stand-in for SafFolderPlugin: one granted folder, held in memory.
function fakePlugin(files = {}) {
  const dirs = new Set([''])
  Object.keys(files).forEach(p => p.split('/').slice(0, -1).reduce((acc, seg) => { const d = acc ? `${acc}/${seg}` : seg; dirs.add(d); return d }, ''))
  return {
    files,
    pickFolder: vi.fn(async () => ({ uri: 'content://tree/1', name: 'Notes' })),
    stat: async ({ path }) => files[path] != null ? { exists: true, kind: 'file', size: files[path].length }
      : dirs.has(path) ? { exists: true, kind: 'dir', size: 0 } : { exists: false, kind: null, size: 0 },
    list: async ({ path }) => ({
      entries: [...new Set(Object.keys(files).filter(f => f.startsWith(path ? `${path}/` : '')).map(f => f.slice(path ? path.length + 1 : 0).split('/')[0]))]
        .map(name => ({ name, kind: dirs.has(path ? `${path}/${name}` : name) ? 'dir' : 'file', size: 1 })),
    }),
    readText: async ({ path }) => files[path] == null ? { missing: true } : { text: files[path] },
    writeText: async ({ path, text }) => { files[path] = text },
  }
}

describe('SAF editor api', () => {
  let plugin, saf
  beforeEach(() => {
    localStorage.clear()
    plugin = fakePlugin({ 'a.txt': 'hello', 'sub/b.md': '# b' })
    saf = createSafApi({ plugin, storage: localStorage })
  })

  it('registers a picked folder once and returns its editor path', async () => {
    expect(await saf.pickFolder()).toBe('/saf/Notes')
    expect(await saf.pickFolder()).toBe('/saf/Notes')
    plugin.pickFolder.mockResolvedValueOnce({ uri: 'content://tree/2', name: 'Notes' })
    expect(await saf.pickFolder()).toBe('/saf/Notes (2)')
  })

  it('treats a cancelled pick as nothing', async () => {
    plugin.pickFolder.mockResolvedValueOnce({ cancelled: true })
    expect(await saf.pickFolder()).toBeNull()
  })

  it('lists folders first, reads and saves in place', async () => {
    const root = await saf.pickFolder()
    expect((await saf.list(root)).entries.map(e => e.name)).toEqual(['sub', 'a.txt'])
    const r = await saf.read(`${root}/a.txt`)
    expect(r.text).toBe('hello')
    expect((await saf.write(`${root}/a.txt`, 'bye', { expectedStamp: r.stamp })).ok).toBe(true)
    expect(plugin.files['a.txt']).toBe('bye')
  })

  it('reports a conflict when the file changed since the read', async () => {
    const root = await saf.pickFolder()
    const r = await saf.read(`${root}/a.txt`)
    plugin.files['a.txt'] = 'changed elsewhere'
    expect((await saf.write(`${root}/a.txt`, 'mine', { expectedStamp: r.stamp })).conflict).toBe(true)
    expect(plugin.files['a.txt']).toBe('changed elsewhere')
  })

  it('creates a file that does not exist yet', async () => {
    const root = await saf.pickFolder()
    expect((await saf.write(`${root}/sub/new.txt`, 'x')).ok).toBe(true)
    expect(plugin.files['sub/new.txt']).toBe('x')
  })

  it('errors for a folder it no longer has', async () => {
    await expect(saf.list('/saf/Gone')).rejects.toThrow(/no longer available/)
  })

  it('routes only /saf paths to the folders and works under the editor store', async () => {
    const workspace = { read: vi.fn(), stat: vi.fn(), write: vi.fn(), list: vi.fn() }
    const api = createEditorApi({ workspace, saf })
    const root = await saf.pickFolder()
    const store = createEditorStore({ api })
    expect(await store.openPath(`${root}/a.txt`)).toBe(true)
    expect(store.getState().docs[0].text).toBe('hello')
    expect(workspace.read).not.toHaveBeenCalled()
    await api.stat('/editor/x')
    expect(workspace.stat).toHaveBeenCalledWith('/editor/x')
  })
})
