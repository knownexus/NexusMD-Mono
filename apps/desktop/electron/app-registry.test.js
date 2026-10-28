// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  parseInstalledIds, getRegistryInfo, installedModuleIds, getPreloadDescriptors, register, registerModules, MODULES,
  getLayout, scanApps, modulesFromScan, resolveApps, compareVersions,
} from './app-registry.cjs'

const fakeModule = (preload, main) => ({ manifest: () => ({ ipc: { preload } }), main: () => main })

describe('parseInstalledIds', () => {
  it('means "everything" when unset or blank', () => {
    expect(parseInstalledIds(undefined)).toBeNull()
    expect(parseInstalledIds('')).toBeNull()
    expect(parseInstalledIds(' , ')).toBeNull()
  })
  it('splits, trims, lowercases and de-duplicates', () => {
    expect(parseInstalledIds('Git, editor,git')).toEqual(['git', 'editor'])
  })
})

describe('registry IPC', () => {
  it('replies synchronously with the installed ids and the preload descriptors', () => {
    const handlers = {}
    const ipcMain = { on: vi.fn((channel, fn) => { handlers[channel] = fn }) }
    register(ipcMain, { NEXUSMD_APPS: 'git' })
    const get = {}; handlers['registry:get'](get)
    expect(get.returnValue).toEqual({ installedIds: ['git'], disabledIds: [], split: null })
    const pre = {}; handlers['registry:preload-descriptors'](pre)
    expect(pre.returnValue.git.status).toEqual({ invoke: 'git:status' })
    expect(pre.returnValue.popout.open).toEqual({ invoke: 'popout:open' })
  })
  it('reports null (all apps) by default, and no split layout', () => {
    expect(getRegistryInfo({})).toEqual({ installedIds: null, disabledIds: [], split: null })
  })
})

describe('installedModuleIds and getPreloadDescriptors', () => {
  const modules = {
    a: fakeModule({ a: { go: { invoke: 'a:go' } } }),
    b: fakeModule({ b: { go: { invoke: 'b:go' } }, shared: { x: { send: 'b:x' } } }),
  }
  it('includes every split-out app when nothing narrows the set', () => {
    expect(installedModuleIds({}, modules)).toEqual(['a', 'b'])
    expect(Object.keys(getPreloadDescriptors({}, modules)).sort()).toEqual(['a', 'b', 'shared'])
  })
  it('leaves out apps that are not installed', () => {
    expect(installedModuleIds({ NEXUSMD_APPS: 'b,planner' }, modules)).toEqual(['b'])
    expect(Object.keys(getPreloadDescriptors({ NEXUSMD_APPS: 'a' }, modules))).toEqual(['a'])
  })
  it('leaves out apps switched off in Settings', () => {
    expect(installedModuleIds({}, modules, ['a'])).toEqual(['b'])
    expect(Object.keys(getPreloadDescriptors({}, modules, ['b']))).toEqual(['a'])
    expect(getRegistryInfo({}, null, ['a'])).toEqual({ installedIds: null, disabledIds: ['a'], split: null })
  })
  it('exposes nothing when none of the split-out apps are installed', () => {
    expect(getPreloadDescriptors({ NEXUSMD_APPS: 'planner' }, modules)).toEqual({})
  })
  it('knows the real split-out apps', () => {
    expect(Object.keys(MODULES)).toEqual(expect.arrayContaining(['git', 'devenv', 'database', 'api-client', 'editor', 'work']))
  })
})

describe('registerModules', () => {
  const log = { error: vi.fn() }
  it('starts each installed app with the context and disposes them all', async () => {
    const dispose = vi.fn()
    const register = vi.fn(() => ({ dispose }))
    const ctx = { ipcMain: {} }
    const started = registerModules(ctx, {}, { a: fakeModule({}, { register }) }, log)
    expect(register).toHaveBeenCalledWith(ctx)
    await started.disposeAll()
    expect(dispose).toHaveBeenCalled()
  })
  it('does not start apps switched off in Settings', () => {
    const register = vi.fn()
    registerModules({}, {}, { a: fakeModule({}, { register }) }, log, ['a'])
    expect(register).not.toHaveBeenCalled()
  })
  it('does not start apps that are not installed', () => {
    const register = vi.fn()
    registerModules({}, { NEXUSMD_APPS: 'b' }, { a: fakeModule({}, { register }) }, log)
    expect(register).not.toHaveBeenCalled()
  })
  it('keeps going when one app fails to start or to shut down', async () => {
    const good = vi.fn(() => ({ dispose: vi.fn() }))
    const modules = {
      bad: fakeModule({}, { register: () => { throw new Error('boom') } }),
      worse: fakeModule({}, { register: () => ({ dispose: () => { throw new Error('stuck') } }) }),
      good: fakeModule({}, { register: good }),
    }
    const started = registerModules({}, {}, modules, log)
    expect(good).toHaveBeenCalled()
    await expect(started.disposeAll()).resolves.toBeDefined()
    expect(log.error).toHaveBeenCalledTimes(2)
  })
})

