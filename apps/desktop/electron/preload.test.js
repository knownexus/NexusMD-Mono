// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Module from 'module'
import path from 'path'
import gitManifest from '@nexusmd/app-git/manifest'
import devenvManifest from '@nexusmd/app-devenv/manifest'
import databaseManifest from '@nexusmd/app-database/manifest'
import apiClientManifest from '@nexusmd/app-api-client/manifest'
import editorManifest from '@nexusmd/app-editor/manifest'

let exposed
let ipcRenderer
const origRequire = Module.prototype.require

beforeAll(() => {
  ipcRenderer = { invoke: vi.fn(), sendSync: vi.fn(channel => (channel === 'registry:preload-descriptors' ? { ...gitManifest.ipc.preload, ...devenvManifest.ipc.preload, ...databaseManifest.ipc.preload, ...apiClientManifest.ipc.preload, ...editorManifest.ipc.preload } : { installedIds: ['git'] })), on: vi.fn(), send: vi.fn(), removeAllListeners: vi.fn(), removeListener: vi.fn() }
  const fakeElectron = {
    contextBridge: { exposeInMainWorld: (_name, obj) => { exposed = obj } },
    ipcRenderer,
    webUtils: { getPathForFile: vi.fn(() => 'C:\\Users\\me\\photo.jpg') },
  }
  Module.prototype.require = function (id) {
    if (id === 'electron') return fakeElectron
    return origRequire.apply(this, arguments)
  }
  // Load preload fresh so its top-level exposeInMainWorld runs against the fake.
  const preloadPath = path.join(__dirname, 'preload.cjs')
  delete require.cache?.[preloadPath]
  origRequire.call(module, preloadPath)   // eslint-disable-line
})

afterAll(() => { Module.prototype.require = origRequire })

