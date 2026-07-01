// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { startLoopback } from './loopback.cjs'

describe('startLoopback', () => {
  it('resolves the code when state matches', async () => {
    const h = await startLoopback()
    const p = h.waitForCode({ state: 'xyz', timeoutMs: 2000 })
    await fetch(`http://127.0.0.1:${h.port}/?code=abc&state=xyz`)
    expect(await p).toBe('abc')
    h.close()
  })

  it('rejects on state mismatch', async () => {
    const h = await startLoopback()
    const p = h.waitForCode({ state: 'xyz', timeoutMs: 2000 })
    const assertion = expect(p).rejects.toThrow(/state mismatch/)  // attach handler before triggering rejection
    await fetch(`http://127.0.0.1:${h.port}/?code=abc&state=WRONG`)
    await assertion
    h.close()
  })

  it('ignores stray requests with no code/error (e.g. favicon) and still resolves the real redirect', async () => {
    const h = await startLoopback()
    const p = h.waitForCode({ state: 'xyz', timeoutMs: 2000 })
    const stray = await fetch(`http://127.0.0.1:${h.port}/favicon.ico`)
    expect(stray.status).toBe(204)          // stray request ignored, not consumed
    await fetch(`http://127.0.0.1:${h.port}/?code=abc&state=xyz`)
    expect(await p).toBe('abc')             // real redirect still resolves
    h.close()
  })

  it('rejects when the provider returns an error', async () => {
    const h = await startLoopback()
    const p = h.waitForCode({ state: 'xyz', timeoutMs: 2000 })
    const assertion = expect(p).rejects.toThrow(/access_denied/)  // attach handler before triggering rejection
    await fetch(`http://127.0.0.1:${h.port}/?error=access_denied&state=xyz`)
    await assertion
    h.close()
  })
})