// --------------------------------------------------------------------------------------------
// The split layout: apps installed as folders of their own.
// --------------------------------------------------------------------------------------------
describe('getLayout', () => {
  const yes = () => true
  const no = () => false
  it('is all-in-one with nothing set', () => {
    expect(getLayout({}, { isPackaged: false })).toEqual({ appsDir: null, shellDir: null, updatesDir: null })
    expect(getLayout({}, { isPackaged: true, resourcesPath: 'R', userDataPath: 'U', exists: no })).toEqual({ appsDir: null, shellDir: null, updatesDir: null })
  })
  it('takes the folders named by the environment', () => {
    expect(getLayout({ NEXUSMD_APPS_DIR: 'A', NEXUSMD_SHELL_DIR: 'S', NEXUSMD_APP_UPDATES_DIR: 'D' }, {}))
      .toEqual({ appsDir: 'A', shellDir: 'S', updatesDir: 'D' })
  })
  it('uses resources/apps and resources/renderer in an installed build that has an apps folder, and keeps app updates in userData/apps', () => {
    const layout = getLayout({}, { isPackaged: true, resourcesPath: path.join('R'), userDataPath: path.join('U'), exists: yes })
    expect(layout).toEqual({ appsDir: path.join('R', 'apps'), shellDir: path.join('R', 'renderer'), updatesDir: path.join('U', 'apps') })
  })
  it('lets the environment override an installed layout', () => {
    expect(getLayout({ NEXUSMD_APPS_DIR: 'A' }, { isPackaged: true, resourcesPath: 'R', exists: yes }).appsDir).toBe('A')
  })
  it('takes no app updates outside an installed build unless told where they are', () => {
    expect(getLayout({ NEXUSMD_APPS_DIR: 'A' }, { isPackaged: false, userDataPath: 'U' }).updatesDir).toBeNull()
  })
})

