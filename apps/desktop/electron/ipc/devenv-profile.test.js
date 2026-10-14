// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { registerProfile, resolveProfileDir } from './devenv-profile.cjs'
import { withLogging } from './withLogging.cjs'

const sha = s => crypto.createHash('sha256').update(s).digest('hex')

let tmp, root, dir, config

function setup({ fs: fsOverride, logged = [] } = {}) {
  const handlers = {}
  const logger = { scope: () => ({ error: (...a) => logged.push(a) }) }
  const handle = withLogging({ handle: (c, fn) => { handlers[c] = fn } }, logger)
  registerProfile(handle, { fsp: fsOverride ?? fsp })
  const call = (channel, ...args) => handlers[channel]({}, ...args)
  return {
    logged,
    list: () => call('devenv:profile:list', config),
    read: rel => call('devenv:profile:read', config, rel),
    write: (rel, text, opts) => call('devenv:profile:write', config, rel, text, { dir, ...opts }),
  }
}

const put = (rel, content) => {
  const f = path.join(dir, ...rel.split('/'))
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, content)
}

// Some Windows setups refuse to create links without rights; those tests then have nothing to check.
function tryLink(target, link) {
  try { fs.symlinkSync(target, link, 'junction'); return true } catch { return false }
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-profile-')))
  root = path.join(tmp, 'dev-environment')
  dir = path.join(root, 'profile')
  fs.mkdirSync(dir, { recursive: true })
  config = { root, pwsh: 'pwsh', profile: '' }
})
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

describe('resolveProfileDir', () => {
  it('is <root>/profile when Settings has no profile folder', () => {
    expect(resolveProfileDir({ root, profile: '' })).toBe(path.join(root, 'profile'))
    expect(resolveProfileDir({ root })).toBe(path.join(root, 'profile'))
  })
  it('is the Settings folder when set, and refuses a relative one', () => {
    const other = path.join(tmp, 'elsewhere')
    expect(resolveProfileDir({ root, profile: other })).toBe(other)
    expect(() => resolveProfileDir({ root, profile: 'rel/p' })).toThrow('must be an absolute path')
  })
  it('refuses a missing or relative devenv folder', () => {
    expect(() => resolveProfileDir({ root: 'dev' })).toThrow('Set the devenv folder')
    expect(() => resolveProfileDir(null)).toThrow('Set the devenv folder')
  })
})

describe('devenv:profile:list', () => {
  it('reports a missing folder without throwing', async () => {
    config = { root, profile: path.join(tmp, 'none') }
    expect(await setup().list()).toEqual({ dir: path.join(tmp, 'none'), exists: false, files: [], truncated: false })
  })
  it('lists files with forward slashes, sorted, skipping build output, .git and temp files', async () => {
    put('environment.json', '{}')
    put('docker/services.compose.yml', 'a: 1')
    put('Commands.ps1', '#')
    put('bin/x.dll', 'x')
    put('api/obj/y', 'y')
    put('.git/HEAD', 'ref')
    put('mac.json.abc.nexusmd-tmp', '{}')
    const r = await setup().list()
    expect(r.exists).toBe(true)
    expect(r.dir).toBe(dir)
    expect(r.files.map(f => f.path)).toEqual(['Commands.ps1', 'docker/services.compose.yml', 'environment.json'])
    expect(r.files[0].size).toBe(1)
  })
  it('exists is false without environment.json', async () => {
    put('mac.json', '{}')
    expect((await setup().list()).exists).toBe(false)
  })
  it('does not follow or list links that lead out of the profile', async () => {
    put('environment.json', '{}')
    const outside = path.join(tmp, 'outside')
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'secret.txt'), 's')
    if (!tryLink(outside, path.join(dir, 'link'))) return
    expect((await setup().list()).files.map(f => f.path)).toEqual(['environment.json'])
  })
  it('stops at 2000 files', async () => {
    for (let i = 0; i < 2005; i++) put(`many/f${i}.txt`, '')
    const r = await setup().list()
    expect(r.truncated).toBe(true)
    expect(r.files).toHaveLength(2000)
  })
})

