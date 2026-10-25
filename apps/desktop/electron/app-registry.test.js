// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { parseInstalledIds, getRegistryInfo, register } from './app-registry.cjs'

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

describe('registry:get', () => {
  it('replies synchronously with the installed ids', () => {
    const ipcMain = { on: vi.fn() }
    register(ipcMain, { NEXUSMD_APPS: 'git' })
    expect(ipcMain.on).toHaveBeenCalledWith('registry:get', expect.any(Function))
    const event = {}
    ipcMain.on.mock.calls[0][1](event)
    expect(event.returnValue).toEqual({ installedIds: ['git'] })
  })
  it('reports null (all apps) by default', () => {
    expect(getRegistryInfo({})).toEqual({ installedIds: null })
  })
})
