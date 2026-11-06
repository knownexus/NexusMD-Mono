import { describe, it, expect } from 'vitest'
import { importIntoWorkspace } from './open-in-editor.js'

const workspace = (seed = {}) => {
  const files = new Map(Object.entries(seed))
  return { files, fs: { exists: async (p) => files.has(p), read: async (p) => files.get(p), write: async (p, t) => { files.set(p, t) } } }
}

describe('importIntoWorkspace', () => {
  it('puts the file in the workspace under its own name and returns where', async () => {
    const w = workspace()
    expect(await importIntoWorkspace(w, { name: 'todo.txt', text: 'one\ntwo' })).toBe('/editor/todo.txt')
    expect(w.files.get('/editor/todo.txt')).toBe('one\ntwo')
  })

  it('keeps the text exactly as it came (line endings and a byte order mark are the Editor\'s to read)', async () => {
    const w = workspace()
    await importIntoWorkspace(w, { name: 'a.csv', text: '﻿a,b\r\n1,2\r\n' })
    expect(w.files.get('/editor/a.csv')).toBe('﻿a,b\r\n1,2\r\n')
  })

  it('opening the same file again opens the copy that is there, not a second one', async () => {
    const w = workspace({ '/editor/todo.txt': 'one' })
    expect(await importIntoWorkspace(w, { name: 'todo.txt', text: 'one' })).toBe('/editor/todo.txt')
    expect(w.files.size).toBe(1)
  })

  it('never writes over a different file of that name (it may hold edits made in the Editor): it numbers the new one', async () => {
    const w = workspace({ '/editor/todo.txt': 'edited here', '/editor/todo (2).txt': 'another' })
    expect(await importIntoWorkspace(w, { name: 'todo.txt', text: 'from the phone' })).toBe('/editor/todo (3).txt')
    expect(w.files.get('/editor/todo.txt')).toBe('edited here')
    expect(w.files.get('/editor/todo (3).txt')).toBe('from the phone')
  })

  it('numbers a name with no extension, and a dotfile, sensibly', async () => {
    const w = workspace({ '/editor/Makefile': 'x', '/editor/.env': 'y' })
    expect(await importIntoWorkspace(w, { name: 'Makefile', text: 'z' })).toBe('/editor/Makefile (2)')
    expect(await importIntoWorkspace(w, { name: '.env', text: 'w' })).toBe('/editor/.env (2)')
  })

  it('cannot be sent out of the workspace by a file name, and names a file that has no name', async () => {
    const w = workspace()
    expect(await importIntoWorkspace(w, { name: '../../x/evil.txt', text: 'a' })).toBe('/editor/.._.._x_evil.txt')
    expect(await importIntoWorkspace(w, { name: '', text: 'b' })).toBe('/editor/Untitled.txt')
  })

  it('refuses a file that is not text, or too large, without writing anything', async () => {
    const w = workspace()
    await expect(importIntoWorkspace(w, { name: 'a.bin', text: 'ab\0cd' })).rejects.toThrow(/Only text files/)
    await expect(importIntoWorkspace(w, { name: 'big.txt', text: 'x'.repeat(2 * 1024 * 1024 + 1) })).rejects.toThrow(/too large/)
    expect(w.files.size).toBe(0)
  })
})