describe('devenv:profile:read', () => {
  it('returns the text and the sha256 of the bytes', async () => {
    put('environment.json', '{"name":"x"}\n')
    expect(await setup().read('environment.json')).toEqual({ dir, path: 'environment.json', text: '{"name":"x"}\n', stamp: sha('{"name":"x"}\n') })
  })
  it('keeps a BOM and CRLF in the text', async () => {
    put('mac.json', '\uFEFF{\r\n}\r\n')
    const r = await setup().read('mac.json')
    expect(r.text).toBe('\uFEFF{\r\n}\r\n')
  })
  it('reports binary and non-UTF-8 files without their text', async () => {
    put('a.bin', Buffer.from([1, 0, 2]))
    put('b.txt', Buffer.from([0xc3, 0x28]))
    const s = setup()
    for (const f of ['a.bin', 'b.txt']) {
      const r = await s.read(f)
      expect(r.binary).toBe(true)
      expect(r.text).toBeUndefined()
      expect(r.stamp).toMatch(/^[0-9a-f]{64}$/)
    }
  })
  it('does not read a file over 1 MiB', async () => {
    put('big.sql', Buffer.alloc(1024 * 1024 + 1, 65))
    const spy = { ...fsp, readFile: vi.fn(fsp.readFile) }
    const r = await setup({ fs: spy }).read('big.sql')
    expect(r).toEqual({ dir, path: 'big.sql', stamp: null, tooLarge: true, size: 1024 * 1024 + 1 })
    expect(spy.readFile).not.toHaveBeenCalled()
  })
  it('reports a missing file', async () => {
    expect(await setup().read('mac.json')).toEqual({ dir, path: 'mac.json', missing: true, stamp: null })
  })
})

describe('confinement', () => {
  const BAD = ['../x', '..\\x', 'a/../../x', 'C:\\x', 'c:x', '\\\\srv\\s\\x', '/x', 'a//b', './a', 'a\u0000b', '', null, 42]
  it.each(BAD.map(b => [JSON.stringify(b), b]))('refuses %s for read and write', async (_n, rel) => {
    put('environment.json', '{}')
    const s = setup()
    await expect(s.read(rel)).rejects.toThrow('Not a profile file')
    await expect(s.write(rel, 'x', { expected: null })).rejects.toThrow('Not a profile file')
    expect(fs.readdirSync(tmp).sort()).toEqual(['dev-environment'])
    expect(fs.readdirSync(root)).toEqual(['profile'])
  })
  it('refuses to read or write through a link that leads out', async () => {
    const outside = path.join(tmp, 'outside')
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'secret.txt'), 's')
    if (!tryLink(outside, path.join(dir, 'link'))) return
    const s = setup()
    await expect(s.read('link/secret.txt')).rejects.toThrow('Not a profile file')
    await expect(s.write('link/secret.txt', 'x', { expected: sha('s') })).rejects.toThrow('Not a profile file')
    await expect(s.write('link/new/file.txt', 'x', { expected: null })).rejects.toThrow('Not a profile file')
    expect(fs.readdirSync(outside)).toEqual(['secret.txt'])
    expect(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8')).toBe('s')
  })
  it('refuses a file that is itself a link, even to a file inside', async () => {
    put('real.txt', 'r')
    try { fs.symlinkSync(path.join(dir, 'real.txt'), path.join(dir, 'alias.txt')) } catch { return }
    await expect(setup().read('alias.txt')).rejects.toThrow('Not a profile file')
  })
})

