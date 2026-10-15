// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import fsp from 'fs/promises'
import crypto from 'crypto'
import os from 'os'
import path from 'path'
import { register, profileDir } from './devenv-profile.cjs'

let tmp, root, dir, h
const call = (ch, ...args) => h[ch](null, ...args)
const cfg = (over = {}) => ({ root, pwsh: 'pwsh', profile: '', ...over })

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-profile-'))
  root = path.join(tmp, 'dev-environment')
  dir = path.join(root, 'profile')
  fs.mkdirSync(path.join(root, 'profile.example', 'docker'), { recursive: true })
  fs.writeFileSync(path.join(root, 'profile.example', 'environment.json'), '{"repositories":{}}\n')
  fs.writeFileSync(path.join(root, 'profile.example', 'docker', 'services.compose.yml'), 'services: {}\n')
  h = {}
  register({ handle: (c, fn) => { h[c] = fn } }, { logger: { scope: () => ({ error: () => {}, info: () => {} }) } })
})
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

function makeProfile() {
  fs.mkdirSync(path.join(dir, 'docker'), { recursive: true })
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'api-tests', 'node_modules'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'environment.json'), '{"repositories":{}}\n')
  fs.writeFileSync(path.join(dir, 'docker', 'services.compose.yml'), 'services: {}\n')
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'x')
  fs.writeFileSync(path.join(dir, 'api-tests', 'node_modules', 'x.js'), 'x')
}

describe('profileDir', () => {
  it('uses <root>\\profile by default and an absolute profile setting otherwise', () => {
    expect(profileDir(cfg())).toBe(path.resolve(dir))
    expect(profileDir(cfg({ profile: path.join(tmp, 'elsewhere') }))).toBe(path.join(tmp, 'elsewhere'))
  })
  it('refuses relative folders', () => {
    expect(() => profileDir({ root: 'dev', profile: '' })).toThrow(/absolute/)
    expect(() => profileDir(cfg({ profile: 'rel' }))).toThrow(/absolute/)
  })
})

describe('info, create, list', () => {
  it('reports a missing profile and the template, then creates it from profile.example', async () => {
    expect(await call('devenv:profile-info', cfg())).toEqual({ dir: path.resolve(dir), isDefault: true, exists: false, example: true })
    expect(await call('devenv:profile-create', cfg())).toEqual({ ok: true, dir: path.resolve(dir) })
    expect(fs.readFileSync(path.join(dir, 'docker', 'services.compose.yml'), 'utf8')).toBe('services: {}\n')
    expect((await call('devenv:profile-info', cfg())).exists).toBe(true)
  })
  it('refuses to create over an existing profile or a non-empty folder', async () => {
    makeProfile()
    await expect(call('devenv:profile-create', cfg())).rejects.toThrow(/already exists/)
    const other = path.join(tmp, 'busy'); fs.mkdirSync(other); fs.writeFileSync(path.join(other, 'x.txt'), 'x')
    await expect(call('devenv:profile-create', cfg({ profile: other }))).rejects.toThrow(/isn't empty/)
  })
  it('lists files with / paths, skipping .git, node_modules and junctions', async () => {
    makeProfile()
    const outside = path.join(tmp, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'secret.txt'), 's')
    fs.symlinkSync(outside, path.join(dir, 'link'), 'junction')
    const r = await call('devenv:profile-list', cfg())
    expect(r.files.map(f => f.path)).toEqual(['docker/services.compose.yml', 'environment.json'])
    expect(r.truncated).toBe(false)
    expect(typeof r.files[0].mtimeMs).toBe('number')
  })
})

