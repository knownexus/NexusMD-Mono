import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'

vi.mock('./devenv-run-context.jsx', () => ({ useDevenvRunContext: () => globalThis.__run }))
vi.mock('./status-view.jsx', () => ({ StatusView: ({ onStart }) => <button onClick={onStart}>status-stub</button> }))
vi.mock('./start-view.jsx', () => ({ StartView: () => <div>start-stub</div> }))
vi.mock('./commands-view.jsx', () => ({ CommandsView: () => <div>commands-stub</div> }))

import { DevenvView } from './view-devenv.jsx'

afterEach(cleanup)
beforeEach(() => {
  localStorage.clear()
  globalThis.__run = { state: createRunState(), start: vi.fn(), cancel: vi.fn(), leftover: { runs: [], error: null, cancelAll: vi.fn() } }
})

const adapters = { devenv: { isAvailable: () => true } }

describe('DevenvView', () => {
  it('opens on Status and switches tabs', () => {
    render(<DevenvView adapters={adapters} />)
    expect(screen.getByText('status-stub')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Commands' }))
    expect(screen.getByText('commands-stub')).toBeTruthy()
  })
  it('Start… on Status opens the Start tab', () => {
    render(<DevenvView adapters={adapters} />)
    fireEvent.click(screen.getByText('status-stub'))
    expect(screen.getByText('start-stub')).toBeTruthy()
  })
  it('remembers the tab', () => {
    const { unmount } = render(<DevenvView adapters={adapters} />)
    fireEvent.click(screen.getByRole('button', { name: 'Commands' }))
    unmount()
    render(<DevenvView adapters={adapters} />)
    expect(screen.getByText('commands-stub')).toBeTruthy()
  })
})
