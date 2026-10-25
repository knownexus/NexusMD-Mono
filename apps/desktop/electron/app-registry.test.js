// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import {
  parseInstalledIds, getRegistryInfo, installedModuleIds, getPreloadDescriptors, register, registerModules, MODULES,
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
    expect(get.returnValue).toEqual({ installedIds: ['git'] })
    const pre = {}; handlers['registry:preload-descriptors'](pre)
    expect(pre.returnValue.git.status).toEqual({ invoke: 'git:status' })
    expect(pre.returnValue.popout.open).toEqual({ invoke: 'popout:open' })
  })
  it('reports null (all apps) by default', () => {
    expect(getRegistryInfo({})).toEqual({ installedIds: null })
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
  it('exposes nothing when none of the split-out apps are installed', () => {
    expect(getPreloadDescriptors({ NEXUSMD_APPS: 'planner' }, modules)).toEqual({})
  })
  it('knows the real split-out apps', () => {
    expect(Object.keys(MODULES)).toEqual(expect.arrayContaining(['git', 'devenv', 'database', 'api-client']))
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
