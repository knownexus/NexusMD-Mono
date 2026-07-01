// Zoom factor bounds and pure helpers for the desktop window.
// Dependency-free so they can be unit-tested without Electron.
const ZOOM_MIN = 0.5
const ZOOM_MAX = 2.0
const ZOOM_STEP = 0.1
const ZOOM_DEFAULT = 1.0

function clampZoomFactor(f) {
  const n = Number(f)
  if (!Number.isFinite(n)) return ZOOM_DEFAULT
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n))
}

function nextZoom(current, direction) {
  const base = clampZoomFactor(current)
  const delta = direction === 'in' ? ZOOM_STEP : direction === 'out' ? -ZOOM_STEP : 0
  // Round to 2dp to avoid 0.1 + 0.2 style floating-point drift.
  return clampZoomFactor(Math.round((base + delta) * 100) / 100)
}

module.exports = { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, ZOOM_DEFAULT, clampZoomFactor, nextZoom }
