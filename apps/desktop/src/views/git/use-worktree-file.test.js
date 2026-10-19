import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import { useWorktreeFile } from './use-worktree-file.js'

afterEach(cleanup)

const repo = { name: 'A', path: 'C:/repos/A' }
const registered = ['C:/repos/A']
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const setup = (adapter, path = 'f.txt') => renderHook(p => useWorktreeFile({ adapter, repo, worktreePath: repo.path, registered, path: p.path }), { initialProps: { path } })

describe('useWorktreeFile', () => {
  it('is idle without a path', () => {
    const adapter = { readFile: vi.fn() }
    const { result } = setup(adapter, null)
    expect(result.current.status).toBe('idle')
    expect(adapter.readFile).not.toHaveBeenCalled()
  })

  it('loads the file and is clean', async () => {
    const adapter = { readFile: vi.fn(async () => ({ text: 'a\nb\n', bom: false, stamp: 's1' })) }
    const { result } = setup(adapter)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.text).toBe('a\nb\n')
    expect(result.current.dirty).toBe(false)
    expect(adapter.readFile).toHaveBeenCalledWith(repo, repo.path, registered, 'f.txt')
  })

  it("writes back with the file's own line endings", async () => {
    const adapter = {
      readFile: vi.fn(async () => ({ text: 'a\r\nb\r\n', bom: false, stamp: 's1' })),
      writeFile: vi.fn(async () => ({ ok: true, stamp: 's2' })),
    }
    const { result } = setup(adapter)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.text).toBe('a\nb\n')
    act(() => { result.current.setText('a\nc\n') })
    expect(result.current.dirty).toBe(true)
    let ok
    await act(async () => { ok = await result.current.save() })
    expect(ok).toBe(true)
    expect(adapter.writeFile).toHaveBeenCalledWith(repo, repo.path, registered, 'f.txt', 'a\r\nc\r\n', { expectedStamp: 's1', overwrite: false, bom: false })
    expect(result.current.dirty).toBe(false)
  })

  it('reports a conflict and offers overwrite', async () => {
    const adapter = {
      readFile: vi.fn(async () => ({ text: 'a\n', bom: false, stamp: 's1' })),
      writeFile: vi.fn(async (_r, _w, _g, _p, _t, o) => (o.overwrite ? { ok: true, stamp: 's3' } : { ok: false, conflict: true, stamp: 's2' })),
    }
    const { result } = setup(adapter)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => { result.current.setText('b\n') })
    await act(async () => { await result.current.save() })
    expect(result.current.conflict).toBe(true)
    expect(result.current.dirty).toBe(true)
    await act(async () => { await result.current.save({ overwrite: true }) })
    expect(adapter.writeFile.mock.calls[1][5].overwrite).toBe(true)
    expect(result.current.conflict).toBe(false)
    expect(result.current.dirty).toBe(false)
  })

  it('keeps typing made during a save dirty', async () => {
    const w = deferred()
    const adapter = { readFile: vi.fn(async () => ({ text: 'a\n', bom: false, stamp: 's1' })), writeFile: vi.fn(() => w.promise) }
    const { result } = setup(adapter)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => { result.current.setText('b\n') })
    let p
    act(() => { p = result.current.save() })
    act(() => { result.current.setText('bc\n') })
    await act(async () => { w.resolve({ ok: true, stamp: 's2' }); await p })
    expect(result.current.dirty).toBe(true)
    expect(result.current.text).toBe('bc\n')
  })

  it('keeps the BOM on save', async () => {
    const adapter = { readFile: vi.fn(async () => ({ text: 'a\n', bom: true, stamp: 's1' })), writeFile: vi.fn(async () => ({ ok: true, stamp: 's2' })) }
    const { result } = setup(adapter)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => { result.current.setText('b\n') })
    await act(async () => { await result.current.save() })
    expect(adapter.writeFile.mock.calls[0][5].bom).toBe(true)
  })

  it("shows why a file can't be edited", async () => {
    const adapter = { readFile: vi.fn(async () => { throw new Error("Error invoking remote method 'git:readFile': Error: x.bin isn't a text file.") }) }
    const { result } = setup(adapter, 'x.bin')
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toBe("x.bin isn't a text file.")
  })

  it('treats a missing file as an error, on read and on save', async () => {
    const gone = { readFile: vi.fn(async () => ({ missing: true })) }
    const a = setup(gone)
    await waitFor(() => expect(a.result.current.status).toBe('error'))
    expect(a.result.current.error).toBe('f.txt no longer exists.')

    const adapter = { readFile: vi.fn(async () => ({ text: 'a\n', bom: false, stamp: 's1' })), writeFile: vi.fn(async () => ({ ok: false, missing: true })) }
    const { result } = setup(adapter)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => { result.current.setText('b\n') })
    await act(async () => { await result.current.save() })
    expect(result.current.error).toBe('f.txt no longer exists.')
    expect(result.current.dirty).toBe(true)
  })

  it('revert reloads from disk and drops edits', async () => {
    let n = 0
    const adapter = { readFile: vi.fn(async () => ({ text: n++ ? 'new\n' : 'a\n', bom: false, stamp: `s${n}` })) }
    const { result } = setup(adapter)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => { result.current.setText('mine\n') })
    await act(async () => { await result.current.revert() })
    expect(result.current.text).toBe('new\n')
    expect(result.current.dirty).toBe(false)
  })

  it('ignores a stale load after switching file', async () => {
    const slow = deferred()
    const adapter = { readFile: vi.fn(async (_r, _w, _g, p) => (p === 'slow.txt' ? slow.promise : { text: 'fast\n', bom: false, stamp: 'f' })) }
    const { result, rerender } = setup(adapter, 'slow.txt')
    rerender({ path: 'fast.txt' })
    await waitFor(() => expect(result.current.text).toBe('fast\n'))
    await act(async () => { slow.resolve({ text: 'slow\n', bom: false, stamp: 's' }) })
    expect(result.current.text).toBe('fast\n')
    expect(result.current.status).toBe('ready')
  })
})
