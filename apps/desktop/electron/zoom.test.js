import { describe, it, expect } from 'vitest'
import {
  clampZoomFactor, nextZoom, ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT,
} from './zoom.cjs'

describe('clampZoomFactor', () => {
  it('keeps in-range values', () => {
    expect(clampZoomFactor(1)).toBe(1)
    expect(clampZoomFactor(1.5)).toBe(1.5)
  })
  it('clamps to bounds', () => {
    expect(clampZoomFactor(5)).toBe(ZOOM_MAX)
    expect(clampZoomFactor(0.1)).toBe(ZOOM_MIN)
  })
  it('falls back to default for non-finite input', () => {
    expect(clampZoomFactor(undefined)).toBe(ZOOM_DEFAULT)
    expect(clampZoomFactor(NaN)).toBe(ZOOM_DEFAULT)
    expect(clampZoomFactor('x')).toBe(ZOOM_DEFAULT)
  })
})

describe('nextZoom', () => {
  it('steps in and out without floating-point drift', () => {
    expect(nextZoom(1, 'in')).toBe(1.1)
    expect(nextZoom(1, 'out')).toBe(0.9)
    expect(nextZoom(1.1, 'in')).toBe(1.2)
  })
  it('never exceeds the bounds', () => {
    expect(nextZoom(ZOOM_MAX, 'in')).toBe(ZOOM_MAX)
    expect(nextZoom(ZOOM_MIN, 'out')).toBe(ZOOM_MIN)
  })
  it('returns a clamped current value for an unknown direction', () => {
    expect(nextZoom(1.5, 'none')).toBe(1.5)
  })
})