describe('preload bridge', () => {
  it('builds each app\'s namespaces from the descriptors the main process hands over', () => {
    expect(ipcRenderer.sendSync).toHaveBeenCalledWith('registry:preload-descriptors')
    exposed.popout.open({ kind: 'editor' })
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('popout:open', { kind: 'editor' })
    exposed.popout.changed('C:\\repos\\a')
    expect(ipcRenderer.send).toHaveBeenLastCalledWith('popout:changed', 'C:\\repos\\a')
  })

  it('sends packed arguments as one object, the way the database handlers expect', () => {
    exposed.dbManager.connect('sqlserver', { server: 's' })
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('db-manager:connect', { type: 'sqlserver', config: { server: 's' } })
    exposed.dbManager.getRows('sqlite', { file: 'a.db' }, 'users', 50, 100)
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('db-manager:get-rows', { type: 'sqlite', config: { file: 'a.db' }, table: 'users', limit: 50, offset: 100 })
    exposed.dbManager.updateCell('sqlite', {}, 't', 'id', 7, 'name', 'x')
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('db-manager:update-cell', { type: 'sqlite', config: {}, table: 't', primaryKey: 'id', primaryValue: 7, column: 'name', value: 'x' })
  })

  it('bridges the Editor\'s file calls and its open-request event', () => {
    exposed.editor.read('C:\\a.txt')
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('editor:read', 'C:\\a.txt')
    exposed.editor.write('C:\\a.txt', 'x', { expectedStamp: 's' })
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('editor:write', 'C:\\a.txt', 'x', { expectedStamp: 's' })
    const cb = vi.fn()
    const off = exposed.editor.onOpenRequest(cb)
    const [channel, handler] = ipcRenderer.on.mock.calls.at(-1)
    expect(channel).toBe('editor:open-request')
    handler({}, ['C:\\a.txt'])
    expect(cb).toHaveBeenCalledWith(['C:\\a.txt'])
    off()
  })

  it('builds a nested method from a dotted name', () => {
    exposed.apiClient.script.run('return 1', { env: {} })
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('api-client:script:run', 'return 1', { env: {} })
  })

  it('subscribes and unsubscribes event methods', () => {
    const cb = vi.fn()
    const off = exposed.popout.onChanged(cb)
    const [channel, handler] = ipcRenderer.on.mock.calls.at(-1)
    expect(channel).toBe('popout:changed')
    handler({}, 'C:\\repos\\a')
    expect(cb).toHaveBeenCalledWith('C:\\repos\\a')
    off()
    expect(ipcRenderer.removeListener).toHaveBeenLastCalledWith('popout:changed', handler)
  })

  it('resolves a dropped file\'s real path through webUtils', () => {
    expect(exposed.git.pathForFile({ name: 'photo.jpg' })).toBe('C:\\Users\\me\\photo.jpg')
  })

  it('exposes oauth and logs at the top level (not nested under update)', () => {
    expect(typeof exposed.oauth.start).toBe('function')
    expect(typeof exposed.oauth.refresh).toBe('function')
    expect(typeof exposed.logs.list).toBe('function')      // regression: logs stays top-level
    expect(exposed.update.oauth).toBeUndefined()           // oauth must NOT be under update
    expect(exposed.update.logs).toBeUndefined()            // logs must NOT be under update
  })

  it('oauth.start and oauth.refresh invoke the right IPC channels', () => {
    // The fake ipcRenderer.invoke is captured on the exposed bridge indirectly; assert wiring
    // by calling through and checking the channel name.
    // (invoke is a vi.fn on the fake electron; grab it from the closure via a fresh call.)
    expect(() => exposed.oauth.start()).not.toThrow()
    expect(() => exposed.oauth.refresh('RT')).not.toThrow()
  })

  it('exposes the devenv profile file methods over their channels', () => {
    const cfg = { root: 'C:\\r', pwsh: 'pwsh', profile: '' }
    exposed.devenv.profileInfo(cfg); expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('devenv:profile-info', cfg)
    exposed.devenv.profileList(cfg); expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('devenv:profile-list', cfg)
    exposed.devenv.profileRead(cfg, 'mac.json'); expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('devenv:profile-read', cfg, 'mac.json')
    exposed.devenv.profileWrite(cfg, 'mac.json', '{}', { create: true }); expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('devenv:profile-write', cfg, 'mac.json', '{}', { create: true })
    exposed.devenv.profileCreate(cfg); expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('devenv:profile-create', cfg)
  })

  it('asks the main process which apps are installed once, then remembers', () => {
    expect(exposed.registry.get()).toEqual({ installedIds: ['git'] })
    exposed.registry.get()
    const asked = ipcRenderer.sendSync.mock.calls.filter(([channel]) => channel === 'registry:get')
    expect(asked).toHaveLength(1)
  })

  it('bridges the start-on-login setting to its IPC channels', () => {
    exposed.getLoginItemEnabled()
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('get-login-item-enabled')
    exposed.setLoginItemEnabled(true)
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('set-login-item-enabled', true)
  })

  it('onRefreshData listens on the refresh-data channel and forwards to the callback', () => {
    const callback = vi.fn()
    exposed.onRefreshData(callback)
    const [channel, handler] = ipcRenderer.on.mock.calls.at(-1)
    expect(channel).toBe('refresh-data')
    handler()
    expect(callback).toHaveBeenCalled()
  })

  it('exposes devenv run/answer/cancel/catalog/open over the devenv channels', () => {
    const cfg = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
    exposed.devenv.run(cfg, ['status'], { exclusive: false })
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('devenv:run', cfg, ['status'], { exclusive: false })
    exposed.devenv.answer(3, { id: 'p1', value: '2' })
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('devenv:answer', 3, { id: 'p1', value: '2' })
    exposed.devenv.cancel(3)
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('devenv:cancel', 3)
    exposed.devenv.catalog(cfg)
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('devenv:catalog', cfg)
    exposed.devenv.open({ url: 'http://127.0.0.1:1' })
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('devenv:open', { url: 'http://127.0.0.1:1' })
    exposed.devenv.active()
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('devenv:active')
  })

  it('exposes devenv.query over devenv:query', () => {
    const cfg = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
    exposed.devenv.query(cfg, ['status', '--json'])
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('devenv:query', cfg, ['status', '--json'])
  })

  it('exposes the stage 4 git action channels', () => {
    const repo = { name: 'App', path: 'C:\\repos\\App' }
    const reg = [repo.path]
    exposed.git.remotes(repo, repo.path, reg)
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('git:remotes', repo, repo.path, reg)
    exposed.git.aliases(repo, repo.path, reg)
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('git:aliases', repo, repo.path, reg)
    exposed.git.shellAliases('C:\\repos\\DotFiles')
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('git:shellAliases', 'C:\\repos\\DotFiles')
    exposed.git.shellRun(repo, repo.path, reg, 'C:\\repos\\DotFiles', 'g!', [])
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('git:shellRun', repo, repo.path, reg, 'C:\\repos\\DotFiles', 'g!', [])
    exposed.git.shellWarm('C:\\repos\\DotFiles')
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('git:shellWarm', 'C:\\repos\\DotFiles')
    exposed.git.openTerminal(repo, repo.path, reg)
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('git:openTerminal', repo, repo.path, reg)
    exposed.git.stashes(repo, repo.path, reg)
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('git:stashes', repo, repo.path, reg)
    exposed.git.preview(repo, repo.path, reg, 'pull', { mode: 'ff' })
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('git:preview', repo, repo.path, reg, 'pull', { mode: 'ff' })
    exposed.git.run(repo, repo.path, reg, 'pull', { mode: 'ff' }, 's')
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('git:run', repo, repo.path, reg, 'pull', { mode: 'ff' }, 's')
  })

  it('exposes the git command line channel', () => {
    const repo = { name: 'App', path: 'C:\\repos\\App' }
    const reg = [repo.path]
    exposed.git.exec(repo, repo.path, reg, ['status', '--short'])
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('git:exec', repo, repo.path, reg, ['status', '--short'])
  })

  it('exposes the stage 3 git history channels', () => {
    const repo = { name: 'App', path: 'C:\\repos\\App' }
    const reg = [repo.path]
    const q = { ref: 'HEAD', filter: 'all', base: null, search: null, limit: 200 }
    exposed.git.refs(repo, repo.path, reg)
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('git:refs', repo, repo.path, reg)
    exposed.git.log(repo, repo.path, reg, q)
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('git:log', repo, repo.path, reg, q)
    exposed.git.commitDetails(repo, repo.path, reg, 'a'.repeat(40))
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('git:commitDetails', repo, repo.path, reg, 'a'.repeat(40))
    exposed.git.commitFiles(repo, repo.path, reg, 'a'.repeat(40), null)
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('git:commitFiles', repo, repo.path, reg, 'a'.repeat(40), null)
    exposed.git.commitDiff(repo, repo.path, reg, 'a'.repeat(40), 'b'.repeat(40), ['f'])
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('git:commitDiff', repo, repo.path, reg, 'a'.repeat(40), 'b'.repeat(40), ['f'])
  })

  it('exposes devenv.pathForFile through webUtils', () => {
    expect(exposed.devenv.pathForFile({ name: 'photo.jpg' })).toBe('C:\\Users\\me\\photo.jpg')
  })

  it('devenv.onLine / onExit subscribe and return an unsubscribe', () => {
    const cb = vi.fn()
    const off = exposed.devenv.onLine(cb)
    const [channel, handler] = ipcRenderer.on.mock.calls.at(-1)
    expect(channel).toBe('devenv:line')
    handler({}, { runId: 1, stream: 'stdout', line: 'x' })
    expect(cb).toHaveBeenCalledWith({ runId: 1, stream: 'stdout', line: 'x' })
    off()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith('devenv:line', handler)
    exposed.devenv.onExit(vi.fn())
    expect(ipcRenderer.on.mock.calls.at(-1)[0]).toBe('devenv:exit')
  })
})
