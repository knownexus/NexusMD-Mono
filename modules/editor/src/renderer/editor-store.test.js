import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createEditorStore, majorityEol, ipcMessage, baseName, isDirty } from './editor-store.js'

// A tiny disk: path -> { text, bom }, with stamps that change whenever the text does.
function fakeApi(initial = {}) {
  const disk = new Map(Object.entries(initial).map(([p, v]) => [p, typeof v === 'string' ? { text: v, bom: false } : v]))
  const stamp = f => `s:${f.text}:${f.bom}`
  const api = {
    disk,
    stat: vi.fn(async p => (disk.has(p) ? { exists: true, kind: 'file', size: 1 } : p.endsWith('/dir') ? { exists: true, kind: 'dir', size: 0 } : { exists: false })),
    read: vi.fn(async p => (disk.has(p) ? { path: p, text: disk.get(p).text, bom: disk.get(p).bom, stamp: stamp(disk.get(p)) } : { missing: true })),
    write: vi.fn(async (p, text, { expectedStamp, overwrite, bom }) => {
      const cur = disk.get(p)
      if (cur && !overwrite && stamp(cur) !== expectedStamp) return { ok: false, conflict: true }
      if (!cur && expectedStamp != null && !overwrite) return { ok: false, missing: true }
      disk.set(p, { text, bom })
      return { ok: true, stamp: stamp(disk.get(p)) }
    }),
  }
  return api
}
const memoryStorage = () => { const m = new Map(); return { get: k => m.get(k) ?? null, set: (k, v) => m.set(k, v), m } }

describe('helpers', () => {
  it('majorityEol follows the lines, and the first line on a tie', () => {
    expect(majorityEol('a\r\nb\r\nc\n')).toBe('\r\n')
    expect(majorityEol('a\nb\nc\r\n')).toBe('\n')
    expect(majorityEol('a\r\nb\n')).toBe('\r\n')
    expect(majorityEol('one line')).toBe('\n')
  })
  it('ipcMessage drops the Electron wrapper', () => {
    expect(ipcMessage(new Error("Error invoking remote method 'editor:read': Error: x.bin isn't a text file."))).toBe("x.bin isn't a text file.")
    expect(ipcMessage('plain')).toBe('plain')
  })
  it('baseName works for either slash', () => {
    expect(baseName('C:\\a\\b.txt')).toBe('b.txt')
    expect(baseName('/a/b/')).toBe('b')
  })
})

describe('opening files', () => {
  let api, store
  beforeEach(() => { api = fakeApi({ '/a.txt': 'alpha', '/b.txt': 'beta' }); store = createEditorStore({ api }) })

  it('opens a file in a tab and makes it the active one', async () => {
    await store.openFile('/a.txt')
    const s = store.getState()
    expect(s.active).toBe('/a.txt')
    expect(s.docs).toHaveLength(1)
    expect(s.docs[0]).toMatchObject({ name: 'a.txt', status: 'ready', text: 'alpha', saved: 'alpha' })
  })
  it('shows a tab straight away, while the file is still being read', async () => {
    let release
    api.read.mockImplementationOnce(() => new Promise(r => { release = () => r({ path: '/a.txt', text: 'x', bom: false, stamp: 's' }) }))
    const opening = store.openFile('/a.txt')
    expect(store.getState().docs[0].status).toBe('loading')
    release(); await opening
    expect(store.getState().docs[0].status).toBe('ready')
  })
  it('opens the same file once, however often it is asked for', async () => {
    await store.openFile('/a.txt'); await store.openFile('/b.txt'); await store.openFile('/a.txt')
    expect(store.getState().docs).toHaveLength(2)
    expect(store.getState().active).toBe('/a.txt')
    expect(api.read).toHaveBeenCalledTimes(2)
  })
  it('jumps to a line, and jumps again when asked for the same line again', async () => {
    await store.openFile('/a.txt', { line: 3 })
    const first = store.getState().docs[0].line
    expect(first).toEqual({ line: 3 })
    await store.openFile('/a.txt', { line: 3 })
    const second = store.getState().docs[0].line
    expect(second).toEqual({ line: 3 })
    expect(second).not.toBe(first)
  })
  it('keeps what the file says about its line endings and BOM, and edits as LF', async () => {
    api.disk.set('/crlf.txt', { text: 'a\r\nb\r\n', bom: true })
    await store.openFile('/crlf.txt')
    expect(store.getState().docs[0]).toMatchObject({ text: 'a\nb\n', eol: '\r\n', bom: true })
  })
  it('says so for a file that is gone or cannot be read', async () => {
    await store.openFile('/gone.txt')
    expect(store.getState().docs[0]).toMatchObject({ status: 'error', error: 'gone.txt no longer exists.' })
    api.read.mockRejectedValueOnce(new Error("Error invoking remote method 'editor:read': Error: big.log is too large to edit here (9000 KB)."))
    await store.openFile('/big.log')
    expect(store.getState().docs[1]).toMatchObject({ status: 'error', error: 'big.log is too large to edit here (9000 KB).' })
  })
})

