import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import { useWorktreeFile, clearWorktreeDrafts, worktreeDraftPaths, discardWorktreeDraft } from './use-worktree-file.js'

afterEach(() => { cleanup(); clearWorktreeDrafts() })

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

  it('keeps edits when repo/registered are new but equal objects', async () => {
    const adapter = { readFile: vi.fn(async () => ({ text: 'a\n', bom: false, stamp: 's1' })) }
    const { result, rerender } = renderHook(() => useWorktreeFile({ adapter, repo: { ...repo }, worktreePath: repo.path, registered: [...registered], path: 'f.txt' }))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => { result.current.setText('mine\n') })
    rerender()
    expect(result.current.text).toBe('mine\n')
    expect(result.current.dirty).toBe(true)
    expect(adapter.readFile).toHaveBeenCalledTimes(1)
  })

  it('treats an unrecognised failed write as an error and stays dirty', async () => {
    const adapter = {
      readFile: vi.fn(async () => ({ text: 'a\n', bom: false, stamp: 's1' })),
      writeFile: vi.fn(async () => ({ ok: false })),
    }
    const { result } = setup(adapter)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => { result.current.setText('b\n') })
    let ok
    await act(async () => { ok = await result.current.save() })
    expect(ok).toBe(false)
    expect(result.current.error).toBeTruthy()
    expect(result.current.dirty).toBe(true)
    await act(async () => { await result.current.save() })
    expect(adapter.writeFile.mock.calls[1][5].expectedStamp).toBe('s1')
  })

  it('runs only one write for two saves in the same tick', async () => {
    const adapter = { readFile: vi.fn(async () => ({ text: 'a\n', bom: false, stamp: 's1' })), writeFile: vi.fn(async () => ({ ok: true, stamp: 's2' })) }
    const { result } = setup(adapter)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => { result.current.setText('b\n') })
    await act(async () => { await Promise.all([result.current.save(), result.current.save()]) })
    expect(adapter.writeFile).toHaveBeenCalledTimes(1)
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

  it('writes a mixed file back with its majority line ending', async () => {
    const adapter = {
      readFile: vi.fn(async () => ({ text: 'a\nb\r\nc\nd\n', bom: false, stamp: 's1' })),
      writeFile: vi.fn(async () => ({ ok: true, stamp: 's2' })),
    }
    const { result } = setup(adapter)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => { result.current.setText('a\nb\nc\nd\ne\n') })
    await act(async () => { await result.current.save() })
    expect(adapter.writeFile.mock.calls[0][4]).toBe('a\nb\nc\nd\ne\n')
  })

  it("breaks a line-ending tie with the first line's ending", async () => {
    const adapter = {
      readFile: vi.fn(async () => ({ text: 'a\r\nb\n', bom: false, stamp: 's1' })),
      writeFile: vi.fn(async () => ({ ok: true, stamp: 's2' })),
    }
    const { result } = setup(adapter)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => { result.current.setText('a\nc\n') })
    await act(async () => { await result.current.save() })
    expect(adapter.writeFile.mock.calls[0][4]).toBe('a\r\nc\r\n')
  })
})

