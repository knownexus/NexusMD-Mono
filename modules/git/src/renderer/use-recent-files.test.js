import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRecentFiles, forgetRecentFiles } from './use-recent-files.js'

beforeEach(() => forgetRecentFiles())

describe('useRecentFiles', () => {
  it('starts empty and lists the last three files opened, newest first, each once', () => {
    const { result } = renderHook(() => useRecentFiles('wt'))
    expect(result.current.recent).toEqual([])
    for (const p of ['a', 'b', 'c', 'd', 'b']) act(() => result.current.touch(p))
    expect(result.current.recent.map(r => r.path)).toEqual(['b', 'd', 'c'])
    expect(typeof result.current.recent[0].openedAt).toBe('number')
  })

  it('keeps each worktree\'s files apart, and across a remount in the same session', () => {
    const a = renderHook(() => useRecentFiles('one'))
    act(() => a.result.current.touch('x'))
    a.unmount()
    expect(renderHook(() => useRecentFiles('one')).result.current.recent.map(r => r.path)).toEqual(['x'])
    expect(renderHook(() => useRecentFiles('two')).result.current.recent).toEqual([])
  })
})
