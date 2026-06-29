import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeGoogleDriveProvider, makeOneDriveProvider } from '../src/index.js'

function authStub(token = 'tok') {
  return {
    isConnected: () => true,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    getToken: vi.fn(async () => token),
  }
}

// Build a fetch mock that matches by URL substring → { status, json|text }.
function fetchRouter(routes) {
  return vi.fn(async (url, opts) => {
    for (const r of routes) {
      if (url.includes(r.match) && (!r.method || (opts?.method || 'GET') === r.method)) {
        return {
          ok: (r.status ?? 200) < 400,
          status: r.status ?? 200,
          json: async () => r.json ?? {},
          text: async () => r.text ?? '',
        }
      }
    }
    throw new Error('unexpected fetch: ' + (opts?.method || 'GET') + ' ' + url)
  })
}

describe('makeGoogleDriveProvider', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('lists .nmdprofile files in /NexusMD (creating the folder if missing)', async () => {
    global.fetch = fetchRouter([
      // folder lookup → none found
      { match: "drive/v3/files?q=name%3D'NexusMD'", json: { files: [] } },
      // folder create
      { match: 'drive/v3/files', method: 'POST', json: { id: 'FID' } },
      // children list
      { match: "'FID'%20in%20parents", json: { files: [
        { id: 'a', name: 'nexusmd-backup-2026-06-29.nmdprofile', modifiedTime: '2026-06-29T10:00:00Z' },
      ] } },
    ])
    const p = makeGoogleDriveProvider(authStub())
    const list = await p.list()
    expect(list).toEqual([
      { id: 'a', name: 'nexusmd-backup-2026-06-29.nmdprofile', modifiedAt: '2026-06-29T10:00:00Z' },
    ])
  })

  it('downloads a file body as text', async () => {
    global.fetch = fetchRouter([{ match: 'files/a?alt=media', text: 'CIPHERTEXT' }])
    const p = makeGoogleDriveProvider(authStub())
    expect(await p.download('a')).toBe('CIPHERTEXT')
  })

  it('refreshes the token once on 401 then retries', async () => {
    const auth = authStub('stale')
    let calls = 0
    global.fetch = vi.fn(async (url) => {
      calls++
      if (calls === 1) return { ok: false, status: 401, json: async () => ({}), text: async () => '' }
      return { ok: true, status: 200, text: async () => 'OK', json: async () => ({}) }
    })
    const p = makeGoogleDriveProvider(auth)
    expect(await p.download('a')).toBe('OK')
    expect(auth.getToken).toHaveBeenCalledWith({ force: true })
  })
})

describe('makeOneDriveProvider', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('lists .nmdprofile files in /NexusMD', async () => {
    global.fetch = fetchRouter([
      { match: 'root:/NexusMD:/children', json: { value: [
        { id: 'x', name: 'nexusmd-profile-work.nmdprofile', lastModifiedDateTime: '2026-06-28T09:00:00Z' },
        { id: 'y', name: 'notes.txt', lastModifiedDateTime: '2026-06-28T09:00:00Z' },
      ] } },
    ])
    const p = makeOneDriveProvider(authStub())
    expect(await p.list()).toEqual([
      { id: 'x', name: 'nexusmd-profile-work.nmdprofile', modifiedAt: '2026-06-28T09:00:00Z' },
    ])
  })

  it('uploads by path (create-or-overwrite)', async () => {
    const calls = []
    global.fetch = vi.fn(async (url, opts) => {
      calls.push({ url, method: opts?.method })
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' }
    })
    const p = makeOneDriveProvider(authStub())
    await p.upload('nexusmd-backup-2026-06-29.nmdprofile', 'CIPHER')
    expect(calls[0].method).toBe('PUT')
    expect(calls[0].url).toContain("root:/NexusMD/nexusmd-backup-2026-06-29.nmdprofile:/content")
  })

  it('downloads item content as text', async () => {
    global.fetch = fetchRouter([{ match: 'items/x/content', text: 'CIPHER' }])
    const p = makeOneDriveProvider(authStub())
    expect(await p.download('x')).toBe('CIPHER')
  })
})
