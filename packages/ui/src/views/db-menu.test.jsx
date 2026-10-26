// packages/ui/src/views/db-menu.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { DbMenu } from './db-menu.jsx'

afterEach(() => { cleanup() })

function show(extra = {}) {
  const onClose = vi.fn()
  const browse = vi.fn()
  const pickGroup = vi.fn()
  render(
    <DbMenu
      x={10} y={10} label="staff options" onClose={onClose}
      items={[
        { heading: 'staff' },
        { label: 'Browse', onSelect: browse },
        { label: 'Disabled', onSelect: vi.fn(), disabled: true },
        { separator: true },
        { label: 'Move to group', submenu: [{ label: 'People', onSelect: pickGroup }] },
      ]}
      {...extra}
    />,
  )
  return { onClose, browse, pickGroup }
}

describe('DbMenu', () => {
  it('focuses the first action and picks it with Enter', () => {
    const { onClose, browse } = show()
    expect(document.activeElement.textContent).toBe('Browse')
    fireEvent.click(document.activeElement)
    expect(browse).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('skips headings, separators and disabled items with the arrow keys', () => {
    show()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    expect(document.activeElement.textContent).toBe('Move to group')
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    expect(document.activeElement.textContent).toBe('Browse')
  })

  it('opens a flyout with → and goes back with ←', () => {
    const { pickGroup } = show()
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    fireEvent.keyDown(menu, { key: 'ArrowRight' })
    expect(screen.getAllByRole('menu')).toHaveLength(2)
    expect(document.activeElement.textContent).toBe('People')
    fireEvent.keyDown(screen.getAllByRole('menu')[1], { key: 'ArrowLeft' })
    expect(screen.getAllByRole('menu')).toHaveLength(1)

    fireEvent.keyDown(menu, { key: 'ArrowRight' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'People' }))
    expect(pickGroup).toHaveBeenCalled()
  })

  it('closes on Escape and on a click outside', () => {
    const { onClose } = show()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
