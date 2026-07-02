import React from 'react'
import { TweakSlider } from '@nexusmd/ui'

// Appearance-settings control for the native whole-app zoom. Zoom is owned by
// the Electron main process (persisted as prefs.zoomFactor), so this holds the
// value in local state — initialized from getZoomFactor, synced via
// onZoomChanged (menu / Ctrl± / wheel), and written back with setZoomFactor.
// Renders nothing outside Electron (web build / tests without electronAPI).
export function ZoomSlider() {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  const [percent, setPercent] = React.useState(100)

  React.useEffect(() => {
    if (!api) return undefined
    let active = true
    Promise.resolve(api.getZoomFactor()).then(f => {
      if (active && typeof f === 'number') setPercent(Math.round(f * 100))
    })
    const off = api.onZoomChanged(f => {
      if (typeof f === 'number') setPercent(Math.round(f * 100))
    })
    return () => { active = false; if (typeof off === 'function') off() }
  }, [api])

  if (!api) return null

  const onChange = p => {
    setPercent(p)
    api.setZoomFactor(p / 100)
  }

  return (
    <TweakSlider label="Zoom" value={percent} min={50} max={200} step={10}
      unit="%" onChange={onChange} />
  )
}
