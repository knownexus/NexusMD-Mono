import { describe, it, expect } from 'vitest'
import { encodeBundle, decodeBundle, BUNDLE_EXT } from '../src/index.js'

const payload = {
  exportedBy: 'web', activeId: 'p1',
  profiles: [
    { id: 'p1', name: 'Work', initials: 'WK', color: '#000', type: 'manual', config: null,
      data: { 'planner.week.2026-W26': '{"x":1}', 'tweaks': '{"dark":true}' } },
    { id: 'p2', name: 'Home', initials: 'HM', color: '#111', type: 'ado', config: '{"org":"o"}', data: {} },
  ],
}

describe('profile bundle encode/decode', () => {
  it('round-trips one or many profiles through a password', async () => {
    const text = await encodeBundle(payload, 'hunter2')
    const out = await decodeBundle(text, 'hunter2')
    expect(out.profiles).toHaveLength(2)
    expect(out.profiles[0].data['planner.week.2026-W26']).toBe('{"x":1}')
    expect(out.activeId).toBe('p1')
    expect(out.format).toBe('nexusmd-profile-bundle')
  })

  it('the on-disk text is the encrypted wrapper (no plaintext leak)', async () => {
    const text = await encodeBundle(payload, 'hunter2')
    expect(text).toContain('nexusmd-profile-bundle-enc')
    expect(text).not.toContain('planner.week')   // payload is inside ciphertext
    expect(text).not.toContain('"Work"')
  })

  it('rejects the wrong password', async () => {
    const text = await encodeBundle(payload, 'right')
    await expect(decodeBundle(text, 'wrong')).rejects.toThrow()
  })

  it('rejects tampered ciphertext and non-bundle text', async () => {
    const text = await encodeBundle(payload, 'pw')
    const w = JSON.parse(text); w.ciphertext = 'AAAA' + w.ciphertext.slice(4)
    await expect(decodeBundle(JSON.stringify(w), 'pw')).rejects.toThrow()
    await expect(decodeBundle('{"not":"a bundle"}', 'pw')).rejects.toThrow()
    await expect(decodeBundle('not json', 'pw')).rejects.toThrow()
  })

  it('exposes the file extension', () => {
    expect(BUNDLE_EXT).toBe('.nmdprofile')
  })
})