describe('devenv:profile:write', () => {
  it('saves with the right stamp, atomically, leaving no temp file', async () => {
    put('environment.json', 'old')
    const r = await setup().write('environment.json', 'new ✓', { expected: sha('old') })
    expect(r).toEqual({ ok: true, stamp: sha('new ✓') })
    expect(fs.readFileSync(path.join(dir, 'environment.json'), 'utf8')).toBe('new ✓')
    expect(fs.readdirSync(dir)).toEqual(['environment.json'])
  })
  it('refuses a stale stamp and leaves the file as it was', async () => {
    put('mac.json', 'changed by devenv')
    const r = await setup().write('mac.json', 'mine', { expected: sha('what I opened') })
    expect(r).toEqual({ ok: false, stale: true, stamp: sha('changed by devenv') })
    expect(fs.readFileSync(path.join(dir, 'mac.json'), 'utf8')).toBe('changed by devenv')
  })
  it('expected null means the file must not exist yet; new folders are made inside the profile', async () => {
    put('sql/a.sql', 'a')
    const s = setup()
    expect(await s.write('sql/a.sql', 'b', { expected: null })).toEqual({ ok: false, stale: true, stamp: sha('a') })
    expect((await s.write('scripts/deep/x.ps1', '#x', { expected: null })).ok).toBe(true)
    expect(fs.readFileSync(path.join(dir, 'scripts', 'deep', 'x.ps1'), 'utf8')).toBe('#x')
  })
  it('a file deleted since it was opened is stale with a null stamp', async () => {
    expect(await setup().write('gone.txt', 'x', { expected: sha('was here') })).toEqual({ ok: false, stale: true, stamp: null })
  })
  it('refuses a draft read from another profile folder', async () => {
    put('environment.json', 'x')
    const s = setup()
    await expect(s.write('environment.json', 'y', { expected: sha('x'), dir: path.join(tmp, 'old-profile') }))
      .rejects.toThrow('The profile folder changed in Settings')
    expect(fs.readFileSync(path.join(dir, 'environment.json'), 'utf8')).toBe('x')
  })
  it('refuses non-string text and more than 1 MiB', async () => {
    const s = setup()
    await expect(s.write('a.txt', 5, { expected: null })).rejects.toThrow("Couldn't save a.txt")
    await expect(s.write('a.txt', 'a'.repeat(1024 * 1024 + 1), { expected: null })).rejects.toThrow('over 1 MiB')
  })
  it('retries a briefly locked rename', async () => {
    put('environment.json', 'old')
    let fails = 1
    const flaky = { ...fsp, rename: vi.fn(async (a, b) => { if (fails-- > 0) throw Object.assign(new Error('busy'), { code: 'EPERM' }); return fsp.rename(a, b) }) }
    expect((await setup({ fs: flaky }).write('environment.json', 'new', { expected: sha('old') })).ok).toBe(true)
    expect(flaky.rename).toHaveBeenCalledTimes(2)
    expect(fs.readFileSync(path.join(dir, 'environment.json'), 'utf8')).toBe('new')
  })
  it('gives up on a rename that keeps failing, removes the temp file and keeps the original', async () => {
    put('environment.json', 'old')
    const stuck = { ...fsp, rename: vi.fn(async () => { throw Object.assign(new Error('busy'), { code: 'EPERM' }) }) }
    await expect(setup({ fs: stuck }).write('environment.json', 'new', { expected: sha('old') })).rejects.toThrow("Couldn't save environment.json: EPERM")
    expect(fs.readdirSync(dir)).toEqual(['environment.json'])
    expect(fs.readFileSync(path.join(dir, 'environment.json'), 'utf8')).toBe('old')
  })
  it('never puts file contents in an error or the log', async () => {
    put('docker/orders.env', 'SA_PASSWORD=old-secret')
    const logged = []
    const stuck = { ...fsp, rename: async () => { throw Object.assign(new Error('SA_PASSWORD=new-secret'), { code: 'EIO' }) } }
    const s = setup({ fs: stuck, logged })
    const err = await s.write('docker/orders.env', 'SA_PASSWORD=new-secret', { expected: sha('SA_PASSWORD=old-secret') }).catch(e => e)
    expect(err.message).toBe("Couldn't save docker/orders.env: EIO")
    expect(logged.length).toBeGreaterThan(0)
    expect(JSON.stringify(logged.map(a => a.map(x => (x instanceof Error ? x.message : x))))).not.toMatch(/secret/)
  })
})
