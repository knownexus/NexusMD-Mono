// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'
import { installWindowRecording } from './install.js'

const nxt = createRequire(import.meta.url)('../../../trace/src/runtime.js')
let off, api, stateCb
beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = '<nav><a aria-current="page">Pull Requests</a></nav><button>Merge</button>'
  stateCb = null
  api = { trace: { push: vi.fn(), state: vi.fn(() => ({ recording: false })), onState: vi.fn(cb => { stateCb = cb; return () => {} }), setContextProvider: vi.fn() } }
})
afterEach(() => { off?.(); off = undefined; vi.useRealTimers(); nxt.stop(); nxt.drain() })

describe('installWindowRecording', () => {
  it('does nothing outside the desktop app (no bridge)', () => {
    expect(() => { off = installWindowRecording({ api: undefined }) }).not.toThrow()
  })

  it('starts recording in this window when told to, with its own window id, and stops when told to', () => {
    off = installWindowRecording({ api, doc: document })
    stateCb({ recording: true, win: 4 })
    expect(nxt.on).toBe(true)
    const f = nxt.enter('a.js:1:0:f', null, []); nxt.ret(f, 0)
    expect(f.id).toMatch(/^r4-/)
    vi.advanceTimersByTime(600)
    expect(api.trace.push).toHaveBeenCalled()
    stateCb({ recording: false, win: 4 })
    expect(nxt.on).toBe(false)
  })

  it('starts at once when the window loads into a recording that is already running', () => {
    api.trace.state.mockReturnValue({ recording: true, win: 2 })
    off = installWindowRecording({ api, doc: document })
    expect(nxt.on).toBe(true)
  })

  it('the context provider ships what has been recorded, then names the running call (so the parent reaches the main process first)', () => {
    off = installWindowRecording({ api, doc: document })
    stateCb({ recording: true, win: 1 })
    const provider = api.trace.setContextProvider.mock.calls[0][0]
    const f = nxt.enter('a.js:1:0:merge', null, [])
    const id = provider()
    expect(id).toBe(f.id)
    expect(api.trace.push).toHaveBeenCalledTimes(1)
    expect(api.trace.push.mock.calls[0][0].some(e => e.k === 'enter' && e.id === f.id)).toBe(true)
    nxt.ret(f, 0)
  })

  it('the page name leaves out the aria-hidden shortcut number in the sidebar', () => {
    document.body.innerHTML = '<nav><button aria-current="page">Pull Requests<span aria-hidden="true">4</span></button></nav><button id="b">Merge</button>'
    off = installWindowRecording({ api, doc: document })
    stateCb({ recording: true, win: 1 })
    document.querySelector('#b').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(nxt.drain().find(e => e.k === 'click').d.page).toBe('Pull Requests')
  })

  it('a click while recording is named with the page from the sidebar', () => {
    off = installWindowRecording({ api, doc: document })
    stateCb({ recording: true, win: 1 })
    document.querySelector('button').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const click = nxt.drain().find(e => e.k === 'click')
    expect(click.d).toMatchObject({ name: 'Merge', page: 'Pull Requests' })
  })

  it('stopping removes what it installed', () => {
    off = installWindowRecording({ api, doc: document })
    off(); off = undefined
    stateCb?.({ recording: true, win: 1 })
    document.querySelector('button').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(nxt.drain().filter(e => e.k === 'click')).toEqual([])
  })
})
