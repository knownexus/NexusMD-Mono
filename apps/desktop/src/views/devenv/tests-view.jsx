import React from 'react'
import {
  normaliseTestRuns, normaliseTestCollection, buildTestUpArgv, buildTestRunArgv, topLevelPaths, DEVENV_CAPTURE_SINCE,
} from '@nexusmd/core'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { useDevenvQuery } from './use-devenv-query.js'
import { useDevenvStatus } from './use-devenv-status.js'
import { RunPanel } from './run-panel.jsx'

const RUNS_ARGV = ['test', 'runs', '--json']
const DOT = { running: 'var(--success)', stopped: 'var(--text-muted)', missing: 'var(--border)' }
const when = at => (at ? new Date(at).toLocaleString() : '')
const outcome = p => (p === true ? ['Passed', 'done'] : p === false ? ['Failed', 'failed'] : ['—', ''])

function Card({ title, children }) {
  return (
    <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{title}</div>
      {children}
    </div>
  )
}

function Check({ label, checked, disabled, onChange, children }) {
  return (
    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      {children ?? <span>{label}</span>}
    </label>
  )
}

export function TestsView({ adapter, picker }) {
  const run = useDevenvRunContext()
  const busy = run.state.status === 'starting' || run.state.status === 'running'
  const { status, error: statusError } = useDevenvStatus({ adapter, config: run.config, runStatus: run.state.status })
  const [collection, setCollection] = React.useState('')
  const collectionArgv = React.useMemo(
    () => ['test', 'collection', '--json', ...(collection ? ['--collection', collection] : [])], [collection])
  const runs = useDevenvQuery({ adapter, config: run.config, argv: RUNS_ARGV, kind: 'test-runs', normalise: normaliseTestRuns, runStatus: run.state.status })
  const tree = useDevenvQuery({ adapter, config: run.config, argv: collectionArgv, kind: 'test-collection', normalise: normaliseTestCollection, runStatus: run.state.status })

  // useDevenvQuery keeps the previous data while a newer load is pending or has failed, so
  // remember which collection the data belongs to rather than trusting it blindly.
  const [treeFor, setTreeFor] = React.useState(null)
  React.useEffect(() => { if (tree.data) setTreeFor(collection) }, [tree.data])

  const apis = status?.test.apis ?? []
  const [picked, setPicked] = React.useState(null)   // null until the first status pre-ticks the running APIs
  React.useEffect(() => {
    if (picked === null && status) setPicked(status.test.apis.filter(a => a.state === 'running').map(a => a.key))
  }, [status, picked])
  const [noBuild, setNoBuild] = React.useState(false)
  const [selected, setSelected] = React.useState([])
  const [env, setEnv] = React.useState('')
  const [tags, setTags] = React.useState('')
  const [name, setName] = React.useState('')
  const [allApis, setAllApis] = React.useState(false)
  const [since, setSince] = React.useState('15m')
  const [actionError, setActionError] = React.useState(null)
  React.useEffect(() => { setSelected([]) }, [collection])

  const go = (build, exclusive = true) => {
    setActionError(null)
    let argv
    try { argv = typeof build === 'function' ? build() : build } catch (e) { setActionError(e.message); return }
    run.start(argv, { exclusive, label: `devenv ${argv.join(' ')}` })
  }
  const toggle = (list, setList, key, on) => setList(on ? [...list, key] : list.filter(k => k !== key))
  const insideTicked = p => selected.some(s => s !== p && p.startsWith(`${s}/`))
  const chooseCollection = async () => {
    try { const dir = await picker.pickDirectory(); if (dir) setCollection(dir) } catch (e) { setActionError(`Couldn't choose a folder: ${e?.message || e}`) }
  }
  const openReport = path => adapter.open({ path }).catch(e => setActionError(e?.message || `Couldn't open ${path}`))
  const t = tree.data && treeFor === collection && !tree.error ? tree.data : null
  const canRun = !busy && t && !t.error
  const alerts = [actionError, statusError, runs.error, tree.error].filter(Boolean)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      {alerts.map((a, i) => <div key={i} className="card" role="alert" style={{ padding: 10, color: 'var(--danger)' }}>{a}</div>)}

      <Card title="Test stack">
        <span>{`Tracer: ${status?.test.tracer ?? '…'}`}</span>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {apis.map(a => (
            <Check key={a.key} label={`${a.label} :${a.port}`} checked={(picked ?? []).includes(a.key)} onChange={on => toggle(picked ?? [], setPicked, a.key, on)}>
              <span aria-label={a.state} style={{ width: 8, height: 8, borderRadius: 4, background: DOT[a.state] || DOT.missing }} />
              <span>{`${a.label} :${a.port}`}</span>
            </Check>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Check label="Skip builds" checked={noBuild} onChange={setNoBuild} />
          <button className="btn sm primary" disabled={busy} onClick={() => go(() => buildTestUpArgv({ apis: picked ?? [], noBuild }))}>Start stack</button>
          <button className="btn sm" disabled={busy} onClick={() => go(['test', 'down'])}>Stop stack</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => go(['test', 'clear'])}>Clear trace</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => go(['test', 'web'], false)}>Open live view</button>
          <span style={{ color: 'var(--text-muted)' }}>None ticked = the profile's default APIs</span>
        </div>
      </Card>

      <Card title="Collection">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{t ? `${t.root}${t.isDefault ? ' (profile)' : ''}` : '…'}</span>
          <button className="btn sm ghost" disabled={busy} onClick={chooseCollection}>Choose collection…</button>
          {collection && <button className="btn sm ghost" onClick={() => setCollection('')}>Use the profile's</button>}
        </div>
        {t?.error && <span style={{ color: 'var(--danger)' }}>{t.error}</span>}
        {t && !t.error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {t.items.map(i => {
              const label = i.kind === 'folder' ? `${i.name}/` : i.name
              // Two requests with one file name (in different folders) need distinct accessible names.
              const aria = i.kind === 'folder' ? `${i.path}/` : (t.items.filter(x => x.name === i.name).length > 1 ? i.path : i.name)
              return (
                <div key={i.path} style={{ paddingLeft: i.depth * 16 }}>
                  <Check label={aria} checked={selected.includes(i.path) || insideTicked(i.path)}
                    disabled={insideTicked(i.path)} onChange={on => toggle(selected, setSelected, i.path, on)}>
                    <span>{label}</span>
                  </Check>
                </div>
              )
            })}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input aria-label="Environment" placeholder="Environment" value={env} onChange={e => setEnv(e.target.value)} />
          <input aria-label="Tags" placeholder="Tags" value={tags} onChange={e => setTags(e.target.value)} />
          <input aria-label="Run name" placeholder="Run name" value={name} onChange={e => setName(e.target.value)} />
          <Check label="Include requests for APIs that aren't running" checked={allApis} onChange={setAllApis} />
          <button className="btn sm primary" disabled={!canRun}
            onClick={() => go(() => buildTestRunArgv({ paths: topLevelPaths(selected), collection, env, tags, allApis, name }))}>
            {selected.length ? 'Run selected' : 'Run all'}
          </button>
        </div>
      </Card>

      <Card title="History">
        {runs.data?.runs.map(r => {
          const [text, chip] = outcome(r.passed)
          return (
            <div key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>{r.label}</strong>
              <span style={{ color: 'var(--text-muted)' }}>{when(r.at)}</span>
              <span className={`chip ${chip}`}>{text}</span>
              {r.requests && <span>{`${r.requests.passed}/${r.requests.total} requests`}</span>}
              {r.traceHtml && <button className="btn sm ghost" onClick={() => openReport(r.traceHtml)}>Call chain</button>}
              {r.brunoHtml && <button className="btn sm ghost" onClick={() => openReport(r.brunoHtml)}>Bruno report</button>}
            </div>
          )
        })}
        {runs.data && !runs.data.runs.length && <span style={{ color: 'var(--text-muted)' }}>No runs yet.</span>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Report of the last</span>
          <select aria-label="Report window" value={since} onChange={e => setSince(e.target.value)}>
            {DEVENV_CAPTURE_SINCE.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn sm ghost" disabled={busy} onClick={() => go(['test', 'report', '--since', since], false)}>Make report</button>
        </div>
        {runs.data?.reports.map(p => (
          <div key={p.path} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span>{p.name}</span>
            <button className="btn sm ghost" aria-label={`Open ${p.name}`} onClick={() => openReport(p.path)}>Open</button>
          </div>
        ))}
      </Card>

      {run.state.command?.startsWith('devenv test ') && run.state.status !== 'idle' && <RunPanel state={run.state} onCancel={run.cancel} />}
    </div>
  )
}
