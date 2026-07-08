import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { TimerWidget } from './timer-widget.jsx'

describe('<TimerWidget>', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); cleanup() })

  it('renders an initial 00:00 clock and a Start control', () => {
    render(<TimerWidget />)
    expect(screen.getByTestId('timer-clock').textContent).toBe('00:00')
    expect(screen.getByRole('button', { name: /start/i })).toBeTruthy()
  })

  it('shows Pause after starting', () => {
    render(<TimerWidget />)
    fireEvent.click(screen.getByRole('button', { name: /start/i }))
    expect(screen.getByRole('button', { name: /pause/i })).toBeTruthy()
  })

  it('calls onStop with elapsed when stopped', () => {
    const onStop = vi.fn()
    render(<TimerWidget onStop={onStop} />)
    fireEvent.click(screen.getByRole('button', { name: /start/i }))
    act(() => { vi.advanceTimersByTime(2000) })
    fireEvent.click(screen.getByRole('button', { name: /stop/i }))
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(onStop.mock.calls[0][0]).toBeGreaterThanOrEqual(2000)
  })
})
