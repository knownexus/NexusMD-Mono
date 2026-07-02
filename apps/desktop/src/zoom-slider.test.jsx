import React from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

import { ZoomSlider } from './zoom-slider.jsx'

afterEach(() => { cleanup(); delete window.electronAPI })

// The readout is the sibling <span> after the range input; assert on the input's
// value (percent) and the visible "%" text directly rather than a mock testid.
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
    await waitFor(() => expect(screen.getByLabelText('Zoom').value).toBe('150'))
    expect(screen.getByText('150%')).toBeTruthy()
  })

  it('writes back the factor when the slider changes', async () => {
    const setZoomFactor = vi.fn()
    window.electronAPI = {
      getZoomFactor: vi.fn().mockResolvedValue(1.0),
      setZoomFactor,
      onZoomChanged: vi.fn(() => () => {}),
    }
    render(<ZoomSlider />)
    await waitFor(() => expect(screen.getByLabelText('Zoom').value).toBe('100'))
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
    await waitFor(() => expect(screen.getByLabelText('Zoom').value).toBe('100'))
    cbRef(0.8)
    await waitFor(() => expect(screen.getByLabelText('Zoom').value).toBe('80'))
  })
})
