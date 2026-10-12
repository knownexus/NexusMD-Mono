import React from 'react'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { useDevenvStatus } from './use-devenv-status.js'
import { RunPanel } from './run-panel.jsx'

const DOT = { running: 'var(--success)', stopped: 'var(--text-muted)', missing: 'var(--border)' }

function Line({ state, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span aria-label={state} style={{ width: 8, height: 8, borderRadius: 4, background: DOT[state] || DOT.missing, flex: 'none' }} />
      <span>{children}</span>
    </div>
  )
}

function Card({ title, children }) {
  return (
    <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{title}</div>
      {children}
    </div>
  )
}

export function StatusView({ adapter, onStart }) {
  const run = useDevenvRunContext()
  const busy = run.state.status === 'starting' || run.state.status === 'running'
  const { status, error, loading, refresh } = useDevenvStatus({ adapter, config: run.config, runStatus: run.state.status })
  const go = (argv, exclusive) => run.start(argv, { exclusive, label: `devenv ${argv.join(' ')}` })
  const emu = status?.android.emulator

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn primary sm" disabled={busy} onClick={onStart}>Start…</button>
        <button className="btn sm" disabled={busy} onClick={() => go(['stop'], true)}>Stop</button>
        <button className="btn sm ghost" disabled={busy} onClick={() => go(['backend', 'up'], true)}>Backend up</button>
        <button className="btn sm ghost" disabled={busy} onClick={() => go(['backend', 'down'], true)}>Backend down</button>
        <button className="btn sm ghost" disabled={busy} onClick={() => go(['doctor'], false)}>Doctor</button>
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
          {status?.at ? `Updated ${new Date(status.at).toLocaleTimeString()}` : ''}
        </span>
        <button className="btn sm ghost" disabled={loading} onClick={refresh}>Refresh</button>
      </div>

      {error && <div className="card" role="alert" style={{ padding: 10, color: 'var(--danger)' }}>{error}</div>}
      {status && !status.docker.ok && (
        <div className="card" role="alert" style={{ padding: 10 }}>{status.docker.error || "Docker isn't running"}</div>
      )}

      {status && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          <Card title="Backend">
            {status.backend.map(b => <Line key={b.key} state={b.state}>{`${b.label} :${b.port}`}</Line>)}
            {status.infra.map(i => <Line key={i.service} state={i.state}>{i.service}</Line>)}
          </Card>
          <Card title="Database">
            <Line state={status.database.state}>SQL Server 127.0.0.1:14330</Line>
            <Line state={status.database.ui}>DB editor</Line>
            <div style={{ color: 'var(--text-muted)' }}>{`Baseline ${status.database.baseline || 'none'}`}</div>
          </Card>
          <Card title="Test stack">
            <Line state={status.test.tracer}>Tracer</Line>
            {status.test.apis.map(t => <Line key={t.key} state={t.state}>{`${t.label} :${t.port}`}</Line>)}
          </Card>
          <Card title="Android">
            <Line state={emu?.running ? 'running' : 'stopped'}>{emu?.running ? `Emulator ${emu.serial} (${emu.avd})` : 'Emulator'}</Line>
            <Line state={status.android.proxy}>mitmproxy :8888</Line>
          </Card>
          <Card title="iOS">
            {status.ios.host ? <div>{`Mac ${status.ios.host}`}</div> : <div style={{ color: 'var(--text-muted)' }}>{status.ios.error || 'No Mac configured'}</div>}
          </Card>
        </div>
      )}

      {run.state.status !== 'idle' && <RunPanel state={run.state} onCancel={run.cancel} />}
    </div>
  )
}
