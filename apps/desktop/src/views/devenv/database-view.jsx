import React from 'react'
import { normaliseBaselines, normaliseSqlScripts, buildDbArgv, DEVENV_DB_EDITOR_URL } from '@nexusmd/core'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { useDevenvQuery } from './use-devenv-query.js'
import { useDevenvStatus } from './use-devenv-status.js'
import { RunPanel } from './run-panel.jsx'
import { Section, StatusLine } from './sections.jsx'

const BASELINES_ARGV = ['db', 'baselines', '--json']
const SCRIPTS_ARGV = ['db', 'scripts', '--json']
const STATE_TEXT = { running: 'Running', stopped: 'Stopped', missing: 'Not created' }
const mb = bytes => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

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
  const list = baselines.data?.baselines ?? []
  const scriptList = scripts.data?.scripts ?? []

  return (
    <div className="nx-modal-fill nx-modal-pad">
      {alerts.map((a, i) => <div key={i} className="nx-alert bad" role="alert">{a}</div>)}

      <div className="nx-db">
        <div className="nx-db-col">
          <Section title="Server" meta={db ? STATE_TEXT[db.state] ?? db.state : null}>
            {db
              ? <>
                  <StatusLine state={db.state} meta="127.0.0.1:14330">SQL Server</StatusLine>
                  {db.baseline && <div className="nx-section-note">{`Latest baseline: ${db.baseline}`}</div>}
                </>
              : <span className="nx-muted">Loading…</span>}
            <div className="nx-toolbar">
              <button className="btn sm accent" disabled={busy} onClick={() => go({ kind: 'start' })}>Start</button>
              <button className="btn sm" disabled={busy} onClick={() => go({ kind: 'stop' })}>Stop</button>
              <button className="btn sm" disabled={busy} onClick={() => go({ kind: 'backup' })}>Back up now</button>
              <button className="btn sm ghost" disabled={busy} onClick={() => go({ kind: 'verify' }, false)}>Verify</button>
            </div>
          </Section>

          <Section title="Database editor" meta={db ? STATE_TEXT[db.ui] ?? db.ui : null}>
            {db && <StatusLine state={db.ui}>Browser-based editor for the local databases</StatusLine>}
            <div className="nx-toolbar">
              <button className="btn sm" disabled={db?.ui !== 'running'} onClick={openEditor}>Open editor</button>
              <button className="btn sm ghost" disabled={busy} onClick={() => go({ kind: 'ui' })}>Editor on</button>
              <button className="btn sm ghost" disabled={busy} onClick={() => go({ kind: 'ui-off' })}>Editor off</button>
            </div>
          </Section>
        </div>

        <div className="nx-db-col">
          <Section title="Baselines" meta={baselines.data ? `${list.length} saved` : null}>
            <div className="nx-section-note">
              Restore fills databases that don't exist yet. To replace data, use the Start plan (wipe and restore) or Clean.
            </div>
            {list.length > 0 && (
              <table className="nx-db-table">
                <thead><tr><th>Baseline</th><th>Created</th><th>Size</th><th>Databases</th><th><span className="nx-sr">Actions</span></th></tr></thead>
                <tbody>
                  {list.map(b => (
                    <tr key={b.id}>
                      <td>
                        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          <strong className="nx-mono" style={{ fontSize: 12.5 }}>{b.id}</strong>
                          {b.isLatest && <span className="nx-badge accent">Latest</span>}
                          {!b.valid && <span className="nx-badge bad">Not readable</span>}
                        </div>
                      </td>
                      <td className="num">{b.createdUtc ? new Date(b.createdUtc).toLocaleString() : ''}</td>
                      <td className="num">{mb(b.size)}</td>
                      <td className="nx-muted" style={{ fontSize: 12.5 }}>{b.databases.join(', ')}</td>
                      <td>
                        <button className="btn sm" disabled={busy} aria-label={`Restore ${b.id}`} onClick={() => go({ kind: 'restore', baseline: b.id })}>Restore</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {baselines.data && !list.length && <span className="nx-muted">No baselines yet. Back up now makes one.</span>}
          </Section>

          <Section title="SQL scripts" meta={scripts.data ? `${scriptList.length} in the profile` : null}>
            <label className="nx-field" style={{ maxWidth: 320 }}>
              <span>Run against database</span>
              <input className="nx-input mono" aria-label="Database" value={database ?? ''} onChange={e => setDatabase(e.target.value)} />
            </label>
            {scriptList.length > 0 && (
              <table className="nx-db-table">
                <thead><tr><th>Script</th><th>What it does</th><th><span className="nx-sr">Actions</span></th></tr></thead>
                <tbody>
                  {scriptList.map(s => (
                    <tr key={s.id}>
                      <td><strong className="nx-mono" style={{ fontSize: 12.5 }}>{s.id}</strong></td>
                      <td className="nx-muted" style={{ fontSize: 12.5 }}>{s.about}</td>
                      <td>
                        <button className="btn sm" disabled={busy} aria-label={`Run ${s.id}`} onClick={() => go({ kind: 'sql', script: s.id, database: database ?? '' })}>Run</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {scripts.data && !scriptList.length && <span className="nx-muted">No scripts in the profile's sql folder.</span>}
          </Section>
        </div>
      </div>

      {run.state.command?.startsWith('devenv db ') && run.state.status !== 'idle' && <RunPanel state={run.state} onCancel={run.cancel} />}
    </div>
  )
}
