import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeGoogleDriveProvider, makeOneDriveProvider } from '../src/index.js'

function authStub() {
  return { isConnected: () => true, connect: vi.fn(), disconnect: vi.fn(), getToken: vi.fn(async () => 'tok') }
}

describe('Google Drive object-store', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('listNames returns names+modifiedAt filtered by prefix', async () => {
    global.fetch = vi.fn(async (url) => {
      if (url.includes("name%3D'NexusMD'")) return { ok: true, status: 200, json: async () => ({ files: [{ id: 'F' }] }) }
      return { ok: true, status: 200, json: async () => ({ files: [
        { id: '1', name: 'nmdsync__p1__manifest.json', modifiedTime: 'T1' },
        { id: '2', name: 'nmdsync__p1__planner__2026-W26.nmdsync', modifiedTime: 'T2' },
        { id: '3', name: 'other.txt', modifiedTime: 'T3' },
      ] }) }
    })
    const p = makeGoogleDriveProvider(authStub())
    const names = await p.listNames('nmdsync__p1__')
    expect(names.map(n => n.name).sort()).toEqual(['nmdsync__p1__manifest.json', 'nmdsync__p1__planner__2026-W26.nmdsync'])
  })

  it('getText returns null when the named file is absent', async () => {
    global.fetch = vi.fn(async (url) => {
      if (url.includes("name%3D'NexusMD'")) return { ok: true, status: 200, json: async () => ({ files: [{ id: 'F' }] }) }
      return { ok: true, status: 200, json: async () => ({ files: [] }) }
    })
    const p = makeGoogleDriveProvider(authStub())
    expect(await p.getText('nmdsync__p1__manifest.json')).toBeNull()
  })
})

describe('OneDrive object-store', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('getText returns content for a path-addressed file', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => 'CIPHER', json: async () => ({}) }))
    const p = makeOneDriveProvider(authStub())
    expect(await p.getText('nmdsync__p1__manifest.json')).toBe('CIPHER')
  })

  it('getText returns null on 404', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 404, text: async () => '', json: async () => ({}) }))
    const p = makeOneDriveProvider(authStub())
    expect(await p.getText('nope.nmdsync')).toBeNull()
  })
})
