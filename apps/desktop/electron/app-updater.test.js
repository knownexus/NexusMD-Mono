// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { checkAppUpdates, pruneDownloads, startAppUpdater } from './app-updater.cjs'
import { packApp, sha256, signIndex } from './app-package.cjs'
import { resolveApps } from './app-registry.cjs'

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const PUB = publicKey.export({ type: 'spki', format: 'pem' })
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' })
const BASE = 'https://example.invalid/releases/apps-latest/'
const INDEX_URL = `${BASE}apps-index.json`

describe('checkAppUpdates', () => {
  let root, installedDir, updatesDir, served
  const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
  const fetch = vi.fn(async url => {
    if (!(url in served)) return { ok: false, status: 404 }
    const body = served[url]
    return { ok: true, status: 200, text: async () => String(body), arrayBuffer: async () => Buffer.from(body) }
  })

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-appupd-'))
    installedDir = path.join(root, 'installed')
    updatesDir = path.join(root, 'updates')
    fs.mkdirSync(installedDir)
    fs.mkdirSync(updatesDir)
    served = {}
    fetch.mockClear()
    for (const fn of Object.values(log)) fn.mockClear()
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  function writeApp(dir, manifest) {
    fs.mkdirSync(path.join(dir, 'renderer'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'app.manifest.json'), JSON.stringify(manifest))
    fs.writeFileSync(path.join(dir, 'renderer', 'index.js'), `export default { version: '${manifest.version}' }`)
    return dir
  }
  const install = (id, version) => writeApp(path.join(installedDir, id), { id, version })
  // Serves a package of this app version, and returns its index entry.
  function publish(id, version, { requires = { shellApi: 1 }, manifest = {} } = {}) {
    const data = packApp(writeApp(path.join(root, 'build', `${id}-${version}`), { id, version, requires, ...manifest }))
    const file = `${id}-${version}.nxapp`
    served[BASE + file] = data
    return { version, requires, file, size: data.length, sha256: sha256(data) }
  }
  function serveIndex(apps, { key = PRIV } = {}) {
    const bytes = JSON.stringify({ schema: 1, shell: { version: '1.2.5', shellApi: 1 }, apps })
    served[INDEX_URL] = bytes
    served[`${INDEX_URL}.sig`] = signIndex(bytes, key)
  }
  const running = () => resolveApps(installedDir, { updatesDir, log })
  const check = (opts = {}) => checkAppUpdates({ apps: running(), updatesDir, fetch, indexUrl: INDEX_URL, publicKey: PUB, shellApi: 1, log, ...opts })

  it('downloads a newer version, which the next launch runs', async () => {
    install('git', '1.0.0')
    install('notes', '1.0.0')
    serveIndex({ git: publish('git', '1.0.1'), notes: publish('notes', '1.0.0') })
    const result = await check()
    expect(result).toMatchObject({ downloaded: [{ id: 'git', version: '1.0.1' }], failed: [], needsShell: [] })
    expect(fs.readdirSync(path.join(updatesDir, 'git'))).toEqual(['1.0.1'])
    expect(fs.existsSync(path.join(updatesDir, 'notes'))).toBe(false)
    expect(running().map(a => [a.id, a.version])).toEqual([['git', '1.0.1'], ['notes', '1.0.0']])
  })

  it('downloads nothing from an index without a valid signature', async () => {
    install('git', '1.0.0')
    serveIndex({ git: publish('git', '1.0.1') }, { key: crypto.generateKeyPairSync('ed25519').privateKey })
    const result = await check()
    expect(result.error).toMatch(/not signed/)
    expect(fs.readdirSync(updatesDir)).toEqual([])
    delete served[`${INDEX_URL}.sig`]
    expect((await check()).error).toMatch(/404/)
  })

  it('keeps nothing of a download that is not the package the index lists', async () => {
    install('git', '1.0.0')
    const entry = publish('git', '1.0.1')
    serveIndex({ git: { ...entry, sha256: sha256('something else') } })
    const result = await check()
    expect(result.failed).toEqual([expect.objectContaining({ id: 'git', error: expect.stringMatching(/not the package/) })])
    expect(fs.readdirSync(updatesDir)).toEqual([])
  })

  it('keeps nothing of a package that holds another version than it claims', async () => {
    install('git', '1.0.0')
    const entry = publish('git', '1.0.1', { manifest: { version: '1.0.9' } })
    serveIndex({ git: entry })
    expect((await check()).failed[0].error).toMatch(/1\.0\.9/)
    expect(fs.readdirSync(path.join(updatesDir, 'git'))).toEqual([])
  })

  it('leaves a version needing a newer shell for the next NexusMD update', async () => {
    install('git', '1.0.0')
    serveIndex({ git: publish('git', '2.0.0', { requires: { shellApi: 2 } }) })
    expect((await check()).needsShell).toEqual([{ id: 'git', version: '2.0.0' }])
    expect(fetch.mock.calls.map(c => c[0])).not.toContain(`${BASE}git-2.0.0.nxapp`)
  })

  it('downloads nothing it already has, nothing marked bad, and nothing not newer', async () => {
    install('git', '1.0.0')
    install('notes', '1.0.0')
    install('editor', '1.2.0')
    serveIndex({ git: publish('git', '1.0.1'), notes: publish('notes', '1.0.1'), editor: publish('editor', '1.1.0') })
    await check()
    fetch.mockClear()
    fs.rmSync(path.join(updatesDir, 'notes'), { recursive: true })
    fs.writeFileSync(path.join(updatesDir, 'state.json'), JSON.stringify({ apps: { notes: { bad: ['1.0.1'] } } }))
    // git 1.0.1 is now running, so the index has nothing newer for it.
    const result = await check()
    expect(result.downloaded).toEqual([])
    expect(fetch.mock.calls.map(c => c[0]).filter(u => u.endsWith('.nxapp'))).toEqual([])
  })

  it('never throws when offline', async () => {
    install('git', '1.0.0')
    const offline = vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND') })
    expect((await check({ fetch: offline })).error).toMatch(/ENOTFOUND/)
  })
})

