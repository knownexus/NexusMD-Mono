// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { resolveInside, readText, writeAtomic, sha256, BOM, TMP_FILE } from './safe-file.cjs'

let tmp, dir
const notOk = rel => new Error(`Nope: ${rel}`)

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-safefile-'))
  dir = path.join(tmp, 'dir')
  fs.mkdirSync(dir)
})
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

describe('resolveInside', () => {
  it('refuses ../, absolute, ADS (a:b) and trailing-dot names', async () => {
    const bad = ['../x', 'a/../../x', path.join(tmp, 'x'), '', 'a\0b']
    if (process.platform === 'win32') bad.push('a:b', 'name.', 'sub/name ')
    for (const rel of bad) await expect(resolveInside(dir, rel, notOk)).rejects.toThrow(`Nope: ${rel}`)
  })

  it('accepts a path inside, including one that does not exist yet', async () => {
    const r = await resolveInside(dir, 'sub/new.txt', notOk)
    expect(r.full).toBe(path.join(dir, 'sub', 'new.txt'))
    expect(r.realDir).toBeTruthy()
  })

  it('refuses a junction that leads out', async () => {
    const outside = path.join(tmp, 'outside')
    fs.mkdirSync(outside)
    try { fs.symlinkSync(outside, path.join(dir, 'link'), 'junction') } catch (e) { if (e.code === 'EPERM') return; throw e }
    await expect(resolveInside(dir, 'link/x.txt', notOk)).rejects.toThrow('Nope: link/x.txt')
  })
})

describe('readText', () => {
  it('returns text, bom and stamp; missing for an absent file', async () => {
    const f = path.join(dir, 'a.txt')
    fs.writeFileSync(f, '﻿hi\n')
    const r = await readText(f, 'a.txt', { maxBytes: 1024 })
    expect(r).toMatchObject({ text: 'hi\n', bom: true })
    expect(r.stamp).toBe(sha256(Buffer.from('﻿hi\n')))
    expect(await readText(path.join(dir, 'none.txt'), 'none.txt', { maxBytes: 1024 })).toEqual({ missing: true })
  })

  it('refuses binary, oversize and non-UTF-8', async () => {
    fs.writeFileSync(path.join(dir, 'x.bin'), Buffer.from([1, 0, 2]))
    fs.writeFileSync(path.join(dir, 'big.txt'), 'a'.repeat(2048))
    fs.writeFileSync(path.join(dir, 'bad.txt'), Buffer.from([0xff, 0xfe, 0x41]))
    const opts = { maxBytes: 1024 }
    await expect(readText(path.join(dir, 'x.bin'), 'x.bin', opts)).rejects.toThrow("x.bin isn't a text file.")
    await expect(readText(path.join(dir, 'big.txt'), 'big.txt', opts)).rejects.toThrow('big.txt is too large to edit here (2 KB).')
    await expect(readText(path.join(dir, 'bad.txt'), 'bad.txt', opts)).rejects.toThrow("bad.txt isn't UTF-8 text.")
  })
})

describe('writeAtomic', () => {
  it('replaces the file and leaves no temp file', async () => {
    const { full, realDir } = await resolveInside(dir, 'sub/a.txt', notOk)
    await writeAtomic(full, realDir, Buffer.from('one'), notOk)
    await writeAtomic(full, realDir, Buffer.concat([BOM, Buffer.from('two')]), notOk)
    expect(fs.readFileSync(full)).toEqual(Buffer.concat([BOM, Buffer.from('two')]))
    expect(fs.readdirSync(path.dirname(full)).filter(n => TMP_FILE.test(n))).toEqual([])
  })
})
