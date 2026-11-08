import React from 'react'
import { rendererLog } from '@nexusmd/core'
import { disconnectProvider } from './disconnect.js'

const log = rendererLog('work', 'disconnect-button')

// "Disconnect" for a connection card. It asks once, inline, before removing anything.
export function DisconnectButton({ provider, name, onDone }) {
  const [asking, setAsking] = React.useState(false)
  const [error, setError] = React.useState('')

  const confirm = () => {
    try {
      disconnectProvider(provider)
      setAsking(false)
      onDone?.()
    } catch (e) {
      log.warn(`could not disconnect ${provider}`, e)
      setError('Error: ' + (e?.message || 'could not disconnect'))
    }
  }

  if (!asking) {
    return (
      <button className="btn sm ghost" style={{ color: 'var(--danger)' }}
        aria-label={`Disconnect ${name}`} onClick={() => { setError(''); setAsking(true) }}>
        Disconnect
      </button>
    )
  }
  return (
    <span role="group" aria-label={`Disconnect ${name}`} style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
        Remove the {name} connection, its token and its cached data from this profile?
      </span>
      <button className="btn sm" style={{ color: 'var(--danger)' }} onClick={confirm}>Yes, disconnect</button>
      <button className="btn sm ghost" onClick={() => setAsking(false)}>Cancel</button>
      {error && <span style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</span>}
    </span>
  )
}
