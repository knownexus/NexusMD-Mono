import React from 'react'
import { rendererLog } from '@nexusmd/core'
import { recordingsAdapter } from './adapters/recordings.js'
import { useRecording, clock } from './use-recording.js'

const log = rendererLog('core', 'recording-indicator')

// Shown in the sidebar while a recording runs, wherever the person is in the app, so it is never running unnoticed and can
// be stopped from anywhere. (The finished recording is opened from Settings, Data & sync.)
export function RecordingIndicator({ iconsOnly = false }) {
  const { status, elapsedMs } = useRecording()
  if (!recordingsAdapter.available() || !status.recording) return null
  const stop = () => Promise.resolve(recordingsAdapter.stop()).catch((err) => log.error('the recording could not be stopped from the sidebar', err))
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: iconsOnly ? 'center' : 'flex-start', gap: 8, padding: iconsOnly ? '6px' : '6px 10px', fontSize: 12.5, color: 'var(--danger)' }}>
      <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--danger)', flex: 'none' }} />
      <span style={iconsOnly ? { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' } : undefined}>{`Recording ${clock(elapsedMs)}`}</span>
      <button className="btn sm ghost" aria-label="Stop recording" title="Stop recording" onClick={stop} style={iconsOnly ? { padding: '0 4px' } : { marginLeft: 'auto' }}>
        {iconsOnly ? '■' : 'Stop'}
      </button>
    </div>
  )
}

export default RecordingIndicator