describe('read', () => {
  beforeEach(makeProfile)
  it('reads text with its stamp, strips and reports a BOM, and reports a missing file', async () => {
    fs.writeFileSync(path.join(dir, 'bom.ps1'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Write-Host hi\r\n')]))
    expect(await call('devenv:profile-read', cfg(), 'bom.ps1')).toMatchObject({ text: 'Write-Host hi\r\n', bom: true })
    expect((await call('devenv:profile-read', cfg(), 'docker\\services.compose.yml')).text).toBe('services: {}\n')
    expect(await call('devenv:profile-read', cfg(), 'mac.json')).toEqual({ missing: true })
  })
  it('refuses binary and oversized files', async () => {
    fs.writeFileSync(path.join(dir, 'b.bin'), Buffer.from([1, 0, 2]))
    await expect(call('devenv:profile-read', cfg(), 'b.bin')).rejects.toThrow(/isn't a text file/)
    fs.writeFileSync(path.join(dir, 'big.txt'), 'x'.repeat(1024 * 1024 + 1))
    await expect(call('devenv:profile-read', cfg(), 'big.txt')).rejects.toThrow(/too large/)
  })
  it('refuses files that are not valid UTF-8', async () => {
    fs.writeFileSync(path.join(dir, 'latin.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9]))
    await expect(call('devenv:profile-read', cfg(), 'latin.txt')).rejects.toThrow("latin.txt isn't UTF-8 text.")
  })
  it.skipIf(process.platform !== 'win32')('refuses Windows-only path tricks (streams, trailing dot or space) but not dot-folders', async () => {
    for (const bad of ['environment.json:stream', 'a:b', 'docker./x', 'docker /x', 'environment.json.', 'environment.json ']) {
      await expect(call('devenv:profile-read', cfg(), bad)).rejects.toThrow(/Not a profile file/)
    }
    expect(await call('devenv:profile-read', cfg(), '.github/x.yml')).toEqual({ missing: true })
  })
  it('refuses paths outside the profile, including through a junction', async () => {
    const outside = path.join(tmp, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'secret.txt'), 's')
    fs.symlinkSync(outside, path.join(dir, 'link'), 'junction')
    for (const bad of ['../profile.example/environment.json', 'docker/../../x', path.join(tmp, 'outside', 'secret.txt'), 'link/secret.txt', '', 'a\0b']) {
      await expect(call('devenv:profile-read', cfg(), bad)).rejects.toThrow(/Not a profile file/)
    }
  })
})

// A short (8.3) spelling of the temp dir, if this machine has one; the long form is what realpath returns.
const longTmp = fs.realpathSync.native(os.tmpdir())
const shortTmp = [os.tmpdir(), longTmp].find(p => p.includes('~'))

describe('confinement of folders that do not exist yet', () => {
  // Rebuilt under the long-form tmp dir so the checks compare real paths exactly: on a short tmp
  // path the old lexical fallback refused escapes by accident and these tests proved nothing.
  beforeEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
    tmp = fs.mkdtempSync(path.join(longTmp, 'nexusmd-profile-'))
    root = path.join(tmp, 'dev-environment')
    dir = path.join(root, 'profile')
    makeProfile()
  })
  const outsideDir = () => {
    const outside = path.join(tmp, 'outside'); fs.mkdirSync(outside, { recursive: true })
    fs.symlinkSync(outside, path.join(dir, 'link'), 'junction')
    return outside
  }
  it('creates nested files inside the profile', async () => {
    expect((await call('devenv:profile-write', cfg(), 'sub/deeper/new.txt', 'x', { create: true })).ok).toBe(true)
    expect(fs.readFileSync(path.join(dir, 'sub', 'deeper', 'new.txt'), 'utf8')).toBe('x')
  })
  it.skipIf(!shortTmp)('creates nested files when the profile path is spelled with an 8.3 short name (no short tmp form on this machine)', async () => {
    const r = path.join(fs.mkdtempSync(path.join(shortTmp, 'nexusmd-short-')), 'dev-environment')
    try {
      fs.mkdirSync(path.join(r, 'profile'), { recursive: true })
      expect((await call('devenv:profile-write', { root: r, pwsh: 'pwsh', profile: '' }, 'a/b/c.txt', 'x', { create: true })).ok).toBe(true)
    } finally { fs.rmSync(path.dirname(r), { recursive: true, force: true }) }
  })
  it('refuses a nested create through a junction and creates nothing outside', async () => {
    const outside = outsideDir()
    await expect(call('devenv:profile-write', cfg(), 'link/newdir/evil.txt', 'x', { create: true })).rejects.toThrow(/Not a profile file/)
    expect(fs.readdirSync(outside)).toEqual([])
  })
  it('refuses a junction as the final component', async () => {
    const outside = outsideDir()
    await expect(call('devenv:profile-read', cfg(), 'link')).rejects.toThrow(/Not a profile file/)
    await expect(call('devenv:profile-write', cfg(), 'link', 'x', { create: true, overwrite: true })).rejects.toThrow(/Not a profile file/)
    await expect(call('devenv:profile-write', cfg(), 'link/x', 'x', { create: true })).rejects.toThrow(/Not a profile file/)
    expect(fs.readdirSync(outside)).toEqual([])
  })
  it('allows nested creates when the profile folder itself is a junction', async () => {
    const realFolder = path.join(tmp, 'real-profile'); fs.mkdirSync(realFolder)
    const linked = path.join(tmp, 'linked-profile'); fs.symlinkSync(realFolder, linked, 'junction')
    expect((await call('devenv:profile-write', cfg({ profile: linked }), 'new/x.txt', 'x', { create: true })).ok).toBe(true)
    expect(fs.readFileSync(path.join(realFolder, 'new', 'x.txt'), 'utf8')).toBe('x')
  })
  it('tolerates null write options', async () => {
    expect(await call('devenv:profile-write', cfg(), 'nope.txt', 'x', null)).toEqual({ ok: false, missing: true })
  })
})

describe('limits', () => {
  beforeEach(makeProfile)
  it('skips bin, obj, .vs and .idea in the listing', async () => {
    for (const d of ['bin', 'obj', '.vs', '.idea']) { fs.mkdirSync(path.join(dir, d)); fs.writeFileSync(path.join(dir, d, 'x.txt'), 'x') }
    expect((await call('devenv:profile-list', cfg())).files.map(f => f.path)).toEqual(['docker/services.compose.yml', 'environment.json'])
  })
  it('refuses to write over 2 MB', async () => {
    await expect(call('devenv:profile-write', cfg(), 'big.txt', 'x'.repeat(2 * 1024 * 1024 + 1), { create: true })).rejects.toThrow(/too large/)
  })
  it('refuses to create without a profile.example', async () => {
    fs.rmSync(path.join(root, 'profile.example'), { recursive: true })
    fs.rmSync(dir, { recursive: true })
    await expect(call('devenv:profile-create', cfg())).rejects.toThrow(/No profile.example/)
  })
})

describe('write', () => {
  beforeEach(makeProfile)
  const file = () => path.join(dir, 'environment.json')
  const sha = b => crypto.createHash('sha256').update(b).digest('hex')
  it('saves atomically and returns the new stamp, leaving no temp file', async () => {
    const { stamp } = await call('devenv:profile-read', cfg(), 'environment.json')
    const r = await call('devenv:profile-write', cfg(), 'environment.json', '{"name":"x"}\n', { expectedStamp: stamp })
    expect(r.ok).toBe(true)
    expect(fs.readFileSync(file(), 'utf8')).toBe('{"name":"x"}\n')
    expect(r.stamp).toBe(sha(fs.readFileSync(file())))
    expect(fs.readdirSync(dir).filter(n => n.includes('nexusmd'))).toEqual([])
  })
  it('refuses to overwrite a file that changed on disk, unless told to', async () => {
    const { stamp } = await call('devenv:profile-read', cfg(), 'environment.json')
    fs.writeFileSync(file(), '{"changed":true}\n')
    const r = await call('devenv:profile-write', cfg(), 'environment.json', '{"mine":1}\n', { expectedStamp: stamp })
    expect(r).toEqual({ ok: false, conflict: true, stamp: sha(fs.readFileSync(file())) })
    expect(fs.readFileSync(file(), 'utf8')).toBe('{"changed":true}\n')
    expect((await call('devenv:profile-write', cfg(), 'environment.json', '{"mine":1}\n', { expectedStamp: stamp, overwrite: true })).ok).toBe(true)
    expect(fs.readFileSync(file(), 'utf8')).toBe('{"mine":1}\n')
  })
  it('stamps a read with the SHA-256 of the bytes on disk, BOM included', async () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"a":1}\r\n')])
    fs.writeFileSync(file(), bytes)
    const r = await call('devenv:profile-read', cfg(), 'environment.json')
    expect(r.stamp).toBe(crypto.createHash('sha256').update(bytes).digest('hex'))
    expect(r.bom).toBe(true)
  })
  it('reports a conflict when the bytes changed even though the mtime did not', async () => {
    const r = await call('devenv:profile-read', cfg(), 'environment.json')
    const { mtime, atime } = fs.statSync(file())
    fs.writeFileSync(file(), '{"changed":true}\n')
    fs.utimesSync(file(), atime, mtime)
    const w = await call('devenv:profile-write', cfg(), 'environment.json', '{"x":1}\n', { expectedStamp: r.stamp })
    expect(w).toEqual({ ok: false, conflict: true, stamp: crypto.createHash('sha256').update('{"changed":true}\n').digest('hex') })
    expect(fs.readFileSync(file(), 'utf8')).toBe('{"changed":true}\n')
  })
  it('returns the stamp of what it wrote', async () => {
    const r = await call('devenv:profile-read', cfg(), 'environment.json')
    const w = await call('devenv:profile-write', cfg(), 'environment.json', '{"y":2}\n', { expectedStamp: r.stamp, bom: true })
    const onDisk = fs.readFileSync(file())
    expect(w).toEqual({ ok: true, stamp: crypto.createHash('sha256').update(onDisk).digest('hex') })
  })
  it('retries the rename while the file is briefly locked', async () => {
    const r = await call('devenv:profile-read', cfg(), 'environment.json')
    const busy = Object.assign(new Error('busy'), { code: 'EBUSY' })
    const spy = vi.spyOn(fsp, 'rename').mockRejectedValueOnce(busy).mockRejectedValueOnce(Object.assign(new Error('perm'), { code: 'EPERM' }))
    try {
      const w = await call('devenv:profile-write', cfg(), 'environment.json', '{"z":3}\n', { expectedStamp: r.stamp })
      expect(w.ok).toBe(true)
      expect(spy).toHaveBeenCalledTimes(3)
      expect(fs.readFileSync(file(), 'utf8')).toBe('{"z":3}\n')
    } finally { spy.mockRestore() }
  })
  it('gives up after the retries and leaves no temp file behind', async () => {
    const r = await call('devenv:profile-read', cfg(), 'environment.json')
    const spy = vi.spyOn(fsp, 'rename').mockRejectedValue(Object.assign(new Error('locked'), { code: 'EBUSY' }))
    try {
      await expect(call('devenv:profile-write', cfg(), 'environment.json', '{}\n', { expectedStamp: r.stamp })).rejects.toThrow()
      expect(spy).toHaveBeenCalledTimes(4)
      expect(fs.readdirSync(path.dirname(file())).filter(n => n.includes('.nexusmd-'))).toEqual([])
    } finally { spy.mockRestore() }
  })
  it('does not list leftover save temp files', async () => {
    fs.writeFileSync(path.join(path.dirname(file()), '.environment.json.nexusmd-0a1b2c3d.tmp'), 'x')
    const r = await call('devenv:profile-list', cfg())
    expect(r.files.map(f => f.path).some(p => p.includes('.nexusmd-'))).toBe(false)
  })
  it('creates a missing file only when asked, and treats an unexpected existing file as a conflict', async () => {
    expect(await call('devenv:profile-write', cfg(), 'mac.json', '{}', {})).toEqual({ ok: false, missing: true })
    expect((await call('devenv:profile-write', cfg(), 'mac.json', '{"host":"m"}\n', { create: true })).ok).toBe(true)
    expect((await call('devenv:profile-write', cfg(), 'mac.json', '{}', { create: true })).conflict).toBe(true)
  })
  it('writes the BOM back when asked', async () => {
    await call('devenv:profile-write', cfg(), 'x.ps1', 'a\r\n', { create: true, bom: true })
    expect([...fs.readFileSync(path.join(dir, 'x.ps1'))].slice(0, 3)).toEqual([0xef, 0xbb, 0xbf])
  })
  it('refuses paths outside the profile and a missing profile folder', async () => {
    await expect(call('devenv:profile-write', cfg(), '../evil.txt', 'x', { create: true })).rejects.toThrow(/Not a profile file/)
    expect(fs.existsSync(path.join(root, 'evil.txt'))).toBe(false)
    await expect(call('devenv:profile-write', cfg({ profile: path.join(tmp, 'nope') }), 'a.txt', 'x', { create: true })).rejects.toThrow(/No profile folder/)
  })
})
