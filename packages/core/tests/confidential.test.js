import { describe, it, expect } from 'vitest'
import {
  hashPassword, encryptConfidentialForServer, decryptConfidentialFromServer,
} from '../src/index.js'

describe('confidential AES-GCM crypto', () => {
  it('hashPassword is deterministic, salted, and lowercase-hex SHA-256', async () => {
    const a = await hashPassword('hunter2')
    const b = await hashPassword('hunter2')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    // Salt matters — a different password yields a different hash.
    expect(await hashPassword('hunter3')).not.toBe(a)
  })

  it('encrypt → decrypt round-trips an arbitrary config object', async () => {
    const cfg = { sections: ['teamNotes', 'oneOnOnes'], hash: 'x', meta: { n: 3 } }
    const hash = await hashPassword('s3cret')
    const enc = await encryptConfidentialForServer(cfg, hash)
    expect(enc).toHaveProperty('iv')
    expect(enc).toHaveProperty('ciphertext')
    expect(typeof enc.iv).toBe('string')
    const out = await decryptConfidentialFromServer(enc, hash)
    expect(out).toEqual(cfg)
  })

  it('a fresh IV is generated per encryption (no nonce reuse)', async () => {
    const hash = await hashPassword('s3cret')
    const a = await encryptConfidentialForServer({ sections: [] }, hash)
    const b = await encryptConfidentialForServer({ sections: [] }, hash)
    expect(a.iv).not.toBe(b.iv)
  })

  it('decryption with the wrong password hash rejects (GCM auth fails)', async () => {
    const enc = await encryptConfidentialForServer({ sections: ['a'] }, await hashPassword('right'))
    await expect(decryptConfidentialFromServer(enc, await hashPassword('wrong'))).rejects.toThrow()
  })
})
