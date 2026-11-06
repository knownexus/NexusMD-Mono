import React from 'react'
import { rendererLog, ignored } from '@nexusmd/core'
import { recordingsAdapter } from './adapters/recordings.js'

const log = rendererLog('core', 'recording')

/** 03:07 */
export const clock = (ms) => {
  const s = Math.floor(Math.max(0, ms) / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** What the main process says about the recording: { status: { recording, id?, startedAt?, events?, capped? }, elapsedMs, reload }. */
export function useRecording() {
  const [status, setStatus] = React.useState({ recording: false })
  const [now, setNow] = React.useState(() => Date.now())

  const reload = React.useCallback(() => Promise.resolve(recordingsAdapter.status())
    .then((s) => { if (s) setStatus(s) }, ignored(log, 'the recording status could not be read')), [])

  React.useEffect(() => {
    let alive = true
    reload()
    const off = recordingsAdapter.onState((s) => { if (alive) setStatus(s) })
    return () => { alive = false; off() }
  }, [reload])

  // While recording: the clock moves, and the count of what has been captured is asked for once a second.
  React.useEffect(() => {
    if (!status.recording) return undefined
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()); reload() }, 1000)
    return () => clearInterval(timer)
  }, [status.recording, reload])

  return { status, reload, elapsedMs: status.recording ? Math.max(0, now - (status.startedAt ?? now)) : 0 }
}
