import { describe, it, expect, beforeEach } from 'vitest'
import { createVirtualFs } from './api-file.js'
import { createEditorWorkspace } from './editor-workspace.js'
import { createEditorStore } from '@nexusmd/app-editor/editor-store'

describe('editor workspace', () => {
  let ws
  beforeEach(() => { localStorage.clear(); ws = createEditorWorkspace(createVirtualFs(localStorage, 'test:')) })

  it('imports, stats, lists and reads a file', async () => {
    const p = await ws.importFile('a.txt', 'hello')
    expect(p).toBe('/editor/a.txt')
    expect(await ws.stat(p)).toEqual({ exists: true, kind: 'file', size: 5 })
    expect((await ws.list('/editor')).entries).toEqual([{ name: 'a.txt', kind: 'file', size: 5 }])
    const r = await ws.read(p)
    expect(r.text).toBe('hello')
    expect(r.bom).toBe(false)
  })

  it('saves, and reports a conflict when the file changed since the read', async () => {
    const p = await ws.importFile('a.txt', 'one')
    const { stamp } = await ws.read(p)
    expect((await ws.write(p, 'two', { expectedStamp: stamp })).ok).toBe(true)
    expect((await ws.write(p, 'three', { expectedStamp: stamp })).conflict).toBe(true)
    expect((await ws.write(p, 'three', { expectedStamp: stamp, overwrite: true })).ok).toBe(true)
  })

  it('keeps a BOM across a read and a save', async () => {
    const p = await ws.importFile('b.txt', '\uFEFFx')
    const r = await ws.read(p)
    expect(r).toMatchObject({ text: 'x', bom: true })
    await ws.write(p, 'y', { expectedStamp: r.stamp, bom: true })
    expect((await ws.fs.read(p))).toBe('\uFEFFy')
  })

  it('works under the shared editor store', async () => {
    const store = createEditorStore({ api: ws })
    await store.openPath(await ws.importFile('c.md', 'a\r\nb'))
    const doc = store.getState().docs[0]
    expect(doc.status).toBe('ready')
    expect(doc.eol).toBe('\r\n')
    store.setText(doc.path, 'a\nc')
    expect(await store.save(doc.path)).toBe(true)
    expect(await ws.fs.read(doc.path)).toBe('a\r\nc')
  })
})