describe('scanApps', () => {
  let root
  const silent = { error: vi.fn() }
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-apps-')); silent.error.mockClear() })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  function makeApp(id, { manifest = { id, label: id }, renderer = true, main = false, css = [], rawManifest } = {}) {
    const dir = path.join(root, id)
    fs.mkdirSync(path.join(dir, 'renderer'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'app.manifest.json'), rawManifest ?? JSON.stringify(manifest))
    if (renderer) fs.writeFileSync(path.join(dir, 'renderer', 'index.js'), 'export default {}')
    for (const c of css) fs.writeFileSync(path.join(dir, 'renderer', c), 'a{}')
    if (main) { fs.mkdirSync(path.join(dir, 'main')); fs.writeFileSync(path.join(dir, 'main', 'index.cjs'), 'exports.register = () => ({})') }
    return dir
  }

  it('finds each app folder, with its manifest, code URL, stylesheets and main file', () => {
    makeApp('git', { main: true, css: ['style.css', 'extra.css'] })
    makeApp('notes')
    const apps = scanApps(root, { log: silent })
    expect(apps.map(a => a.id)).toEqual(['git', 'notes'])
    expect(apps[0]).toMatchObject({
      manifest: { id: 'git' },
      rendererUrl: pathToFileURL(path.join(root, 'git', 'renderer', 'index.js')).href,
      mainFile: path.join(root, 'git', 'main', 'index.cjs'),
    })
    expect(apps[0].styles).toEqual(['extra.css', 'style.css'].map(f => pathToFileURL(path.join(root, 'git', 'renderer', f)).href))
    expect(apps[1].mainFile).toBeNull()
    expect(apps[1].styles).toEqual([])
    expect(silent.error).not.toHaveBeenCalled()
  })

  it('skips, and says why, a folder that is not a usable app', () => {
    makeApp('good')
    makeApp('norenderer', { renderer: false })
    makeApp('wrongid', { manifest: { id: 'someone-else' } })
    makeApp('badjson', { rawManifest: '{nope' })
    fs.mkdirSync(path.join(root, 'nomanifest'))
    fs.writeFileSync(path.join(root, 'stray-file.txt'), 'x')
    fs.mkdirSync(path.join(root, 'Not-An-Id'))
    expect(scanApps(root, { log: silent }).map(a => a.id)).toEqual(['good'])
    const reasons = silent.error.mock.calls.map(c => c[0]).join('\n')
    expect(reasons).toMatch(/norenderer.*renderer\/index\.js/)
    expect(reasons).toMatch(/wrongid.*someone-else/)
    expect(reasons).toMatch(/badjson/)
    expect(reasons).toMatch(/nomanifest/)
  })

  it('finds nothing in a folder that does not exist', () => {
    expect(scanApps(path.join(root, 'missing'), { log: silent })).toEqual([])
  })

  it('builds the module table the registry uses, with a main only where there is one', () => {
    makeApp('git', { main: true })
    makeApp('notes')
    const table = modulesFromScan(scanApps(root, { log: silent }))
    expect(Object.keys(table)).toEqual(['git', 'notes'])
    expect(table.git.manifest().id).toBe('git')
    expect(typeof table.git.main().register).toBe('function')
    expect(table.notes.main).toBeNull()
  })

  it('tells the window which apps are installed, with what it needs to load them', () => {
    makeApp('git', { css: ['style.css'] })
    makeApp('notes')
    const scanned = scanApps(root, { log: silent })
    const info = getRegistryInfo({}, scanned)
    expect(info.installedIds).toEqual(['git', 'notes'])
    expect(info.split.apps.map(a => a.id)).toEqual(['git', 'notes'])
    expect(Object.keys(info.split.apps[0]).sort()).toEqual(['id', 'manifest', 'rendererUrl', 'styles'])   // no folder paths leak to the page
    expect(getRegistryInfo({ NEXUSMD_APPS: 'notes' }, scanned).installedIds).toEqual(['notes'])
    expect(getRegistryInfo({ NEXUSMD_APPS: 'notes' }, scanned).split.apps.map(a => a.id)).toEqual(['notes'])
  })

  it('does not load a switched-off app, but still names it so Settings can switch it back on', () => {
    makeApp('git')
    makeApp('notes')
    const scanned = scanApps(root, { log: silent })
    const info = getRegistryInfo({}, scanned, ['notes'])
    expect(info.installedIds).toEqual(['git', 'notes'])
    expect(info.disabledIds).toEqual(['notes'])
    expect(info.split.apps.map(a => a.id)).toEqual(['git'])
    expect(info.split.disabled.map(m => m.id)).toEqual(['notes'])
    // Every app off would leave the window empty, so then all of them run.
    const all = getRegistryInfo({}, scanned, ['git', 'notes'])
    expect(all.split.apps.map(a => a.id)).toEqual(['git', 'notes'])
    expect(all.disabledIds).toEqual([])
  })

  it('exposes only the installed apps\' preload bridge, whatever else is on disk', () => {
    makeApp('git', { manifest: { id: 'git', ipc: { preload: { git: { status: { invoke: 'git:status' } } } } } })
    makeApp('db', { manifest: { id: 'db', ipc: { preload: { db: { q: { invoke: 'db:q' } } } } } })
    const table = modulesFromScan(scanApps(root, { log: silent }))
    expect(Object.keys(getPreloadDescriptors({}, table)).sort()).toEqual(['db', 'git'])
    expect(Object.keys(getPreloadDescriptors({ NEXUSMD_APPS: 'git' }, table))).toEqual(['git'])
  })

  it('starts the main side of the apps that have one, and nothing for the rest', () => {
    makeApp('git', { main: true })
    makeApp('notes')
    const table = modulesFromScan(scanApps(root, { log: silent }))
    const started = registerModules({}, {}, table, silent)
    expect(silent.error).not.toHaveBeenCalled()
    return expect(started.disposeAll()).resolves.toBeDefined()
  })
})

describe('compareVersions', () => {
  it('orders versions by number, part by part', () => {
    expect(compareVersions('1.2.10', '1.2.9')).toBeGreaterThan(0)
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('2.0.0', '10.0.0')).toBeLessThan(0)
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })
  it('counts a missing version as older than any other', () => {
    expect(compareVersions('0.0.1', undefined)).toBeGreaterThan(0)
    expect(compareVersions(null, undefined)).toBe(0)
  })
})

