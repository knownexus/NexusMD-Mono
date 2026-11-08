import { describe, it, expect, vi } from 'vitest'
import { watchOpenedFiles } from './opened-file.js'

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), docs: () => JSON.parse(m.get('md_documents') || '{"docs":[]}').docs } }
const fakePlugin = (files) => {
  let handler = null
  return {
    take: vi.fn(async () => files.shift() ?? {}),
    addListener: vi.fn(async (name, fn) => { if (name === 'fileOpened') handler = fn; return { remove: vi.fn() } }),
    fire: () => handler?.({}),
  }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('watchOpenedFiles', () => {
  it('opens a file the app was started with', async () => {
    const plugin = fakePlugin([{ name: 'notes.md', text: '# Hi' }])
    const storage = memory(); const onOpen = vi.fn()
    watchOpenedFiles({ plugin, storage, onOpen, onError: vi.fn() })
    await tick(); await tick()
    expect(storage.docs()).toHaveLength(1)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen.mock.calls[0][0]).toMatchObject({ created: true, name: 'notes' })
  })

  it('opens a file that arrives while the app is running', async () => {
    const files = []; const plugin = fakePlugin(files)
    const storage = memory(); const onOpen = vi.fn()
    watchOpenedFiles({ plugin, storage, onOpen, onError: vi.fn() })
    await tick()
    expect(onOpen).not.toHaveBeenCalled()
    files.push({ name: 'later.md', text: 'body' })
    plugin.fire(); await tick(); await tick()
    expect(storage.docs().map(d => d.name)).toEqual(['later'])
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('does nothing when no file is waiting', async () => {
    const plugin = fakePlugin([]); const onOpen = vi.fn(); const onError = vi.fn()
    watchOpenedFiles({ plugin, storage: memory(), onOpen, onError })
    await tick(); await tick()
    expect(onOpen).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled()
  })

  it('says what went wrong when the file could not be read, and when it could not be saved', async () => {
    const plugin = fakePlugin([{ error: 'That file is too large to open here (the limit is 2 MB).' }, { name: 'a.md', text: 'x' }])
    const storage = memory(); storage.setItem = () => { throw new Error('full') }
    const onError = vi.fn(); const onOpen = vi.fn()
    watchOpenedFiles({ plugin, storage, onOpen, onError })
    await tick(); await tick()
    plugin.fire(); await tick(); await tick()
    expect(onError.mock.calls.map(c => c[0])).toEqual([
      'That file is too large to open here (the limit is 2 MB).',
      'This file could not be saved: the browser storage is full.',
    ])
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('opens two files that arrive together one after the other, not at once', async () => {
    const files = [{ name: 'one.md', text: '1' }, { name: 'two.md', text: '2' }]
    const plugin = fakePlugin(files); const storage = memory()
    watchOpenedFiles({ plugin, storage, onOpen: vi.fn(), onError: vi.fn() })
    plugin.fire(); await tick(); await tick(); await tick()
    expect(storage.docs().map(d => d.name).sort()).toEqual(['one', 'two'])
  })

  it('does nothing off the phone (no plugin), and stops listening when told to', async () => {
    expect(watchOpenedFiles({ plugin: null, storage: memory(), onOpen: vi.fn(), onError: vi.fn() })).toBeTypeOf('function')
    const remove = vi.fn()
    const plugin = { take: async () => ({}), addListener: async () => ({ remove }) }
    const stop = watchOpenedFiles({ plugin, storage: memory(), onOpen: vi.fn(), onError: vi.fn() })
    await tick(); stop(); await tick()
    expect(remove).toHaveBeenCalled()
  })

  it('uses the storage key it is given', async () => {
    const plugin = fakePlugin([{ name: 'k.md', text: 'x' }]); const m = new Map()
    const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }
    watchOpenedFiles({ plugin, storage, storageKey: 'helm.p1.md_documents', onOpen: vi.fn(), onError: vi.fn() })
    await tick(); await tick()
    expect([...m.keys()]).toEqual(['helm.p1.md_documents'])
  })
})

describe('watchOpenedFiles: where a file goes', () => {
  const workspaceOf = () => { const files = new Map(); return { files, fs: { exists: async (p) => files.has(p), read: async (p) => files.get(p), write: async (p, t) => { files.set(p, t) } } } }

  it('a Markdown file goes to the documents', async () => {
    const plugin = fakePlugin([{ name: 'notes.md', text: '# Hi', type: 'text/markdown' }])
    const storage = memory(); const workspace = workspaceOf(); const onOpen = vi.fn()
    watchOpenedFiles({ plugin, storage, workspace, onOpen, onError: vi.fn() })
    await tick(); await tick()
    expect(onOpen.mock.calls[0][0]).toMatchObject({ target: 'documents', tool: 'markdown', name: 'notes' })
    expect(storage.docs()).toHaveLength(1)
    expect(workspace.files.size).toBe(0)
  })

  it('a JSON file goes to the JSON editor documents, not the Editor', async () => {
    const plugin = fakePlugin([{ name: 'config.json', text: '{"a":1}', type: 'application/json' }])
    const storage = memory(); const workspace = workspaceOf(); const onOpen = vi.fn()
    watchOpenedFiles({ plugin, storage, workspace, onOpen, onError: vi.fn() })
    await tick(); await tick(); await tick()
    expect(onOpen.mock.calls[0][0]).toMatchObject({ target: 'documents', tool: 'json', name: 'config', created: true })
    expect(JSON.parse(storage.getItem('json_editor_documents'))).toHaveLength(1)
    expect(storage.docs()).toEqual([])
    expect(workspace.files.size).toBe(0)
  })

  it('a broken JSON file still goes to the JSON editor', async () => {
    const plugin = fakePlugin([{ name: 'bad.json', text: '{ "a": ', type: 'application/json' }])
    const storage = memory(); const onOpen = vi.fn(); const onError = vi.fn()
    watchOpenedFiles({ plugin, storage, workspace: workspaceOf(), onOpen, onError })
    await tick(); await tick(); await tick()
    expect(onOpen.mock.calls[0][0]).toMatchObject({ target: 'documents', tool: 'json' })
    expect(onError).not.toHaveBeenCalled()
  })

  it('a .JSON file routes to JSON', async () => {
    const plugin = fakePlugin([{ name: 'DATA.JSON', text: '[]', type: 'application/octet-stream' }])
    const onOpen = vi.fn()
    watchOpenedFiles({ plugin, storage: memory(), workspace: workspaceOf(), onOpen, onError: vi.fn() })
    await tick(); await tick(); await tick()
    expect(onOpen.mock.calls[0][0]).toMatchObject({ target: 'documents', tool: 'json' })
  })

  it('uses the JSON storage key it is given', async () => {
    const plugin = fakePlugin([{ name: 'k.json', text: '{}' }]); const m = new Map()
    const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }
    watchOpenedFiles({ plugin, storage, jsonStorageKey: 'helm.p1.json_editor_documents', workspace: workspaceOf(), onOpen: vi.fn(), onError: vi.fn() })
    await tick(); await tick(); await tick()
    expect([...m.keys()]).toEqual(['helm.p1.json_editor_documents'])
  })

  it('any other text file goes to the Editor, in the workspace, and is not made a document', async () => {
    const plugin = fakePlugin([{ name: 'config.yaml', text: 'a: 1', type: 'text/plain' }])
    const storage = memory(); const workspace = workspaceOf(); const onOpen = vi.fn()
    watchOpenedFiles({ plugin, storage, workspace, onOpen, onError: vi.fn() })
    await tick(); await tick(); await tick()
    expect(onOpen.mock.calls[0][0]).toEqual({ target: 'editor', path: '/editor/config.yaml', name: 'config.yaml' })
    expect(workspace.files.get('/editor/config.yaml')).toBe('a: 1')
    expect(storage.docs()).toEqual([])
  })

  it('a .txt file goes to the Editor too, even when it was sent as text/plain', async () => {
    const plugin = fakePlugin([{ name: 'todo.txt', text: 'a', type: 'text/plain' }])
    const workspace = workspaceOf(); const onOpen = vi.fn()
    watchOpenedFiles({ plugin, storage: memory(), workspace, onOpen, onError: vi.fn() })
    await tick(); await tick(); await tick()
    expect(onOpen.mock.calls[0][0].target).toBe('editor')
  })

  it('says why when a file cannot be put in the Editor\'s workspace', async () => {
    const plugin = fakePlugin([{ name: 'a.bin', text: 'a\0b', type: 'text/plain' }])
    const onError = vi.fn(); const onOpen = vi.fn()
    watchOpenedFiles({ plugin, storage: memory(), workspace: workspaceOf(), onOpen, onError })
    await tick(); await tick(); await tick()
    expect(onError).toHaveBeenCalledWith('Only text files can be opened.')
    expect(onOpen).not.toHaveBeenCalled()
  })
})
