import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ListResizer } from './list-resizer.jsx'

afterEach(cleanup)

function setup(width = 330) {
  const onDrag = vi.fn(), onDone = vi.fn()
  const body = { current: { getBoundingClientRect: () => ({ left: 100 }) } }
  render(<ListResizer width={width} bodyRef={body} onDrag={onDrag} onDone={onDone} />)
  return { handle: screen.getByRole('separator', { name: 'Resize branch list' }), onDrag, onDone }
}

describe('ListResizer', () => {
  // jsdom has no PointerEvent, so clientX is set on a plain event (as view-git-actions.test.jsx does).
  const moveTo = x => window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: x }))

  it('follows the pointer while dragging and keeps the width it is let go at', () => {
    const { handle, onDrag, onDone } = setup()
    fireEvent.pointerDown(handle)
    moveTo(600)
    expect(onDrag).toHaveBeenLastCalledWith(500)   // measured from the page's left edge (100)
    moveTo(150)
    expect(onDrag).toHaveBeenLastCalledWith(220)   // never narrower than readable
    fireEvent.pointerUp(window)
    expect(onDrag).toHaveBeenLastCalledWith(null)
    expect(onDone).toHaveBeenCalledWith(220)
  })

  it('a click without moving changes nothing', () => {
    const { handle, onDone } = setup()
    fireEvent.pointerDown(handle)
    fireEvent.pointerUp(window)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('moves with the arrow keys and resets on a double-click', () => {
    const { handle, onDone } = setup(400)
    expect(handle.getAttribute('aria-valuenow')).toBe('400')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onDone).toHaveBeenLastCalledWith(420)
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(onDone).toHaveBeenLastCalledWith(380)
    fireEvent.doubleClick(handle)
    expect(onDone).toHaveBeenLastCalledWith(330)
  })
})
