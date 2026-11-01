import { describe, it, expect } from 'vitest'
import { loadAdoData } from './loader.js'

// Answers every request with an empty but valid body, and remembers what was asked.
function fakeHttp() {
  const paths = []
  return {
    paths,
    fetch: async (path) => {
      paths.push(path)
      return { ok: true, status: 200, json: async () => ({ value: [], workItems: [] }) }
    },
  }
}

const memStorage = () => {
  const m = new Map()
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }
}
const config = { org: 'acme', projects: ['Web'] }

describe('loadAdoData skip', () => {
  it('fetches pull requests, builds and tests by default', async () => {
    const http = fakeHttp()
    await loadAdoData(config, { http, storage: memStorage() })
    expect(http.paths.some(p => p.includes('/_apis/git/repositories'))).toBe(true)
    expect(http.paths.some(p => p.includes('/_apis/build/builds?$top=15'))).toBe(true)
    expect(http.paths.some(p => p.includes('queryOrder=queueTimeDescending'))).toBe(true)
  })

  it('asks nothing for the switched-off screens, and returns them empty', async () => {
    const http = fakeHttp()
    const data = await loadAdoData(config, { http, storage: memStorage() }, { skip: { prs: true, builds: true, tests: true } })
    expect(http.paths.some(p => p.includes('/_apis/git/repositories'))).toBe(false)
    expect(http.paths.some(p => p.includes('/_apis/build/builds'))).toBe(false)
    expect(data.PRS).toEqual([])
    expect(data.BUILDS).toEqual([])
    expect(data.TESTS).toEqual([])
    // The rest of Work still loads: the work-item query ran.
    expect(http.paths.some(p => p.includes('/_apis/wit/wiql'))).toBe(true)
  })

  it('skips only what it is told to', async () => {
    const http = fakeHttp()
    await loadAdoData(config, { http, storage: memStorage() }, { skip: { builds: true } })
    expect(http.paths.some(p => p.includes('/_apis/git/repositories'))).toBe(true)
    expect(http.paths.some(p => p.includes('/_apis/build/builds?$top=15'))).toBe(false)
    expect(http.paths.some(p => p.includes('queryOrder=queueTimeDescending'))).toBe(true)
  })
})

describe('loadAdoData when Azure DevOps cannot be reached', () => {
  it('throws and leaves the cached data alone instead of saving an empty load', async () => {
    const storage = memStorage()
    storage.set = undefined
    const writes = []
    const store = { get: () => null, set: (k, v) => writes.push([k, v]) }
    const down = { fetch: async () => { throw new Error('Network request failed') } }
    await expect(loadAdoData(config, { http: down, storage: store }, { isRefresh: true })).rejects.toThrow(/Network/)
    expect(writes).toEqual([])
  })

  it('still saves when some requests succeed', async () => {
    const writes = []
    const store = { get: () => null, set: (k, v) => writes.push([k, v]) }
    await loadAdoData(config, { http: fakeHttp(), storage: store })
    expect(writes.length).toBe(1)
  })
})
