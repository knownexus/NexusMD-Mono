import React from 'react'
import { normaliseBaselines, normaliseSqlScripts, buildDbArgv, DEVENV_DB_EDITOR_URL } from '@nexusmd/core'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { useDevenvQuery } from './use-devenv-query.js'
import { useDevenvStatus } from './use-devenv-status.js'
import { RunPanel } from './run-panel.jsx'

const BASELINES_ARGV = ['db', 'baselines', '--json']
const SCRIPTS_ARGV = ['db', 'scripts', '--json']
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
    <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{title}</div>
      {children}
    </div>
  )
}

export function DatabaseView({ adapter }) {
  const run = useDevenvRunContext()
  const busy = run.state.status === 'starting' || run.state.status === 'running'
  const { status, error: statusError } = useDevenvStatus({ adapter, config: run.config, runStatus: run.state.status })
  const baselines = useDevenvQuery({ adapter, config: run.config, argv: BASELINES_ARGV, kind: 'db-baselines', normalise: normaliseBaselines, runStatus: run.state.status })
  const scripts = useDevenvQuery({ adapter, config: run.config, argv: SCRIPTS_ARGV, kind: 'db-scripts', normalise: normaliseSqlScripts, runStatus: run.state.status })
  const [database, setDatabase] = React.useState(null)
  const [actionError, setActionError] = React.useState(null)
  // Prefill once from the profile; later reloads must not overwrite what the user typed.
  React.useEffect(() => {
    if (database === null && scripts.data) setDatabase(scripts.data.database ?? '')
  }, [scripts.data, database])

  const go = (action, exclusive = true) => {
    setActionError(null)
    let argv
    try { argv = buildDbArgv(action) } catch (e) { setActionError(e.message); return }
    run.start(argv, { exclusive, label: `devenv ${argv.join(' ')}` })
  }
  const openEditor = () => adapter.open({ url: DEVENV_DB_EDITOR_URL }).catch(e => setActionError(e?.message || "Couldn't open the editor"))
  const db = status?.database
  const alerts = [actionError, statusError, baselines.error, scripts.error].filter(Boolean)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      {alerts.map((a, i) => <div key={i} className="card" role="alert" style={{ padding: 10, color: 'var(--danger)' }}>{a}</div>)}

      <Card title="Local SQL">
        {db && <Line state={db.state}>SQL Server 127.0.0.1:14330</Line>}
        {db && <Line state={db.ui}>DB editor</Line>}
        {db?.baseline && <span>{`Latest baseline: ${db.baseline}`}</span>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn sm primary" disabled={busy} onClick={() => go({ kind: 'start' })}>Start</button>
          <button className="btn sm" disabled={busy} onClick={() => go({ kind: 'stop' })}>Stop</button>
          <button className="btn sm" disabled={busy} onClick={() => go({ kind: 'backup' })}>Back up now</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => go({ kind: 'verify' }, false)}>Verify</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => go({ kind: 'ui' })}>Editor on</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => go({ kind: 'ui-off' })}>Editor off</button>
          <button className="btn sm ghost" disabled={db?.ui !== 'running'} onClick={openEditor}>Open editor</button>
        </div>
      </Card>

      <Card title="Baselines">
        <span style={{ color: 'var(--text-muted)' }}>Restore fills databases that don't exist yet; to replace data, use Start's plan (wipe + restore) or Clean.</span>
        {baselines.data?.baselines.map(b => (
          <div key={b.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{b.id}</strong>
            {b.createdUtc && <span style={{ color: 'var(--text-muted)' }}>{new Date(b.createdUtc).toLocaleString()}</span>}
            <span>{`${(b.size / (1024 * 1024)).toFixed(1)} MB`}</span>
            {b.databases.length > 0 && <span>{b.databases.join(', ')}</span>}
            {b.isLatest && <span className="chip done">latest</span>}
            {!b.valid && <span className="chip failed">not readable</span>}
            <button className="btn sm" disabled={busy} aria-label={`Restore ${b.id}`} onClick={() => go({ kind: 'restore', baseline: b.id })}>Restore</button>
          </div>
        ))}
        {baselines.data && !baselines.data.baselines.length && <span style={{ color: 'var(--text-muted)' }}>No baselines yet — Back up now makes one.</span>}
      </Card>

      <Card title="SQL scripts">
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span>Database</span>
          <input aria-label="Database" value={database ?? ''} onChange={e => setDatabase(e.target.value)} />
        </label>
        {scripts.data?.scripts.map(s => (
          <div key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <strong>{s.id}</strong>
            <span style={{ color: 'var(--text-muted)' }}>{s.about}</span>
            <button className="btn sm" disabled={busy} aria-label={`Run ${s.id}`} onClick={() => go({ kind: 'sql', script: s.id, database: database ?? '' })}>Run</button>
          </div>
        ))}
        {scripts.data && !scripts.data.scripts.length && <span style={{ color: 'var(--text-muted)' }}>No scripts in the profile's sql folder.</span>}
      </Card>

      {run.state.command?.startsWith('devenv db ') && run.state.status !== 'idle' && <RunPanel state={run.state} onCancel={run.cancel} />}
    </div>
  )
}
