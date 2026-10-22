import React from 'react'
import { appPrefsAdapter } from './adapters/appPrefs.js'

// Appearance-settings control for the native whole-app zoom. Zoom is owned by
// the Electron main process (persisted as prefs.zoomFactor), so this holds the
// value in local state — initialized from getZoomFactor, synced via
// onZoomChanged (menu / Ctrl± / wheel), and written back with setZoomFactor.
// Renders nothing outside Electron (web build / tests without electronAPI).
//
// Self-contained: renders its own range input + percent readout rather than the
// shared TweakSlider, whose CSS only ships inside the floating tweaks panel and
// is absent in the Settings view.
export function ZoomSlider() {
  const available = appPrefsAdapter.isAvailable()
  const [percent, setPercent] = React.useState(100)

  React.useEffect(() => {
    if (!available) return undefined
    let active = true
    Promise.resolve(appPrefsAdapter.getZoomFactor()).then(f => {
      if (active && typeof f === 'number') setPercent(Math.round(f * 100))
    })
    const off = appPrefsAdapter.onZoomChanged(f => {
      if (typeof f === 'number') setPercent(Math.round(f * 100))
    })
    return () => { active = false; if (typeof off === 'function') off() }
  }, [available])

  if (!available) return null

  const onChange = p => {
    setPercent(p)
    appPrefsAdapter.setZoomFactor(p / 100)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <input
        type="range" min={50} max={200} step={10} value={percent}
        aria-label="Zoom"
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: 150 }}
      />
      <span style={{
        minWidth: 42, textAlign: 'right', fontSize: 13,
        color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums',
      }}>
        {percent}%
      </span>
    </div>
  )
}
