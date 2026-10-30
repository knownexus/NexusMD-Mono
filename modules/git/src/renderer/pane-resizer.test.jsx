import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, renderHook, act } from '@testing-library/react'
import { PaneResizer, usePaneWidth } from './pane-resizer.jsx'
import { getGitConfig } from './git-config.js'

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('PaneResizer', () => {
  const moveTo = x => window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: x }))

  it('follows the pointer, clamps, and keeps the width it is let go at', () => {
    const onDrag = vi.fn(), onDone = vi.fn()
    render(<PaneResizer label="Resize file list" width={320} fallback={320} boxRef={{ current: { getBoundingClientRect: () => ({ left: 100 }) } }} onDrag={onDrag} onDone={onDone} />)
    fireEvent.pointerDown(screen.getByRole('separator', { name: 'Resize file list' }))
    moveTo(500)
    expect(onDrag).toHaveBeenLastCalledWith(400)
    moveTo(900)
    expect(onDrag).toHaveBeenLastCalledWith(720)
    fireEvent.pointerUp(window)
    expect(onDrag).toHaveBeenLastCalledWith(null)
    expect(onDone).toHaveBeenCalledWith(720)
  })

  it('moves with the arrow keys and resets to its own default on a double-click', () => {
    const onDone = vi.fn()
    render(<PaneResizer label="Resize file tree" width={300} fallback={300} boxRef={{ current: null }} onDrag={() => {}} onDone={onDone} />)
    const handle = screen.getByRole('separator')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onDone).toHaveBeenLastCalledWith(320)
    fireEvent.doubleClick(handle)
    expect(onDone).toHaveBeenLastCalledWith(300)
  })
})

describe('usePaneWidth', () => {
  it('shows the default, follows a drag, and saves the chosen width to the view', () => {
    const { result } = renderHook(() => usePaneWidth('filesWidth', 320))
    expect(result.current.width).toBe(320)
    act(() => result.current.onDrag(400))
    expect(result.current.width).toBe(400)
    act(() => { result.current.onDrag(null); result.current.onDone(410) })
    expect(result.current.width).toBe(410)
    expect(getGitConfig().view.filesWidth).toBe(410)
  })
})
