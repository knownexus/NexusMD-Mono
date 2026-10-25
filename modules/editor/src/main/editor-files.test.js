// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const files = require('./editor-files.cjs')
const { checkPath, stat, read, write, list, pathsFromArgv, MAX_READ_BYTES } = files

let dir
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-editor-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })
const at = (...p) => path.join(dir, ...p)

describe('checkPath', () => {
  it('accepts a full path and normalises it', () => {
    expect(checkPath(at('a', '..', 'b.txt'))).toBe(at('b.txt'))
  })
  it.each([
    ['nothing', undefined],
    ['blank', '   '],
    ['a relative path', 'notes/todo.txt'],
    ['a NUL byte', () => at('a\0b')],
  ])('refuses %s', (_name, p) => {
    expect(() => checkPath(typeof p === 'function' ? p() : p)).toThrow()
  })
  it('refuses raw device paths', () => {
    expect(() => checkPath('\\\\.\\PhysicalDrive0')).toThrow(/Device/)
    expect(() => checkPath('\\\\?\\C:\\x')).toThrow(/Device/)
  })
})

describe('stat', () => {
  it('says what a path is', async () => {
    fs.writeFileSync(at('f.txt'), 'hello')
    expect(await stat(at('f.txt'))).toEqual({ exists: true, kind: 'file', size: 5 })
    expect(await stat(dir)).toMatchObject({ exists: true, kind: 'dir' })
    expect(await stat(at('nope'))).toEqual({ exists: false, kind: null, size: 0 })
  })
})

