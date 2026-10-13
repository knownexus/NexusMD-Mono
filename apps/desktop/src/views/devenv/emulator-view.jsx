import React from 'react'
import { normaliseAvds, buildEmulatorArgv, buildBuildArgv } from '@nexusmd/core'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { useDevenvQuery } from './use-devenv-query.js'
import { useDevenvStatus } from './use-devenv-status.js'
import { RunPanel } from './run-panel.jsx'

const AVDS_ARGV = ['emulator', 'avds', '--json']
const DOT = { running: 'var(--success)', stopped: 'var(--text-muted)', missing: 'var(--border)' }
const isMine = cmd => typeof cmd === 'string' && (cmd.startsWith('devenv emulator ') || cmd === 'devenv app install')

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

export function EmulatorView({ adapter, picker }) {
  const run = useDevenvRunContext()
  const busy = run.state.status === 'starting' || run.state.status === 'running'
  const { status, error: statusError } = useDevenvStatus({ adapter, config: run.config, runStatus: run.state.status })
  const avds = useDevenvQuery({ adapter, config: run.config, argv: AVDS_ARGV, kind: 'emulator-avds', normalise: normaliseAvds, runStatus: run.state.status })
  const [avd, setAvd] = React.useState('')
  const [proxy, setProxy] = React.useState(true)
  const [confirming, setConfirming] = React.useState(false)
  const [files, setFiles] = React.useState([])
  const [dest, setDest] = React.useState('')
  const [actionError, setActionError] = React.useState(null)
  const emu = status?.android.emulator

  React.useEffect(() => {
    const list = avds.data?.avds
    if (avd || !list?.length || !status) return
    const running = emu?.running && list.includes(emu.avd) ? emu.avd : null
    setAvd(running ?? (list.includes(avds.data.default) ? avds.data.default : list[0]))
  }, [avds.data, status, emu, avd])

  const go = build => {
    setActionError(null)
    let argv
    try { argv = typeof build === 'function' ? build() : build } catch (e) { setActionError(e.message); return }
    run.start(argv, { exclusive: true, label: `devenv ${argv.join(' ')}` })
  }
  const addPaths = paths => setFiles(fs => [...fs, ...paths.filter(p => p && !fs.includes(p))])
  const onDrop = e => {
    e.preventDefault()
    addPaths([...(e.dataTransfer?.files ?? [])].map(f => adapter.pathForFile(f)))
  }
  const addFile = async () => { const p = await picker.pickFile(); if (p) addPaths([p]) }
  const alerts = [actionError, statusError, avds.error, avds.data?.error].filter(Boolean)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      {alerts.map((a, i) => <div key={i} className="card" role="alert" style={{ padding: 10, color: 'var(--danger)' }}>{a}</div>)}

      <Card title="Android emulator">
        {status && <Line state={emu?.running ? 'running' : 'stopped'}>{emu?.running ? `${emu.serial} (${emu.avd})` : 'Emulator not running'}</Line>}
        {status && <Line state={status.android.proxy}>Proxy (mitmproxy)</Line>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select aria-label="AVD" value={avd} onChange={e => { setAvd(e.target.value); setConfirming(false) }} disabled={!avds.data?.avds.length}>
            {avds.data?.avds.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" aria-label="Use the proxy" checked={proxy} onChange={e => setProxy(e.target.checked)} />
            <span>Use the proxy</span>
          </label>
          <button className="btn sm primary" disabled={busy} onClick={() => go(() => buildEmulatorArgv({ kind: 'start', avd, proxy }))}>Start</button>
          <button className="btn sm" disabled={busy} onClick={() => go(buildEmulatorArgv({ kind: 'stop' }))}>Stop</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => go(buildEmulatorArgv({ kind: 'proxy', on: true }))}>Proxy on</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => go(buildEmulatorArgv({ kind: 'proxy', on: false }))}>Proxy off</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => go(buildEmulatorArgv({ kind: 'push-ca' }))}>Push CA</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => go(buildBuildArgv({ kind: 'app-install' }))}>Reinstall app</button>
          <button className="btn sm ghost" disabled={busy || !avd} onClick={() => setConfirming(true)}>Recreate image…</button>
        </div>
        {confirming && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>{`This deletes ${avd} and creates it again.`}</span>
            <button className="btn sm danger" disabled={busy} onClick={() => { setConfirming(false); go(() => buildEmulatorArgv({ kind: 'create', avd })) }}>{`Recreate ${avd}`}</button>
            <button className="btn sm ghost" onClick={() => setConfirming(false)}>Keep it</button>
          </div>
        )}
      </Card>

      <Card title="Push files">
        <div data-testid="drop-zone" onDragOver={e => e.preventDefault()} onDrop={onDrop}
          style={{ border: '1px dashed var(--border)', borderRadius: 6, padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>
          Drop files here
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn sm ghost" onClick={addFile}>Add file…</button>
          <input aria-label="Destination" placeholder="Pictures for images, Download for the rest" value={dest} onChange={e => setDest(e.target.value)} />
          <button className="btn sm primary" disabled={busy} onClick={() => go(() => buildEmulatorArgv({ kind: 'push', paths: files, dest }))}>Push</button>
        </div>
        {files.map(f => (
          <div key={f} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>{f}</span>
            <button className="btn sm ghost" aria-label={`Remove ${f}`} onClick={() => setFiles(fs => fs.filter(x => x !== f))}>×</button>
          </div>
        ))}
      </Card>

      {isMine(run.state.command) && run.state.status !== 'idle' && <RunPanel state={run.state} onCancel={run.cancel} />}
    </div>
  )
}
