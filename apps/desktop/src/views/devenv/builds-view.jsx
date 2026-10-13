import React from 'react'
import { normaliseBuilds, buildBuildArgv, DEVENV_MOBILE_ABIS, DEVENV_DEPLOY_MODES } from '@nexusmd/core'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { useDevenvQuery } from './use-devenv-query.js'
import { RunPanel } from './run-panel.jsx'

const ARGV = ['build', 'status', '--json']
const short = c => (c ? c.slice(0, 8) : '')
const when = at => (at ? new Date(at).toLocaleString() : '')
const sourceText = i => (i.source ? `${i.source.branch} ${short(i.source.commit)}${i.source.dirty ? ' + uncommitted' : ''}` : '')
const builtText = b => (b ? `${short(b.commit)}${b.dirty ? ' + uncommitted' : ''} · ${when(b.at)}` : 'never built')
const isMine = cmd => typeof cmd === 'string' && (cmd.startsWith('devenv build ') || cmd === 'devenv app install')

function Source({ item }) {
  return item.error ? <span style={{ color: 'var(--danger)' }}>{item.error}</span> : <span>{sourceText(item)}</span>
}

export function BuildsView({ adapter }) {
  const run = useDevenvRunContext()
  const busy = run.state.status === 'starting' || run.state.status === 'running'
  const { data, error, loading, refresh } = useDevenvQuery({
    adapter, config: run.config, argv: ARGV, kind: 'builds', normalise: normaliseBuilds, runStatus: run.state.status,
  })
  const [cleanAll, setCleanAll] = React.useState(false)
  const [abi, setAbi] = React.useState('x64')
  const [deploy, setDeploy] = React.useState('fast')
  const [install, setInstall] = React.useState(false)
  const [device, setDevice] = React.useState('')
  const [noRun, setNoRun] = React.useState(false)
  const [actionError, setActionError] = React.useState(null)

  const go = action => {
    setActionError(null)
    let argv
    try { argv = buildBuildArgv(action) } catch (e) { setActionError(e.message); return }
    run.start(argv, { exclusive: true, label: `devenv ${argv.join(' ')}` })
  }
  const mobile = data?.mobile
  const problem = actionError || error

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn primary sm" disabled={busy} onClick={() => go({ kind: 'apis', clean: cleanAll })}>Build all APIs</button>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={cleanAll} onChange={e => setCleanAll(e.target.checked)} aria-label="Clean first" />
          <span>Clean first</span>
        </label>
        <button className="btn sm ghost" style={{ marginLeft: 'auto' }} disabled={loading} onClick={refresh}>Refresh</button>
      </div>

      {problem && <div className="card" role="alert" style={{ padding: 10, color: 'var(--danger)' }}>{problem}</div>}

      {data && (
        <div className="card" style={{ padding: 12, display: 'grid', gridTemplateColumns: 'minmax(100px,auto) 1fr 1fr auto auto', gap: '6px 12px', alignItems: 'center' }}>
          {data.apis.map(a => (
            <React.Fragment key={a.key}>
              <strong>{a.label}</strong>
              <Source item={a} />
              <span>{builtText(a.built)}</span>
              <span className={`chip ${a.upToDate ? 'done' : 'failed'}`}>{a.upToDate ? 'Up to date' : 'Needs a build'}</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button className="btn sm" disabled={busy} aria-label={`Build ${a.label}`} onClick={() => go({ kind: 'api', key: a.key })}>Build</button>
                <button className="btn sm ghost" disabled={busy} aria-label={`Clean rebuild ${a.label}`} onClick={() => go({ kind: 'api', key: a.key, clean: true })}>Clean rebuild</button>
              </span>
            </React.Fragment>
          ))}
        </div>
      )}

      {mobile && (
        <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Mobile (Android)</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Source item={mobile} />
            <span>{builtText(mobile.built)}</span>
            {mobile.mode && <span>{`Last build: ${mobile.mode.deploy} deploy, ${mobile.mode.abi}`}</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label>ABI <select aria-label="ABI" value={abi} onChange={e => setAbi(e.target.value)}>{DEVENV_MOBILE_ABIS.map(x => <option key={x} value={x}>{x}</option>)}</select></label>
            <label>Deploy <select aria-label="Deploy" value={deploy} onChange={e => setDeploy(e.target.value)}>{DEVENV_DEPLOY_MODES.map(x => <option key={x} value={x}>{x}</option>)}</select></label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={install} onChange={e => setInstall(e.target.checked)} aria-label="Install on the emulator" />
              <span>Install on the emulator</span>
            </label>
            <button className="btn sm" disabled={busy} onClick={() => go({ kind: 'mobile', abi, deploy, install })}>Build mobile</button>
            <button className="btn sm ghost" disabled={busy} onClick={() => go({ kind: 'app-install' })}>Install last build</button>
          </div>
        </div>
      )}

      {mobile && (
        <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>iOS simulator (Mac)</div>
          <span>{mobile.ios ? `Last iOS build: ${builtText(mobile.ios)}` : 'No iOS build yet'}</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label>Device <input aria-label="Device" value={device} placeholder="default simulator" onChange={e => setDevice(e.target.value)} /></label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={noRun} onChange={e => setNoRun(e.target.checked)} aria-label="Build only (don't run)" />
              <span>Build only (don't run)</span>
            </label>
            <button className="btn sm" disabled={busy} onClick={() => go({ kind: 'ios', device, noRun })}>Build for iOS</button>
          </div>
        </div>
      )}

      {isMine(run.state.command) && run.state.status !== 'idle' && <RunPanel state={run.state} onCancel={run.cancel} />}
    </div>
  )
}
