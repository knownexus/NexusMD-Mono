// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'
import { startShipper } from './shipper.js'

const nxt = createRequire(import.meta.url)('../../../trace/src/runtime.js')
beforeEach(() => { vi.useFakeTimers(); nxt.start({ proc: 'renderer', win: 1 }); nxt.drain() })
afterEach(() => { vi.useRealTimers(); nxt.stop(); nxt.drain() })
const call = (name) => { const f = nxt.enter(`a.js:1:0:${name}`, null, []); nxt.ret(f, 0) }

describe('startShipper', () => {
  it('sends what the runtime has collected every interval, and nothing when there is nothing', () => {
    const send = vi.fn()
    const stop = startShipper({ send, everyMs: 100 })
    vi.advanceTimersByTime(100)
    expect(send).not.toHaveBeenCalled()
    call('one')
    vi.advanceTimersByTime(100)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].filter(e => e.k === 'enter').map(e => e.fn)).toEqual(['a.js:1:0:one'])
    stop()
  })

  it('sends a last batch on stop and then stays quiet', () => {
    const send = vi.fn()
    const stop = startShipper({ send, everyMs: 1000 })
    call('late')
    stop()
    expect(send).toHaveBeenCalledTimes(1)
    call('after'); vi.advanceTimersByTime(5000)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('flush() sends what is there now, so a call can follow its parent to the main process in order', () => {
    const send = vi.fn()
    const stop = startShipper({ send, everyMs: 10_000 })
    call('parent')
    stop.flush()
    expect(send).toHaveBeenCalledTimes(1)
    stop()
  })

  it('a send that throws does not stop the shipping', () => {
    const send = vi.fn().mockImplementationOnce(() => { throw new Error('bridge gone') }).mockImplementation(() => {})
    const stop = startShipper({ send, everyMs: 100 })
    call('one'); vi.advanceTimersByTime(100)
    call('two'); vi.advanceTimersByTime(100)
    expect(send).toHaveBeenCalledTimes(2)
    stop()
  })
})
