import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useProfileFile } from './use-profile-file.js'

const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }

describe('useProfileFile', () => {
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
