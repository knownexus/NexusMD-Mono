import { describe, it, expect, beforeEach } from 'vitest'
import { createSecureStorageAdapter, bytesToBase64, base64ToBytes } from '../src/index.js'

const helm    = createSecureStorageAdapter({ encPrefix: 'helm.sec.',    dbName: 'helm-keystore' })
const nexusmd = createSecureStorageAdapter({ encPrefix: 'nexusmd.sec.', dbName: 'nexusmd-keystore' })

describe('createSecureStorageAdapter (namespace wiring)', () => {
  beforeEach(() => localStorage.clear())

  it('get returns null when nothing is stored (no crypto touched)', async () => {
    expect(await helm.get('missing')).toBe(null)
  })

  it('remove targets the prefixed key and leaves other namespaces untouched', async () => {
    localStorage.setItem('helm.sec.x', 'cipher-a')
    localStorage.setItem('nexusmd.sec.x', 'cipher-b')
    await helm.remove('x')
    expect(localStorage.getItem('helm.sec.x')).toBe(null)        // removed
    expect(localStorage.getItem('nexusmd.sec.x')).toBe('cipher-b') // untouched
  })

  it('exposes the get/set/remove contract', () => {
    for (const m of ['get', 'set', 'remove']) expect(typeof helm[m]).toBe('function')
  })
})

describe('base64 helpers (no spread, large-input safe)', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 200, 255, 65, 66])
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes])
  })

  it('matches the old spread-based encoding for small inputs', () => {
    const bytes = new Uint8Array([0, 12, 200, 255, 9, 33])
    expect(bytesToBase64(bytes)).toBe(btoa(String.fromCharCode(...bytes)))
  })

  it('does not throw on a buffer large enough to overflow a spread call, and still round-trips', () => {
    const big = new Uint8Array(200000)
    for (let i = 0; i < big.length; i++) big[i] = i % 256
    expect(() => bytesToBase64(big)).not.toThrow()
    expect([...base64ToBytes(bytesToBase64(big))]).toEqual([...big])
  })
})
