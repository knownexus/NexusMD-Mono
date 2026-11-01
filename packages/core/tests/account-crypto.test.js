import { describe, it, expect } from 'vitest'
import {
  MIN_ITERATIONS, randomSalt, deriveKeys,
  generateContainerKey, exportContainerKey, importContainerKey,
  wrapContainerKey, unwrapContainerKey,
  encryptJson, decryptJson, opaqueId,
  generateKeyPair, wrapPrivateKey, unwrapPrivateKey,
} from '../src/modules/account/crypto.js'
import * as core from '../src/index.js'

const ITER = 1000

function b64ToBytes(b64) {
  return Uint8Array.from(Buffer.from(b64, 'base64'))
}
function bytesToB64(bytes) {
  return Buffer.from(bytes).toString('base64')
}
function flipByte(b64, index) {
  const bytes = b64ToBytes(b64)
  bytes[index] ^= 0xff
  return bytesToB64(bytes)
}

describe('account crypto: constants and salt', () => {
  it('exports MIN_ITERATIONS = 600000', () => {
    expect(MIN_ITERATIONS).toBe(600000)
  })

  it('randomSalt returns 16 random bytes as base64', () => {
    const a = randomSalt()
    const b = randomSalt()
    expect(b64ToBytes(a).length).toBe(16)
    expect(a).not.toBe(b)
  })

  it('is re-exported from the core index', () => {
    expect(core.deriveKeys).toBe(deriveKeys)
    expect(core.MIN_ITERATIONS).toBe(600000)
  })
})

describe('account crypto: deriveKeys', () => {
  const salt = bytesToB64(new Uint8Array(16).fill(7))

  it('is deterministic for equal inputs', async () => {
    const a = await deriveKeys('correct horse', salt, ITER)
    const b = await deriveKeys('correct horse', salt, ITER)
    expect(a.authKey).toBe(b.authKey)
    const ck = await generateContainerKey()
    const wrapped = await wrapContainerKey(ck, a.vaultKey)
    const back = await unwrapContainerKey(wrapped, b.vaultKey)
    expect(exportContainerKey(back)).toBe(exportContainerKey(ck))
  })

  it('differs for a different password, salt or iteration count', async () => {
    const base = await deriveKeys('correct horse', salt, ITER)
    const pw = await deriveKeys('wrong horse', salt, ITER)
    const sl = await deriveKeys('correct horse', bytesToB64(new Uint8Array(16).fill(8)), ITER)
    const it2 = await deriveKeys('correct horse', salt, ITER + 1)
    expect(pw.authKey).not.toBe(base.authKey)
    expect(sl.authKey).not.toBe(base.authKey)
    expect(it2.authKey).not.toBe(base.authKey)
  })

  it('authKey is 32 bytes and the vault key is a separate non-extractable AES-GCM key', async () => {
    const { authKey, vaultKey } = await deriveKeys('pw', salt, ITER)
    expect(b64ToBytes(authKey).length).toBe(32)
    expect(vaultKey.algorithm.name).toBe('AES-GCM')
    expect(vaultKey.algorithm.length).toBe(256)
    expect(vaultKey.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', vaultKey)).rejects.toThrow()
  })

  it('vault key is not derivable from the auth key (different HKDF info)', async () => {
    // Using the auth key bytes as an AES key must not decrypt what the vault key encrypted.
    const { authKey, vaultKey } = await deriveKeys('pw', salt, ITER)
    const iv = new Uint8Array(12)
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, vaultKey, new Uint8Array([1, 2, 3]))
    const asKey = await crypto.subtle.importKey('raw', b64ToBytes(authKey), 'AES-GCM', false, ['decrypt'])
    await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv }, asKey, ct)).rejects.toThrow()
  })
})

