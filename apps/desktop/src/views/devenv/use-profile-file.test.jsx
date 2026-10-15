import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useProfileFile, hasProfileDraft, hasProfileDrafts, profileDraftPaths, clearProfileDrafts, discardProfileDraft, useProfileDraftsVersion } from './use-profile-file.js'

const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }

function renderHookHarness(props) {
  const h = renderHook(() => useProfileFile(props))
  return { result: () => h.result.current, unmount: h.unmount }
}

afterEach(() => clearProfileDrafts())

describe('useProfileFile', () => {
  it('warns at once when a kept draft is reopened over a file that changed on disk', async () => {
    const adapter = { profileRead: vi.fn().mockResolvedValue({ text: '{"a":1}\n', bom: false, stamp: 's1' }), profileWrite: vi.fn() }
    const first = renderHookHarness({ adapter, config: CFG, path: 'environment.json' })
    await waitFor(() => expect(first.result().status).toBe('ready'))
    act(() => first.result().setText('{"a":2}\n'))
    first.unmount()
    adapter.profileRead.mockResolvedValue({ text: '{"a":9}\n', bom: false, stamp: 's2' })
    const again = renderHookHarness({ adapter, config: CFG, path: 'environment.json' })
    await waitFor(() => expect(again.result().conflict).toEqual({ stamp: 's2' }))
    expect(again.result().text).toBe('{"a":2}\n')
    expect(again.result().restored).toBe(true)
  })

  it('shows no warning when the kept draft still matches the file', async () => {
    const adapter = { profileRead: vi.fn().mockResolvedValue({ text: '{"a":1}\n', bom: false, stamp: 's1' }), profileWrite: vi.fn() }
    const first = renderHookHarness({ adapter, config: CFG, path: 'environment.json' })
    await waitFor(() => expect(first.result().status).toBe('ready'))
    act(() => first.result().setText('{"a":2}\n'))
    first.unmount()
    const again = renderHookHarness({ adapter, config: CFG, path: 'environment.json' })
    await waitFor(() => expect(adapter.profileRead).toHaveBeenCalledTimes(2))
    await act(async () => {})
    expect(again.result().conflict).toBe(null)
  })

  it('keeps text typed during a save as a draft against the new stamp, even after leaving the file', async () => {
    let finish
    const adapter = {
      profileRead: vi.fn().mockResolvedValue({ text: '{"a":1}\n', bom: false, stamp: 's1' }),
      profileWrite: vi.fn(() => new Promise(r => { finish = r })),
    }
    const h = renderHookHarness({ adapter, config: CFG, path: 'extra.json' })
    await waitFor(() => expect(h.result().status).toBe('ready'))
    act(() => h.result().setText('{"a":2}\n'))
    let saving
    act(() => { saving = h.result().save() })
    act(() => h.result().setText('{"a":3}\n'))
    h.unmount()
    await act(async () => { finish({ ok: true, stamp: 's2' }); await saving })
    expect(hasProfileDraft(CFG, 'extra.json')).toBe(true)
    adapter.profileRead.mockResolvedValue({ text: '{"a":2}\n', bom: false, stamp: 's2' })
    const back = renderHookHarness({ adapter, config: CFG, path: 'extra.json' })
    await waitFor(() => expect(adapter.profileRead).toHaveBeenCalledTimes(2))
    await act(async () => {})
    expect(back.result().text).toBe('{"a":3}\n')
    expect(back.result().saved).toBe('{"a":2}\n')
    expect(back.result().conflict).toBe(null)
  })

  it('shows no false conflict and no stale state when reopened while its save is in flight', async () => {
    let finish
    const adapter = {
      profileRead: vi.fn().mockResolvedValue({ text: '{"a":1}\n', bom: false, stamp: 's1' }),
      profileWrite: vi.fn(() => new Promise(r => { finish = r })),
    }
    const h = renderHookHarness({ adapter, config: CFG, path: 'extra.json' })
    await waitFor(() => expect(h.result().status).toBe('ready'))
    act(() => h.result().setText('{"a":2}\n'))
    let saving
    act(() => { saving = h.result().save() })
    act(() => h.result().setText('{"a":3}\n'))
    h.unmount()
    adapter.profileRead.mockResolvedValue({ text: '{"a":2}\n', bom: false, stamp: 's2' })
    const back = renderHookHarness({ adapter, config: CFG, path: 'extra.json' })
    await act(async () => {})
    expect(back.result().status).toBe('loading')
    await act(async () => { finish({ ok: true, stamp: 's2' }); await saving })
    await act(async () => {})
    expect(back.result().status).toBe('ready')
    expect(back.result().conflict).toBe(null)
    expect(back.result().text).toBe('{"a":3}\n')
    expect(back.result().saved).toBe('{"a":2}\n')
  })

  it('ignores a stale early re-read once Revert has started a newer load', async () => {
    const adapter = { profileRead: vi.fn().mockResolvedValue({ text: '{"a":1}\n', bom: false, stamp: 's1' }), profileWrite: vi.fn() }
    const first = renderHookHarness({ adapter, config: CFG, path: 'extra.json' })
    await waitFor(() => expect(first.result().status).toBe('ready'))
    act(() => first.result().setText('{"a":2}\n'))
    first.unmount()
    let late
    adapter.profileRead.mockImplementationOnce(() => new Promise(r => { late = r }))
    const again = renderHookHarness({ adapter, config: CFG, path: 'extra.json' })
    await waitFor(() => expect(again.result().restored).toBe(true))
    await act(async () => { await again.result().revert() })
    expect(again.result().text).toBe('{"a":1}\n')
    await act(async () => { late({ text: '{"a":9}\n', bom: false, stamp: 's9' }) })
    expect(again.result().conflict).toBe(null)
  })

  it('counts and lists only the drafts of the given config', async () => {
    const other = { ...CFG, root: 'D:\\elsewhere' }
    const adapter = { profileRead: vi.fn().mockResolvedValue({ text: '{}\n', bom: false, stamp: 's1' }), profileWrite: vi.fn() }
    const h = renderHookHarness({ adapter, config: CFG, path: 'mac.json' })
    await waitFor(() => expect(h.result().status).toBe('ready'))
    act(() => h.result().setText('{"host":"x"}\n'))
    expect(hasProfileDrafts(CFG)).toBe(true)
    expect(hasProfileDrafts(other)).toBe(false)
    expect(profileDraftPaths(CFG)).toEqual(['mac.json'])
    expect(profileDraftPaths(other)).toEqual([])
  })

  it('notifies draft listeners when a draft appears and goes, but not on every keystroke', async () => {
    const adapter = { profileRead: vi.fn().mockResolvedValue({ text: '{}\n', bom: false, stamp: 's1' }), profileWrite: vi.fn() }
    const h = renderHookHarness({ adapter, config: CFG, path: 'mac.json' })
    await waitFor(() => expect(h.result().status).toBe('ready'))
    expect(hasProfileDrafts(CFG)).toBe(false)
    act(() => h.result().setText('{"host":"x"}\n'))
    expect(hasProfileDraft(CFG, 'mac.json')).toBe(true)
    act(() => h.result().setText('{}\n'))
    expect(hasProfileDrafts(CFG)).toBe(false)

    const v = renderHook(() => useProfileDraftsVersion())
    const v0 = v.result.current
    act(() => h.result().setText('{"host":"x"}\n'))
    const v1 = v.result.current
    expect(v1).toBeGreaterThan(v0)
    act(() => h.result().setText('{"host":"xy"}\n'))
    expect(v.result.current).toBe(v1)
    act(() => h.result().setText('{}\n'))
    const v2 = v.result.current
    expect(v2).toBeGreaterThan(v1)
    act(() => h.result().setText('{"host":"y"}\n'))
    const v3 = v.result.current
    expect(v3).toBeGreaterThan(v2)
    act(() => discardProfileDraft(CFG, 'mac.json'))
    const v4 = v.result.current
    expect(v4).toBeGreaterThan(v3)
    act(() => h.result().setText('{"host":"z"}\n'))
    const v5 = v.result.current
    expect(v5).toBeGreaterThan(v4)
    act(() => clearProfileDrafts())
    expect(v.result.current).toBeGreaterThan(v5)
  })

  it('does not validate a file that does not exist yet while it is empty', async () => {
    const adapter = { profileRead: vi.fn(async () => ({ missing: true })) }
    const { result } = renderHook(() => useProfileFile({ adapter, config: CFG, path: 'mac.json' }))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.missing).toBe(true)
    expect(result.current.errors).toEqual([])
  })
  it('validates a missing file once it has text', async () => {
    const adapter = { profileRead: vi.fn(async () => ({ missing: true })) }
    const { result } = renderHook(() => useProfileFile({ adapter, config: CFG, path: 'mac.json' }))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.setText('{'))
    expect(result.current.errors.length).toBeGreaterThan(0)
  })
})