// --------------------------------------------------------------------------------------------
// App updates: newer versions of an installed app, downloaded beside the installed folders.
// --------------------------------------------------------------------------------------------
describe('resolveApps', () => {
  let root, installedDir, updatesDir
  const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-updates-'))
    installedDir = path.join(root, 'installed')
    updatesDir = path.join(root, 'updates')
    fs.mkdirSync(installedDir)
    fs.mkdirSync(updatesDir)
    for (const fn of Object.values(log)) fn.mockClear()
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  function writeApp(dir, manifest, { main = false } = {}) {
    fs.mkdirSync(path.join(dir, 'renderer'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'app.manifest.json'), JSON.stringify(manifest))
    fs.writeFileSync(path.join(dir, 'renderer', 'index.js'), 'export default {}')
    if (main) { fs.mkdirSync(path.join(dir, 'main')); fs.writeFileSync(path.join(dir, 'main', 'index.cjs'), 'exports.register = () => ({})') }
    return dir
  }
  const installed = (id, version, extra = {}) => writeApp(path.join(installedDir, id), { id, version, ...extra })
  const downloaded = (id, version, extra = {}, opts) => writeApp(path.join(updatesDir, id, version), { id, version, ...extra }, opts)
  const writeState = state => fs.writeFileSync(path.join(updatesDir, 'state.json'), typeof state === 'string' ? state : JSON.stringify(state))
  const resolve = (opts = {}) => resolveApps(installedDir, { updatesDir, shellApi: 2, log, ...opts })

  it('is the installed apps when there is nowhere for updates', () => {
    installed('git', '1.0.0')
    downloaded('git', '1.1.0')
    expect(resolve({ updatesDir: null }).map(a => [a.id, a.version])).toEqual([['git', '1.0.0']])
  })

  it('runs the newest downloaded version of an installed app, from its own folder', () => {
    installed('git', '1.0.0', { requires: { shellApi: 1 } })
    installed('notes', '1.0.0')
    downloaded('git', '1.0.1')
    downloaded('git', '1.2.0', { requires: { shellApi: 2 } }, { main: true })
    const apps = resolve()
    expect(apps.map(a => [a.id, a.version, a.installedVersion])).toEqual([['git', '1.2.0', '1.0.0'], ['notes', '1.0.0', '1.0.0']])
    const dir = path.join(updatesDir, 'git', '1.2.0')
    expect(apps[0]).toMatchObject({
      dir,
      rendererUrl: pathToFileURL(path.join(dir, 'renderer', 'index.js')).href,
      mainFile: path.join(dir, 'main', 'index.cjs'),
    })
    expect(log.info).toHaveBeenCalledWith(expect.stringMatching(/git.*1\.2\.0.*1\.0\.0/))
  })

  it('keeps the installed version when no download is newer', () => {
    installed('git', '1.2.0')
    downloaded('git', '1.1.0')
    downloaded('git', '1.2.0')
    expect(resolve()[0].dir).toBe(path.join(installedDir, 'git'))
  })

  it('treats an installed app with no version as older than any download', () => {
    installed('git', undefined)
    downloaded('git', '0.0.1')
    expect(resolve()[0].version).toBe('0.0.1')
  })

  it('skips, and says why, a version that needs a newer shell, falling back to the next newest', () => {
    installed('git', '1.0.0')
    downloaded('git', '1.1.0', { requires: { shellApi: 2 } })
    downloaded('git', '2.0.0', { requires: { shellApi: 3 } })
    expect(resolve()[0].version).toBe('1.1.0')
    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/git.*2\.0\.0.*shell/))
  })

  it('skips a version marked bad', () => {
    installed('git', '1.0.0')
    downloaded('git', '1.1.0')
    downloaded('git', '1.2.0')
    writeState({ apps: { git: { bad: ['1.2.0'] } } })
    expect(resolve()[0].version).toBe('1.1.0')
  })

  it('reads an unreadable state file as empty, and says so', () => {
    installed('git', '1.0.0')
    downloaded('git', '1.1.0')
    writeState('{nope')
    expect(resolve()[0].version).toBe('1.1.0')
    expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/state\.json/))
  })

  it('skips a download that is not a usable app, or is not the version its folder says', () => {
    installed('git', '1.0.0')
    downloaded('git', '1.1.0')
    downloaded('git', '1.3.0', { version: '1.9.9' })
    fs.mkdirSync(path.join(updatesDir, 'git', '1.4.0'))
    writeApp(path.join(updatesDir, 'git', '.tmp-1.5.0'), { id: 'git', version: '1.5.0' })
    expect(resolve()[0].version).toBe('1.1.0')
    const reasons = log.error.mock.calls.map(c => c[0]).join('\n')
    expect(reasons).toMatch(/1\.3\.0.*1\.9\.9/)
    expect(reasons).toMatch(/1\.4\.0/)
    expect(reasons).not.toMatch(/\.tmp-/)
  })

  it('never starts an app that is only downloaded, not installed', () => {
    installed('git', '1.0.0')
    downloaded('notes', '1.0.0')
    expect(resolve().map(a => a.id)).toEqual(['git'])
  })
})
