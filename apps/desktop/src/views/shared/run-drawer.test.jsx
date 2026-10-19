import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react'
import { RunDrawer } from './run-drawer.jsx'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
beforeEach(() => localStorage.clear())

const props = over => ({ title: 'Health check', status: 'running', lines: [{ text: 'checking docker' }], onClose: vi.fn(), onCancel: vi.fn(), ...over })

// A stand-in for the blank window the main process allows: a real document to portal into.
function fakeWindow() {
  const doc = document.implementation.createHTMLDocument('')
  const listeners = {}
  return {
    document: doc, closed: false,
    close() { this.closed = true; listeners.pagehide?.() },
    addEventListener: (type, fn) => { listeners[type] = fn },
    removeEventListener: type => { delete listeners[type] },
  }
}

describe('RunDrawer', () => {
  it('docks beside the page and expands to cover it, remembering the choice', () => {
    const { unmount } = render(<RunDrawer {...props()} />)
    const drawer = screen.getByRole('dialog', { name: 'Health check' })
    expect(drawer.dataset.mode).toBe('docked')
    fireEvent.click(within(drawer).getByRole('button', { name: 'Expand' }))
    expect(drawer.dataset.mode).toBe('expanded')
    expect(screen.queryByRole('separator', { name: 'Resize output' })).toBeNull()
    unmount()
    render(<RunDrawer {...props()} />)
    expect(screen.getByRole('dialog').dataset.mode).toBe('expanded')
    fireEvent.click(screen.getByRole('button', { name: 'Restore size' }))
    expect(screen.getByRole('dialog').dataset.mode).toBe('docked')
  })

  it('resizes from the keyboard and keeps the width', () => {
    render(<RunDrawer {...props()} />)
    const grip = screen.getByRole('separator', { name: 'Resize output' })
    expect(grip.getAttribute('aria-valuenow')).toBe('480')
    fireEvent.keyDown(grip, { key: 'ArrowLeft' })
    expect(grip.getAttribute('aria-valuenow')).toBe('504')
    expect(screen.getByRole('dialog').style.getPropertyValue('--nx-drawer-w')).toBe('504px')
    expect(JSON.parse(localStorage.getItem('nexusmd.runDrawer')).width).toBe(504)
  })

  it('pops out into its own window, leaves a bar behind, and comes back', () => {
    const win = fakeWindow()
    const open = vi.spyOn(window, 'open').mockReturnValue(win)
    render(<RunDrawer {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pop out' }))
    expect(open).toHaveBeenCalledWith('about:blank', expect.stringMatching(/^nexusmd-popout-\d+$/), expect.any(String))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('status', { name: 'Health check, in its own window' }).textContent).toContain('Health check: Running')
    const out = within(win.document.body)
    expect(out.getByText('checking docker')).toBeTruthy()
    expect(win.document.title).toBe('Health check (NexusMD)')
    fireEvent.click(screen.getByRole('button', { name: 'Show here' }))
    expect(win.closed).toBe(true)
    expect(screen.getByRole('dialog').dataset.mode).toBe('docked')
  })

  it('returns to the app when the window is closed, and closes the window when the drawer closes', () => {
    const win = fakeWindow()
    vi.spyOn(window, 'open').mockReturnValue(win)
    const onClose = vi.fn()
    const { unmount } = render(<RunDrawer {...props({ onClose })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pop out' }))
    act(() => win.close())
    expect(screen.getByRole('dialog')).toBeTruthy()
    const second = fakeWindow()
    window.open.mockReturnValue(second)
    fireEvent.click(screen.getByRole('button', { name: 'Pop out' }))
    // The pop-out's document has no window of its own in jsdom, so the click is dispatched by hand.
    act(() => { second.document.querySelector('button[aria-label="Close"]').dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onClose).toHaveBeenCalled()
    expect(second.closed).toBe(true)
    unmount()
  })

  it('stays in the app when no window can be opened', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    render(<RunDrawer {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pop out' }))
    expect(screen.getByRole('alert').textContent).toMatch(/Couldn't open a separate window/)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('offers Cancel while running and Run again after a failure', () => {
    const onRetry = vi.fn()
    const { rerender } = render(<RunDrawer {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    rerender(<RunDrawer {...props({ status: 'failed', exitCode: 2, onRetry })} />)
    expect(screen.getByText('Failed (exit 2)')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }))
    expect(onRetry).toHaveBeenCalled()
  })
})
