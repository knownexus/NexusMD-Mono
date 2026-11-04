import { describe, it, expect, vi } from 'vitest'
import { createSecretCache } from '../../src/modules/profiles/secret-cache.js'
import * as core from '../../src/index.js'

const backend = (init = {}) => {
  const m = new Map(Object.entries(init))
  return {
    _m: m,
    get: vi.fn(async (k) => (m.has(k) ? m.get(k) : null)),
    set: vi.fn(async (k, v) => { m.set(k, v) }),
    remove: vi.fn(async (k) => { m.delete(k) }),
  }
}

describe('createSecretCache', () => {
  it('is exported from @nexusmd/core', () => expect(core.createSecretCache).toBe(createSecretCache))

  it('peek is null until a name is loaded, then answers synchronously', async () => {
    const b = backend({ a: '1' })
    const c = createSecretCache(b)
    expect(c.peek('a')).toBeNull()
    await c.load(['a', 'missing'])
    expect(c.peek('a')).toBe('1')
    expect(c.peek('missing')).toBeNull()
  })

  it('set and remove update the cache at once and reach the backend', async () => {
    const b = backend()
    const c = createSecretCache(b)
    const p = c.set('t', 'v')
    expect(c.peek('t')).toBe('v')
    await p
    expect(b._m.get('t')).toBe('v')
    await c.remove('t')
    expect(c.peek('t')).toBeNull()
    expect(b._m.has('t')).toBe(false)
  })

  it('get reads the backend and refreshes the cache (what another writer saved is seen)', async () => {
    const b = backend({ t: 'old' })
    const c = createSecretCache(b)
    await c.load(['t'])
    b._m.set('t', 'new')
    expect(await c.get('t')).toBe('new')
    expect(c.peek('t')).toBe('new')
  })

  it('works in memory with no backend bound, and bind() attaches one later', async () => {
    const c = createSecretCache()
    await c.set('x', '1')
    expect(c.peek('x')).toBe('1')
    expect(await c.get('x')).toBe('1')
    const b = backend({ y: '2' })
    c.bind(b)
    expect(await c.get('y')).toBe('2')
  })
})