describe('pruneDownloads', () => {
  let updatesDir
  const log = { error: vi.fn(), info: vi.fn() }
  beforeEach(() => { updatesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-prune-')) })
  afterEach(() => fs.rmSync(updatesDir, { recursive: true, force: true }))
  const make = (...parts) => fs.mkdirSync(path.join(updatesDir, ...parts), { recursive: true })
  const left = id => fs.readdirSync(path.join(updatesDir, id)).sort()

  it('keeps the running version, anything newer, and one to go back to', () => {
    for (const v of ['1.0.0', '1.0.1', '1.0.2', '1.0.3', '1.0.4', '1.0.5', '.tmp-1.0.6']) make('git', v)
    make('removed-app', '1.0.0')
    fs.writeFileSync(path.join(updatesDir, 'state.json'), '{}')
    pruneDownloads({ apps: [{ id: 'git', version: '1.0.4', installedVersion: '1.0.0' }], updatesDir, log })
    expect(left('git')).toEqual(['1.0.3', '1.0.4', '1.0.5'])
    expect(fs.readdirSync(updatesDir).sort()).toEqual(['git', 'state.json'])
  })

  it('goes back to nothing older than the installed version', () => {
    for (const v of ['1.0.1', '1.0.2', '1.0.3']) make('git', v)
    // A NexusMD update brought git 1.0.2 with it: 1.0.1 and 1.0.2 are no use any more.
    pruneDownloads({ apps: [{ id: 'git', version: '1.0.2', installedVersion: '1.0.2' }], updatesDir, log })
    expect(left('git')).toEqual(['1.0.3'])
  })
})

describe('startAppUpdater', () => {
  const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
  it('checks on demand, sharing a check already under way', async () => {
    let calls = 0
    const fetch = vi.fn(async () => { calls++; return { ok: false, status: 503 } })
    const onChecked = vi.fn()
    const updater = startAppUpdater({ delayMs: 60_000, apps: [], updatesDir: os.tmpdir(), fetch, indexUrl: INDEX_URL, publicKey: PUB, log, onChecked })
    try {
      const [a, b] = await Promise.all([updater.check(), updater.check()])
      expect(a).toBe(b)
      expect(a.error).toMatch(/503/)
      const perCheck = calls
      expect(onChecked).toHaveBeenCalledTimes(1)
      expect(onChecked).toHaveBeenCalledWith(a)
      await updater.check()
      expect(calls).toBe(perCheck * 2)
    } finally { updater.stop() }
  })
})