describe('openPath', () => {
  let api, store
  beforeEach(() => { api = fakeApi({ '/a.txt': 'alpha' }); store = createEditorStore({ api }) })

  it('opens a file, or a folder as the tree root', async () => {
    expect(await store.openPath('/a.txt', { line: 2 })).toBe(true)
    expect(store.getState().docs[0].path).toBe('/a.txt')
    expect(await store.openPath('/some/dir')).toBe(true)
    expect(store.getState().folder).toBe('/some/dir')
  })
  it('reports something that does not exist, without opening anything', async () => {
    expect(await store.openPath('/nope.txt')).toBe(false)
    expect(store.getState().docs).toEqual([])
    expect(store.getState().notice).toMatch(/doesn't exist/)
    store.dismissNotice()
    expect(store.getState().notice).toBeNull()
  })
  it('reports a path the main process refuses', async () => {
    api.stat.mockRejectedValueOnce(new Error("Error invoking remote method 'editor:stat': Error: Only full paths can be opened."))
    expect(await store.openPath('relative.txt')).toBe(false)
    expect(store.getState().notice).toBe('Only full paths can be opened.')
  })
})

describe('editing and saving', () => {
  let api, store
  beforeEach(async () => { api = fakeApi({ '/a.txt': 'alpha\r\nbeta\r\n' }); store = createEditorStore({ api }); await store.openFile('/a.txt') })
  const doc = () => store.getState().docs[0]

  it('tracks unsaved edits per file', () => {
    expect(isDirty(doc())).toBe(false)
    store.setText('/a.txt', 'alpha\nBETA\n')
    expect(isDirty(doc())).toBe(true)
    store.setText('/a.txt', 'alpha\nbeta\n')
    expect(isDirty(doc())).toBe(false)
  })
  it('saves with the original line endings and the stamp of the read', async () => {
    store.setText('/a.txt', 'alpha\nBETA\n')
    const stamp = doc().stamp
    expect(await store.save('/a.txt')).toBe(true)
    expect(api.write).toHaveBeenCalledWith('/a.txt', 'alpha\r\nBETA\r\n', { expectedStamp: stamp, overwrite: false, bom: false })
    expect(isDirty(doc())).toBe(false)
    expect(doc().stamp).not.toBe(stamp)
  })
  it('lets a second save follow the first, using the new stamp', async () => {
    store.setText('/a.txt', 'one\n'); await store.save('/a.txt')
    store.setText('/a.txt', 'two\n')
    expect(await store.save('/a.txt')).toBe(true)
    expect(api.disk.get('/a.txt').text).toBe('two\r\n')
  })
  it('keeps text typed while a save was in flight as unsaved', async () => {
    let release
    api.write.mockImplementationOnce(async (p, text) => { await new Promise(r => { release = r }); api.disk.set(p, { text, bom: false }); return { ok: true, stamp: 'new' } })
    store.setText('/a.txt', 'first\n')
    const saving = store.save('/a.txt')
    store.setText('/a.txt', 'first\nsecond\n')
    release(); await saving
    expect(doc().saved).toBe('first\n')
    expect(isDirty(doc())).toBe(true)
  })
  it('does not start a second save while one is running', async () => {
    let release
    api.write.mockImplementationOnce(() => new Promise(r => { release = () => r({ ok: true, stamp: 'n' }) }))
    store.setText('/a.txt', 'x\n')
    const first = store.save('/a.txt')
    expect(await store.save('/a.txt')).toBe(false)
    release(); await first
    expect(api.write).toHaveBeenCalledTimes(1)
  })
  it('reports a file changed on disk as a conflict, keeping the edits', async () => {
    api.disk.set('/a.txt', { text: 'changed elsewhere', bom: false })
    store.setText('/a.txt', 'mine\n')
    expect(await store.save('/a.txt')).toBe(false)
    expect(doc()).toMatchObject({ conflict: true, text: 'mine\n', saving: false })
    expect(api.disk.get('/a.txt').text).toBe('changed elsewhere')
  })
  it('overwrites on request after a conflict', async () => {
    api.disk.set('/a.txt', { text: 'changed elsewhere', bom: false })
    store.setText('/a.txt', 'mine\n')
    await store.save('/a.txt')
    expect(await store.save('/a.txt', { overwrite: true })).toBe(true)
    expect(doc().conflict).toBe(false)
    expect(api.disk.get('/a.txt').text).toBe('mine\r\n')
  })
  it('reload throws the edits away and reads the file again', async () => {
    api.disk.set('/a.txt', { text: 'changed elsewhere', bom: false })
    store.setText('/a.txt', 'mine\n')
    await store.save('/a.txt')
    await store.reload('/a.txt')
    expect(doc()).toMatchObject({ text: 'changed elsewhere', saved: 'changed elsewhere', conflict: false })
  })
  it('lets a save recreate a file deleted since it was read', async () => {
    api.disk.delete('/a.txt')
    store.setText('/a.txt', 'back\n')
    expect(await store.save('/a.txt')).toBe(false)
    expect(doc().error).toMatch(/no longer exists/)
    expect(await store.save('/a.txt')).toBe(true)
    expect(api.disk.get('/a.txt').text).toBe('back\r\n')
  })
  it('shows a failed save and stays editable', async () => {
    api.write.mockRejectedValueOnce(new Error("Error invoking remote method 'editor:write': Error: EACCES"))
    store.setText('/a.txt', 'x\n')
    expect(await store.save('/a.txt')).toBe(false)
    expect(doc()).toMatchObject({ error: 'EACCES', saving: false })
    expect(isDirty(doc())).toBe(true)
  })
})

describe('tabs', () => {
  it('closing the active tab moves to its neighbour, and closing the last leaves none', async () => {
    const store = createEditorStore({ api: fakeApi({ '/a': 'a', '/b': 'b', '/c': 'c' }) })
    for (const p of ['/a', '/b', '/c']) await store.openFile(p)
    store.activate('/b'); store.close('/b')
    expect(store.getState().active).toBe('/c')
    store.close('/c')
    expect(store.getState().active).toBe('/a')
    store.close('/a')
    expect(store.getState()).toMatchObject({ docs: [], active: null })
  })
  it('closing a background tab keeps the active one', async () => {
    const store = createEditorStore({ api: fakeApi({ '/a': 'a', '/b': 'b' }) })
    await store.openFile('/a'); await store.openFile('/b')
    store.close('/a')
    expect(store.getState().active).toBe('/b')
  })
  it('a read that finishes after its tab was closed changes nothing', async () => {
    const api = fakeApi({ '/a': 'a' })
    let release
    api.read.mockImplementationOnce(() => new Promise(r => { release = () => r({ path: '/a', text: 'late', bom: false, stamp: 's' }) }))
    const store = createEditorStore({ api })
    const opening = store.openFile('/a')
    store.close('/a')
    release(); await opening
    expect(store.getState().docs).toEqual([])
  })
})

describe('recent files and folders', () => {
  it('remembers what was opened, newest first, without repeats, up to a limit', async () => {
    const storage = memoryStorage()
    const files = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`/f${i}`, 'x']))
    const store = createEditorStore({ api: fakeApi(files), storage })
    for (let i = 0; i < 15; i++) await store.openFile(`/f${i}`)
    await store.openFile('/f3')
    store.openFolder('/some/dir'); store.openFolder('/other'); store.openFolder('/some/dir')
    const { recent } = store.getState()
    expect(recent.files).toHaveLength(12)
    expect(recent.files[0]).toBe('/f14')
    expect(recent.folders).toEqual(['/some/dir', '/other'])
  })
  it('carries them over to the next session', async () => {
    const storage = memoryStorage()
    const first = createEditorStore({ api: fakeApi({ '/a': 'a' }), storage })
    await first.openFile('/a'); first.openFolder('/d')
    const second = createEditorStore({ api: fakeApi(), storage })
    expect(second.getState().recent).toEqual({ files: ['/a'], folders: ['/d'] })
  })
  it('starts empty when the saved list is unreadable or storage is missing', () => {
    expect(createEditorStore({ api: fakeApi(), storage: { get: () => '{oops', set() {} } }).getState().recent).toEqual({ files: [], folders: [] })
    expect(createEditorStore({ api: fakeApi() }).getState().recent).toEqual({ files: [], folders: [] })
  })
  it('does not fail when storage refuses to save', async () => {
    const store = createEditorStore({ api: fakeApi({ '/a': 'a' }), storage: { get: () => null, set() { throw new Error('quota') } } })
    await expect(store.openFile('/a')).resolves.toBeUndefined()
    expect(store.getState().recent.files).toEqual(['/a'])
  })
})

describe('subscribing', () => {
  it('tells listeners about each change until they unsubscribe', async () => {
    const store = createEditorStore({ api: fakeApi({ '/a': 'a' }) })
    const fn = vi.fn()
    const off = store.subscribe(fn)
    await store.openFile('/a')
    expect(fn).toHaveBeenCalled()
    fn.mockClear(); off()
    store.setText('/a', 'changed')
    expect(fn).not.toHaveBeenCalled()
  })
})
