import React from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@nexusmd/ui', () => ({
  TweakSlider: ({ label, value, min, max, step, unit, onChange }) => (
    <div data-testid="zoom-tweakslider">
      <span>{label}</span>
      <span data-testid="zoom-value">{value}{unit}</span>
      <input type="range" aria-label={label} min={min} max={max} step={step}
             value={value} onChange={e => onChange(Number(e.target.value))} />
    </div>
  ),
}))

import { ZoomSlider } from './zoom-slider.jsx'

afterEach(() => { cleanup(); delete window.electronAPI })

describe('ZoomSlider', () => {
  it('renders nothing without electronAPI', () => {
    const { container } = render(<ZoomSlider />)
    expect(container.firstChild).toBeNull()
  })

  it('initializes from getZoomFactor as a percentage', async () => {
    window.electronAPI = {
      getZoomFactor: vi.fn().mockResolvedValue(1.5),
      setZoomFactor: vi.fn(),
      onZoomChanged: vi.fn(() => () => {}),
    }
    render(<ZoomSlider />)
    await waitFor(() => expect(screen.getByTestId('zoom-value').textContent).toBe('150%'))
  })

  it('writes back the factor when the slider changes', async () => {
    const setZoomFactor = vi.fn()
    window.electronAPI = {
      getZoomFactor: vi.fn().mockResolvedValue(1.0),
      setZoomFactor,
      onZoomChanged: vi.fn(() => () => {}),
    }
    render(<ZoomSlider />)
    await waitFor(() => expect(screen.getByTestId('zoom-value').textContent).toBe('100%'))
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '130' } })
    expect(setZoomFactor).toHaveBeenCalledWith(1.3)
  })

  it('updates when onZoomChanged fires', async () => {
    let cbRef
    window.electronAPI = {
      getZoomFactor: vi.fn().mockResolvedValue(1.0),
      setZoomFactor: vi.fn(),
      onZoomChanged: vi.fn(cb => { cbRef = cb; return () => {} }),
    }
    render(<ZoomSlider />)
    await waitFor(() => expect(screen.getByTestId('zoom-value').textContent).toBe('100%'))
    cbRef(0.8)
    await waitFor(() => expect(screen.getByTestId('zoom-value').textContent).toBe('80%'))
  })
})
