import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useDevenvRun } from './use-devenv-run.js'

function fakeAdapter() {
  const listeners = { line: [], exit: [] }
  return {
    listeners,
    run: vi.fn(async () => ({ runId: 9 })),
    answer: vi.fn(async () => ({ ok: true })),
    cancel: vi.fn(async () => ({ ok: true })),
    open: vi.fn(async () => ({ ok: true })),
    onLine: cb => { listeners.line.push(cb); return () => { listeners.line = listeners.line.filter(x => x !== cb) } },
    onExit: cb => { listeners.exit.push(cb); return () => { listeners.exit = listeners.exit.filter(x => x !== cb) } },
    emitLine: m => listeners.line.forEach(cb => cb(m)),
    emitExit: m => listeners.exit.forEach(cb => cb(m)),
  }
}
const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
const P = '@@devenv '

afterEach(cleanup)

describe('useDevenvRun', () => {
  it('runs, collects lines for its own runId only, and finishes', async () => {
    const a = fakeAdapter()
    const { result } = renderHook(() => useDevenvRun({ adapter: a, config: CFG }))
    await act(() => result.current.start(['status'], { exclusive: false, label: 'status' }))
    expect(a.run).toHaveBeenCalledWith(CFG, ['status'], { exclusive: false, label: 'status' })
    act(() => {
      a.emitLine({ runId: 9, stream: 'stdout', line: 'hello' })
      a.emitLine({ runId: 8, stream: 'stdout', line: 'not mine' })
      a.emitExit({ runId: 9, code: 0, cancelled: false })
    })
    expect(result.current.state.lines.map(l => l.text)).toEqual(['hello'])
    expect(result.current.state.status).toBe('done')
  })

  it('keeps events that arrive before run() resolves', async () => {
    const a = fakeAdapter()
    a.run = vi.fn(async () => { a.emitLine({ runId: 9, stream: 'stdout', line: 'early' }); return { runId: 9 } })
    const { result } = renderHook(() => useDevenvRun({ adapter: a, config: CFG }))
    await act(() => result.current.start(['status'], { exclusive: false, label: 'status' }))
    expect(result.current.state.lines.map(l => l.text)).toEqual(['early'])
  })

  it('answers prompts through the adapter and drops them from state', async () => {
    const a = fakeAdapter()
    const { result } = renderHook(() => useDevenvRun({ adapter: a, config: CFG }))
    await act(() => result.current.start(['clean'], { exclusive: true, label: 'clean' }))
    act(() => a.emitLine({ runId: 9, stream: 'stdout', line: P + '{"type":"prompt","id":"p1","kind":"choice","title":"Clean"}' }))
    expect(result.current.state.prompts).toHaveLength(1)
    await act(() => result.current.answer('p1', '1'))
    expect(a.answer).toHaveBeenCalledWith(9, { id: 'p1', value: '1' })
    expect(result.current.state.prompts).toHaveLength(0)
  })

  it('cancelling a prompt sends cancel; cancelling the run marks it cancelled', async () => {
    const a = fakeAdapter()
    const { result } = renderHook(() => useDevenvRun({ adapter: a, config: CFG }))
    await act(() => result.current.start(['start'], { exclusive: true, label: 'start' }))
    act(() => a.emitLine({ runId: 9, stream: 'stdout', line: P + '{"type":"prompt","id":"p1","kind":"text","title":"x"}' }))
    await act(() => result.current.cancelPrompt('p1'))
    expect(a.answer).toHaveBeenCalledWith(9, { id: 'p1', cancel: true })
    await act(() => result.current.cancel())
    expect(a.cancel).toHaveBeenCalledWith(9)
    act(() => a.emitExit({ runId: 9, code: 1, cancelled: true }))
    expect(result.current.state.status).toBe('cancelled')
  })

  it('opens what devenv asks to open', async () => {
    const a = fakeAdapter()
    const { result } = renderHook(() => useDevenvRun({ adapter: a, config: CFG }))
    await act(() => result.current.start(['test', 'web'], { exclusive: false, label: 'test web' }))
    await act(async () => { a.emitLine({ runId: 9, stream: 'stdout', line: P + '{"type":"open","url":"http://127.0.0.1:5280/"}' }) })
    expect(a.open).toHaveBeenCalledWith({ url: 'http://127.0.0.1:5280/' })
    expect(result.current.state.opens).toEqual([])
  })

  it('notifies when a prompt arrives while the window is not focused', async () => {
    const a = fakeAdapter()
    const notify = vi.fn()
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const { result } = renderHook(() => useDevenvRun({ adapter: a, config: CFG, notify }))
    await act(() => result.current.start(['clean'], { exclusive: true, label: 'clean' }))
    act(() => a.emitLine({ runId: 9, stream: 'stdout', line: P + '{"type":"prompt","id":"p1","kind":"choice","title":"Clean - reclaim disk"}' }))
    expect(notify).toHaveBeenCalledWith('devenv needs an answer', 'Clean - reclaim disk')
    focus.mockRestore()
  })

  it('records a failed start', async () => {
    const a = fakeAdapter()
    a.run = vi.fn(async () => { throw new Error('devenv is still running "start"') })
    const { result } = renderHook(() => useDevenvRun({ adapter: a, config: CFG }))
    await act(() => result.current.start(['stop'], { exclusive: true, label: 'stop' }))
    expect(result.current.state.status).toBe('failed')
    expect(result.current.state.error).toMatch(/still running/)
  })
})