describe('useWorktreeFile drafts', () => {
  const file = (text = 'a\n', stamp = 's1') => ({ text, bom: false, stamp })

  it('keeps unsaved edits when the editor goes away and restores them with a notice', async () => {
    const adapter = { readFile: vi.fn(async () => file()) }
    const first = setup(adapter)
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    act(() => { first.result.current.setText('mine\n') })
    expect(worktreeDraftPaths(repo.path, repo.path)).toEqual(['f.txt'])
    first.unmount()
    const again = setup(adapter)
    await waitFor(() => expect(again.result.current.text).toBe('mine\n'))
    expect(again.result.current.restored).toBe(true)
    expect(again.result.current.dirty).toBe(true)
    await waitFor(() => expect(adapter.readFile).toHaveBeenCalledTimes(2))
    await act(async () => {})
    expect(again.result.current.conflict).toBe(false)
  })

  it('reports a conflict at once when the file changed on disk since the draft', async () => {
    const adapter = {
      readFile: vi.fn(async () => file()),
      writeFile: vi.fn(async (_r, _w, _g, _p, _t, o) => (o.overwrite ? { ok: true, stamp: 's3' } : { ok: false, conflict: true, stamp: 's2' })),
    }
    const first = setup(adapter)
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    act(() => { first.result.current.setText('mine\n') })
    first.unmount()
    adapter.readFile.mockImplementation(async () => file('theirs\n', 's2'))
    const again = setup(adapter)
    await waitFor(() => expect(again.result.current.conflict).toBe(true))
    expect(again.result.current.text).toBe('mine\n')
    // Never written silently: a plain save still carries the draft's stamp and is refused.
    await act(async () => { await again.result.current.save() })
    expect(adapter.writeFile.mock.calls[0][5]).toMatchObject({ expectedStamp: 's1', overwrite: false })
    expect(again.result.current.conflict).toBe(true)
  })

  it('says so when the file of a restored draft no longer exists, keeping the text', async () => {
    const adapter = { readFile: vi.fn(async () => file()) }
    const first = setup(adapter)
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    act(() => { first.result.current.setText('mine\n') })
    first.unmount()
    adapter.readFile.mockImplementation(async () => ({ missing: true }))
    const again = setup(adapter)
    await waitFor(() => expect(again.result.current.error).toBe('f.txt no longer exists.'))
    expect(again.result.current.text).toBe('mine\n')
  })

  it('drops the draft on save, on revert, and when edits are typed back to the saved text', async () => {
    const adapter = { readFile: vi.fn(async () => file()), writeFile: vi.fn(async () => ({ ok: true, stamp: 's2' })) }
    const { result } = setup(adapter)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => { result.current.setText('mine\n') })
    act(() => { result.current.setText('a\n') })
    expect(worktreeDraftPaths(repo.path, repo.path)).toEqual([])
    act(() => { result.current.setText('mine\n') })
    await act(async () => { await result.current.save() })
    expect(worktreeDraftPaths(repo.path, repo.path)).toEqual([])
    act(() => { result.current.setText('again\n') })
    expect(worktreeDraftPaths(repo.path, repo.path)).toEqual(['f.txt'])
    await act(async () => { await result.current.revert() })
    expect(worktreeDraftPaths(repo.path, repo.path)).toEqual([])
    expect(result.current.restored).toBe(false)
  })

  it('finishes the draft bookkeeping of a save that completes after the editor went away', async () => {
    const w = deferred()
    const adapter = { readFile: vi.fn(async () => file()), writeFile: vi.fn(() => w.promise) }
    const first = setup(adapter)
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    act(() => { first.result.current.setText('mine\n') })
    let p
    act(() => { p = first.result.current.save() })
    first.unmount()
    adapter.readFile.mockImplementation(async () => file('mine\n', 's2'))
    const again = setup(adapter)
    await act(async () => { w.resolve({ ok: true, stamp: 's2' }); await p })
    await waitFor(() => expect(again.result.current.status).toBe('ready'))
    expect(worktreeDraftPaths(repo.path, repo.path)).toEqual([])
    expect(again.result.current.text).toBe('mine\n')
    expect(again.result.current.conflict).toBe(false)
    expect(again.result.current.restored).toBe(false)
  })

  it('discardWorktreeDraft forgets a kept draft', async () => {
    const adapter = { readFile: vi.fn(async () => file()) }
    const first = setup(adapter)
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    act(() => { first.result.current.setText('mine\n') })
    first.unmount()
    discardWorktreeDraft(repo.path, repo.path, 'f.txt')
    const again = setup(adapter)
    await waitFor(() => expect(again.result.current.status).toBe('ready'))
    expect(again.result.current.text).toBe('a\n')
    expect(again.result.current.restored).toBe(false)
  })
})
