import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import { clearWorktreeDrafts } from './use-worktree-file.js'
import { useConflict } from './use-conflict.js'

afterEach(() => { cleanup(); clearWorktreeDrafts() })

const repo = { name: 'A', path: 'C:/repos/A' }
const registered = ['C:/repos/A']
const marked = '<<<<<<< ours\nL\n=======\nR\n>>>>>>> theirs\nend\n'
const conflict = (working = { text: marked, bom: false, stamp: 'w1' }) => ({ kind: 'both-modified', binary: false, stages: { base: null, left: { text: 'L\n', bom: false }, right: { text: 'R\n', bom: false } }, working, stamp: 'c1' })
const mk = (over = {}) => ({
  conflict: vi.fn(async () => conflict()),
  resolveConflict: vi.fn(async () => ({ ok: true })),
  unresolve: vi.fn(async () => ({ ok: true })),
  stamp: vi.fn(async () => 'f1'),
  ...over,
})
const setup = (adapter, path = 'f.txt') => renderHook(p => useConflict({ adapter, repo, worktreePath: repo.path, registered, path: p.path }), { initialProps: { path } })

describe('useConflict', () => {
  it('loads sides and working text', async () => {
    const adapter = mk()
    const { result } = setup(adapter)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.data.stages.left.text).toBe('L\n')
    expect(result.current.text).toBe(marked)
    expect(result.current.regions).toHaveLength(1)
    expect(adapter.conflict).toHaveBeenCalledWith(repo, repo.path, registered, 'f.txt')
  })

  it('take rewrites the region and the counter drops', async () => {
    const { result } = setup(mk())
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => { result.current.take(0, 'left') })
    expect(result.current.text).toBe('L\nend\n')
    expect(result.current.regions).toHaveLength(0)
  })

  it('markResolved warns about markers, then forces', async () => {
    const adapter = mk()
    const { result } = setup(adapter)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    let r
    await act(async () => { r = await result.current.markResolved() })
    expect(r).toBe('markers')
    expect(adapter.resolveConflict).not.toHaveBeenCalled()
    await act(async () => { r = await result.current.markResolved({ force: true }) })
    expect(r).toBe('ok')
    expect(adapter.resolveConflict).toHaveBeenCalledWith(repo, repo.path, registered, 'f.txt', { take: 'text', text: marked, bom: false, force: true }, 'c1')
  })

  it('markResolved keeps CRLF and BOM', async () => {
    const adapter = mk({ conflict: vi.fn(async () => conflict({ text: '<<<<<<< a\r\nL\r\n=======\r\nR\r\n>>>>>>> b\r\nend\r\n', bom: true, stamp: 'w1' })) })
    const { result } = setup(adapter)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => { result.current.take(0, 'right') })
    await act(async () => { await result.current.markResolved() })
    expect(adapter.resolveConflict.mock.calls[0][4]).toEqual({ take: 'text', text: 'R\r\nend\r\n', bom: true, force: false })
  })

  it('stale resolve reports stale', async () => {
    const adapter = mk({ resolveConflict: vi.fn(async () => ({ ok: false, stale: true, detail: 'changed' })) })
    const { result } = setup(adapter)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    let r
    await act(async () => { r = await result.current.markResolved({ force: true }) })
    expect(r).toBe('stale')
  })

  it('a failed resolve is an error, not success', async () => {
    const adapter = mk({ resolveConflict: vi.fn(async () => ({ ok: false, detail: 'nope' })) })
    const { result } = setup(adapter)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    let r
    await act(async () => { r = await result.current.takeWhole('left') })
    expect(r).toBe(false)
    expect(result.current.error).toBe('nope')
  })

  it('two clicks in one tick submit once', async () => {
    const adapter = mk()
    const { result } = setup(adapter)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => { await Promise.all([result.current.takeWhole('right'), result.current.takeWhole('right')]) })
    expect(adapter.resolveConflict).toHaveBeenCalledTimes(1)
  })

  it('keeps unsaved text across unmount and restores it', async () => {
    const adapter = mk()
    const a = setup(adapter)
    await waitFor(() => expect(a.result.current.status).toBe('ready'))
    act(() => { a.result.current.take(0, 'left') })
    a.unmount()
    const b = setup(adapter)
    await waitFor(() => expect(b.result.current.status).toBe('ready'))
    await waitFor(() => expect(adapter.conflict).toHaveBeenCalledTimes(2))
    expect(b.result.current.text).toBe('L\nend\n')
    expect(b.result.current.restored).toBe(true)
    expect(b.result.current.conflict).toBe(false)
  })

  it('flags a conflict when the working file changed since the draft', async () => {
    const adapter = mk()
    const a = setup(adapter)
    await waitFor(() => expect(a.result.current.status).toBe('ready'))
    act(() => { a.result.current.take(0, 'left') })
    a.unmount()
    adapter.conflict.mockImplementation(async () => conflict({ text: marked + 'x\n', bom: false, stamp: 'w2' }))
    const b = setup(adapter)
    await waitFor(() => expect(b.result.current.conflict).toBe(true))
    expect(b.result.current.text).toBe('L\nend\n')
  })

  it('drops the draft after a successful resolve', async () => {
    const adapter = mk()
    const a = setup(adapter)
    await waitFor(() => expect(a.result.current.status).toBe('ready'))
    act(() => { a.result.current.take(0, 'left') })
    await act(async () => { await a.result.current.markResolved() })
    a.unmount()
    const b = setup(adapter)
    await waitFor(() => expect(b.result.current.status).toBe('ready'))
    expect(b.result.current.restored).toBe(false)
    expect(b.result.current.text).toBe(marked)
  })

  it('unresolve passes the files stamp', async () => {
    const adapter = mk()
    const { result } = setup(adapter)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    let r
    await act(async () => { r = await result.current.unresolve() })
    expect(r).toBe('ok')
    expect(adapter.stamp).toHaveBeenCalledWith(repo, repo.path, registered, { kind: 'files', paths: ['f.txt'] })
    expect(adapter.unresolve).toHaveBeenCalledWith(repo, repo.path, registered, 'f.txt', 'f1')
  })

  it('ignores a stale load after the path changes', async () => {
    let release
    const adapter = mk()
    adapter.conflict = vi.fn((_r, _w, _g, rel) => rel === 'a.txt'
      ? new Promise(res => { release = () => res(conflict({ text: 'A', bom: false, stamp: 'x' })) })
      : Promise.resolve(conflict({ text: 'B', bom: false, stamp: 'y' })))
    const { result, rerender } = setup(adapter, 'a.txt')
    rerender({ path: 'b.txt' })
    await waitFor(() => expect(result.current.text).toBe('B'))
    await act(async () => { release() })
    expect(result.current.text).toBe('B')
  })
})