describe('account crypto: container key', () => {
  const salt = randomSalt()

  it('round trips through export/import', async () => {
    const ck = await generateContainerKey()
    const ck2 = await importContainerKey(exportContainerKey(ck))
    expect(exportContainerKey(ck2)).toBe(exportContainerKey(ck))
    expect(b64ToBytes(exportContainerKey(ck)).length).toBe(32)
    const blob = await encryptJson({ a: 1 }, ck)
    expect(await decryptJson(blob, ck2)).toEqual({ a: 1 })
    expect(await opaqueId('x', ck)).toBe(await opaqueId('x', ck2))
  })

  it('round trips through wrap/unwrap', async () => {
    const { vaultKey } = await deriveKeys('pw', salt, ITER)
    const ck = await generateContainerKey()
    const wrapped = await wrapContainerKey(ck, vaultKey)
    expect(typeof wrapped).toBe('string')
    const back = await unwrapContainerKey(wrapped, vaultKey)
    expect(exportContainerKey(back)).toBe(exportContainerKey(ck))
  })

  it('fails to unwrap with a different password vault key', async () => {
    const a = await deriveKeys('pw-a', salt, ITER)
    const b = await deriveKeys('pw-b', salt, ITER)
    const ck = await generateContainerKey()
    const wrapped = await wrapContainerKey(ck, a.vaultKey)
    await expect(unwrapContainerKey(wrapped, b.vaultKey)).rejects.toThrow()
  })
})

describe('account crypto: encryptJson / decryptJson', () => {
  it('round trips and uses a random IV per call', async () => {
    const ck = await generateContainerKey()
    const value = { title: 'note', n: [1, 2, 3], nested: { ok: true } }
    const a = await encryptJson(value, ck)
    const b = await encryptJson(value, ck)
    expect(a).not.toBe(b)
    expect(await decryptJson(a, ck)).toEqual(value)
    expect(await decryptJson(b, ck)).toEqual(value)
  })

  it('throws after a byte is flipped (IV, ciphertext or tag)', async () => {
    const ck = await generateContainerKey()
    const blob = await encryptJson({ secret: 'x' }, ck)
    const len = b64ToBytes(blob).length
    for (const idx of [0, 13, len - 1]) {
      await expect(decryptJson(flipByte(blob, idx), ck)).rejects.toThrow()
    }
  })

  it('throws with the wrong key', async () => {
    const ck1 = await generateContainerKey()
    const ck2 = await generateContainerKey()
    const blob = await encryptJson('hello', ck1)
    await expect(decryptJson(blob, ck2)).rejects.toThrow()
  })
})

describe('account crypto: opaqueId', () => {
  it('is stable per (name, key), differs per key and name, and hides the name', async () => {
    const ck1 = await generateContainerKey()
    const ck2 = await generateContainerKey()
    const name = 'planner-week-2026-W44'
    const a = await opaqueId(name, ck1)
    expect(await opaqueId(name, ck1)).toBe(a)
    expect(await opaqueId(name, ck2)).not.toBe(a)
    expect(await opaqueId('other', ck1)).not.toBe(a)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(a.length).toBe(43)
    expect(a).not.toContain('planner')
    expect(a).not.toContain(name)
  })
})

describe('account crypto: key pair', () => {
  const ecdh = { name: 'ECDH', namedCurve: 'P-256' }

  it('generates an ECDH P-256 pair with an spki base64 public key', async () => {
    const { publicKey, privateKey } = await generateKeyPair()
    expect(typeof publicKey).toBe('string')
    const pub = await crypto.subtle.importKey('spki', b64ToBytes(publicKey), ecdh, true, [])
    expect(pub.algorithm.namedCurve).toBe('P-256')
    expect(privateKey.algorithm.name).toBe('ECDH')
  })

  it('wraps and unwraps the private key, and the result derives the same secret', async () => {
    const { vaultKey } = await deriveKeys('pw', randomSalt(), ITER)
    const { privateKey } = await generateKeyPair()
    const wrapped = await wrapPrivateKey(privateKey, vaultKey)
    const back = await unwrapPrivateKey(wrapped, vaultKey)
    expect(back.algorithm.name).toBe('ECDH')

    const peer = await crypto.subtle.generateKey(ecdh, true, ['deriveBits'])
    const s1 = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer.publicKey }, privateKey, 256)
    const s2 = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer.publicKey }, back, 256)
    expect(bytesToB64(new Uint8Array(s1))).toBe(bytesToB64(new Uint8Array(s2)))
  })

  it('fails to unwrap the private key with a different vault key', async () => {
    const a = await deriveKeys('pw-a', randomSalt(), ITER)
    const b = await deriveKeys('pw-b', randomSalt(), ITER)
    const { privateKey } = await generateKeyPair()
    const wrapped = await wrapPrivateKey(privateKey, a.vaultKey)
    await expect(unwrapPrivateKey(wrapped, b.vaultKey)).rejects.toThrow()
  })
})
