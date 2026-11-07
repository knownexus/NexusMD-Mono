import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { useRail } from './use-rail.js'
import { getGitConfig } from './git-config.js'

describe('useRail', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)

  it('is open by default and toggle() persists the choice across a remount', () => {
    const a = renderHook(() => useRail('changes'))
    expect(a.result.current.open).toBe(true)
    act(() => a.result.current.toggle())
    expect(a.result.current.open).toBe(false)
    expect(getGitConfig().view.railOpen.changes).toBe(false)
    a.unmount()
    expect(renderHook(() => useRail('changes')).result.current.open).toBe(false)
  })

  it('keeps each kind separate (github-files maps to githubFiles)', () => {
    const a = renderHook(() => useRail('github-files'))
    act(() => a.result.current.toggle())
    expect(getGitConfig().view.railOpen).toEqual({ changes: true, files: true, githubFiles: false })
    expect(renderHook(() => useRail('files')).result.current.open).toBe(true)
  })

  it('Ctrl+] toggles while mounted', () => {
    const a = renderHook(() => useRail('files'))
    act(() => { fireEvent.keyDown(window, { key: ']', ctrlKey: true }) })
    expect(a.result.current.open).toBe(false)
  })

  it('ignores Ctrl+] while a modal dialog is open', () => {
    const modal = document.createElement('div')
    modal.setAttribute('aria-modal', 'true')
    document.body.appendChild(modal)
    const a = renderHook(() => useRail('files'))
    act(() => { fireEvent.keyDown(window, { key: ']', ctrlKey: true }) })
    expect(a.result.current.open).toBe(true)
    modal.remove()
  })
})
