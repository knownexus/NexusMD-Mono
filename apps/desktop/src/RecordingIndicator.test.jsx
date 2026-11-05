import React from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RecordingIndicator } from './recording-indicator.jsx'

let api, stateCb
beforeEach(() => {
  api = {
    status: vi.fn(async () => ({ recording: false })),
    stop: vi.fn(async () => ({ id: 'rec-x' })),
    onState: vi.fn((cb) => { stateCb = cb; return () => { stateCb = null } }),
  }
  window.electronAPI = { recording: api }
})
afterEach(() => { cleanup(); delete window.electronAPI })
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

describe('RecordingIndicator', () => {
  it('shows nothing when no recording is running, and nothing outside the desktop app', async () => {
    const { container } = render(<RecordingIndicator />)
    await flush()
    expect(container.textContent).toBe('')
    cleanup(); delete window.electronAPI
    const outside = render(<RecordingIndicator />)
    await flush()
    expect(outside.container.textContent).toBe('')
  })

  it('shows that a recording is running, wherever the person is, and goes away when it stops', async () => {
    render(<RecordingIndicator />)
    await flush()
    await act(async () => { stateCb({ recording: true, id: 'rec-x', startedAt: Date.now(), events: 0 }) })
    expect(screen.getByRole('status').textContent).toMatch(/recording/i)
    await act(async () => { stateCb({ recording: false }) })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('already shows when the window opens into a running recording', async () => {
    api.status.mockResolvedValue({ recording: true, id: 'rec-x', startedAt: Date.now(), events: 5 })
    render(<RecordingIndicator />)
    await flush()
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('has a Stop button that ends the recording', async () => {
    api.status.mockResolvedValue({ recording: true, id: 'rec-x', startedAt: Date.now(), events: 5 })
    render(<RecordingIndicator />)
    await flush()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop recording' })) })
    expect(api.stop).toHaveBeenCalled()
  })

  it('with only icons showing it is still named for what it is', async () => {
    api.status.mockResolvedValue({ recording: true, id: 'rec-x', startedAt: Date.now(), events: 5 })
    render(<RecordingIndicator iconsOnly />)
    await flush()
    expect(screen.getByRole('button', { name: 'Stop recording' })).toBeTruthy()
  })
})
