import React from 'react'
import { normaliseMacStatus, buildMacArgv, macConnectionText } from '@nexusmd/core'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { useDevenvQuery } from './use-devenv-query.js'
import { RunPanel } from './run-panel.jsx'

const ARGV = ['mac', 'status', '--json']
const isMine = cmd => typeof cmd === 'string' && (cmd.startsWith('devenv mac ') || cmd.startsWith('devenv setup ios-sim'))
const STEPS = [
  'Creates ~/.ssh/devenv_mac_ed25519 on this PC (if missing).',
  'Asks for your Mac password once.',
  'Adds the key to ~/.ssh/authorized_keys on the Mac.',
  'Saves it in mac.json.',
]

function Card({ title, children }) {
  return (
    <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{title}</div>
      {children}
    </div>
  )
}

export function MacView({ adapter }) {
  const run = useDevenvRunContext()
  const busy = run.state.status === 'starting' || run.state.status === 'running'
  const { data: mac, error, loading, refresh } = useDevenvQuery({
    adapter, config: run.config, argv: ARGV, kind: 'mac-status', normalise: normaliseMacStatus, runStatus: run.state.status,
  })
  const go = (action, exclusive = true) => {
    const argv = buildMacArgv(action)
    run.start(argv, { exclusive, label: `devenv ${argv.join(' ')}` })
  }
  const configured = mac?.configured === true
  // devenv reports a dangling sshKey as unconfigured, yet key-setup is exactly the way out
  const keyMissing = !!mac && !mac.configured && !!mac.host && !!mac.user && !!mac.sshKey && !mac.keyExists
  const alerts = [error, mac?.error].filter(Boolean)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      {alerts.map((a, i) => <div key={i} className="card" role="alert" style={{ padding: 10, color: 'var(--danger)' }}>{a}</div>)}

      <Card title="Mac build host">
        {mac && <strong>{mac.host ? `${mac.user}@${mac.host}` : 'Not configured'}</strong>}
        {mac && <span>{mac.sshKey ? (mac.keyExists ? mac.sshKey : `${mac.sshKey} (file missing)`) : 'No devenv key yet'}</span>}
        {mac && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span aria-label={mac.connection} style={{ width: 8, height: 8, borderRadius: 4, flex: 'none', background: mac.connection === 'ok' ? 'var(--success)' : 'var(--text-muted)' }} />
            <span>{macConnectionText(mac.connection)}</span>
          </div>
        )}
        {mac?.detail && <span style={{ color: 'var(--text-muted)' }}>{mac.detail}</span>}
        <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} disabled={loading} onClick={refresh}>Refresh</button>
      </Card>

      {((configured && mac.connection !== 'ok') || keyMissing) && (
        <Card title="Set up SSH key">
          <ol style={{ margin: 0, paddingLeft: 18 }}>{STEPS.map(s => <li key={s}>{s}</li>)}</ol>
          <button className="btn sm primary" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => go('key-setup')}>Set up SSH key</button>
        </Card>
      )}
      {configured && mac.connection === 'ok' && (
        <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => go('key-setup')}>Set up the key again</button>
      )}

      <Card title="Checks">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn sm" disabled={busy || !configured} onClick={() => go('doctor', false)}>Doctor</button>
          <button className="btn sm" disabled={busy || !configured} onClick={() => go('fix')}>Fix</button>
          <span style={{ color: 'var(--text-muted)' }}>Fixes that need sudo ask for your Mac password.</span>
        </div>
      </Card>

      <Card title="iOS simulator builds">
        <span style={{ color: 'var(--text-muted)' }}>Rider / dotnet on this PC build simulator apps as x64; the Apple Silicon simulator needs arm64.</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn sm" disabled={busy} onClick={() => go('ios-sim')}>Make simulator builds arm64</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => go('ios-sim-remove')}>Remove</button>
        </div>
      </Card>

      {isMine(run.state.command) && run.state.status !== 'idle' && <RunPanel state={run.state} onCancel={run.cancel} />}
    </div>
  )
}