describe('read', () => {
  it('returns the text, whether it had a BOM, and a stamp of the bytes', async () => {
    fs.writeFileSync(at('a.txt'), '\ufeffhello\r\nworld')
    const r = await read(at('a.txt'))
    expect(r).toMatchObject({ text: 'hello\r\nworld', bom: true, path: at('a.txt') })
    expect(r.stamp).toMatch(/^[0-9a-f]{64}$/)
  })
  it('reports a missing file instead of throwing', async () => {
    expect(await read(at('gone.txt'))).toEqual({ missing: true })
  })
  it('refuses a folder, a binary file, non-UTF-8 text and a file that is too big', async () => {
    fs.mkdirSync(at('sub'))
    fs.writeFileSync(at('bin.dat'), Buffer.from([1, 2, 0, 3]))
    fs.writeFileSync(at('latin.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9]))
    fs.writeFileSync(at('big.txt'), 'x'.repeat(MAX_READ_BYTES + 1))
    await expect(read(at('sub'))).rejects.toThrow(/Not a file/)
    await expect(read(at('bin.dat'))).rejects.toThrow(/isn't a text file/)
    await expect(read(at('latin.txt'))).rejects.toThrow(/UTF-8/)
    await expect(read(at('big.txt'))).rejects.toThrow(/too large/)
  })
  it('works for a path outside any particular folder', async () => {
    fs.mkdirSync(at('deep', 'er'), { recursive: true })
    fs.writeFileSync(at('deep', 'er', 'x.md'), '# hi')
    expect((await read(at('deep', 'er', 'x.md'))).text).toBe('# hi')
  })
})

describe('write', () => {
  it('saves when the file is as it was read, and returns the new stamp', async () => {
    fs.writeFileSync(at('a.txt'), 'one')
    const { stamp } = await read(at('a.txt'))
    const w = await write(at('a.txt'), 'two', { expectedStamp: stamp })
    expect(w.ok).toBe(true)
    expect(fs.readFileSync(at('a.txt'), 'utf8')).toBe('two')
    expect((await read(at('a.txt'))).stamp).toBe(w.stamp)
  })
  it('reports a conflict, and leaves the file alone, when it changed on disk since the read', async () => {
    fs.writeFileSync(at('a.txt'), 'one')
    const { stamp } = await read(at('a.txt'))
    fs.writeFileSync(at('a.txt'), 'changed elsewhere')
    const w = await write(at('a.txt'), 'mine', { expectedStamp: stamp })
    expect(w).toMatchObject({ ok: false, conflict: true })
    expect(fs.readFileSync(at('a.txt'), 'utf8')).toBe('changed elsewhere')
  })
  it('overwrites a conflicting file when told to', async () => {
    fs.writeFileSync(at('a.txt'), 'one')
    fs.writeFileSync(at('a.txt'), 'changed elsewhere')
    expect((await write(at('a.txt'), 'mine', { expectedStamp: 'stale', overwrite: true })).ok).toBe(true)
    expect(fs.readFileSync(at('a.txt'), 'utf8')).toBe('mine')
  })
  it('creates a new file (and its folders) when none was expected', async () => {
    const w = await write(at('new', 'dir', 'n.txt'), 'fresh', {})
    expect(w.ok).toBe(true)
    expect(fs.readFileSync(at('new', 'dir', 'n.txt'), 'utf8')).toBe('fresh')
  })
  it('reports a file deleted since the read, unless overwriting', async () => {
    fs.writeFileSync(at('a.txt'), 'one')
    const { stamp } = await read(at('a.txt'))
    fs.rmSync(at('a.txt'))
    expect(await write(at('a.txt'), 'two', { expectedStamp: stamp })).toEqual({ ok: false, missing: true })
    expect((await write(at('a.txt'), 'two', { expectedStamp: stamp, overwrite: true })).ok).toBe(true)
  })
  it('puts the BOM back when the file had one', async () => {
    fs.writeFileSync(at('a.txt'), '\ufeffone')
    const { stamp, bom } = await read(at('a.txt'))
    await write(at('a.txt'), 'two', { expectedStamp: stamp, bom })
    expect([...fs.readFileSync(at('a.txt')).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  })
  it('leaves no temp file behind', async () => {
    fs.writeFileSync(at('a.txt'), 'one')
    const { stamp } = await read(at('a.txt'))
    await write(at('a.txt'), 'two', { expectedStamp: stamp })
    expect(fs.readdirSync(dir)).toEqual(['a.txt'])
  })
  it('refuses to overwrite a binary file, and to write something that is not text', async () => {
    fs.writeFileSync(at('bin.dat'), Buffer.from([1, 0, 2]))
    await expect(write(at('bin.dat'), 'x', { overwrite: true })).rejects.toThrow(/isn't a text file/)
    await expect(write(at('a.txt'), 42, {})).rejects.toThrow(/Nothing to write/)
  })
  it('saves through a symlink to its target and keeps the link', async () => {
    fs.writeFileSync(at('real.txt'), 'one')
    try { fs.symlinkSync(at('real.txt'), at('link.txt')) } catch { return }   // no symlink rights on this machine
    const { stamp } = await read(at('link.txt'))
    await write(at('link.txt'), 'two', { expectedStamp: stamp })
    expect(fs.lstatSync(at('link.txt')).isSymbolicLink()).toBe(true)
    expect(fs.readFileSync(at('real.txt'), 'utf8')).toBe('two')
  })
})

describe('list', () => {
  it('lists folders first, then files, each in natural order', async () => {
    fs.mkdirSync(at('zeta')); fs.mkdirSync(at('Alpha'))
    for (const n of ['b10.txt', 'b2.txt', 'a.txt', '.hidden']) fs.writeFileSync(at(n), 'x')
    const r = await list(dir)
    expect(r.entries.map(e => `${e.kind}:${e.name}`)).toEqual([
      'dir:Alpha', 'dir:zeta', 'file:.hidden', 'file:a.txt', 'file:b2.txt', 'file:b10.txt',
    ])
    expect(r.truncated).toBe(false)
    expect(r.entries.find(e => e.name === 'a.txt').size).toBe(1)
  })
  it('refuses a file and a missing folder', async () => {
    fs.writeFileSync(at('f.txt'), 'x')
    await expect(list(at('f.txt'))).rejects.toThrow()
    await expect(list(at('nope'))).rejects.toThrow()
  })
})

describe('pathsFromArgv', () => {
  it('picks out the existing files and folders in a command line', () => {
    fs.writeFileSync(at('a.txt'), 'x'); fs.mkdirSync(at('d'))
    const argv = ['C:\\app\\NexusMD.exe', '--flag', at('a.txt'), at('d'), at('missing.txt'), 'relative.txt', '-x', at('a.txt')]
    expect(pathsFromArgv(argv)).toEqual([at('a.txt'), at('d')])
  })
  it('ignores the program itself and a missing list', () => {
    expect(pathsFromArgv([dir])).toEqual([])
    expect(pathsFromArgv(undefined)).toEqual([])
  })
})
