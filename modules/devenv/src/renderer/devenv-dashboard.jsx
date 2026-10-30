import React from 'react'
import { PlModal } from '@nexusmd/ui'
import { normaliseBuilds, buildBuildArgv, buildTestUpArgv, buildTestRunArgv } from '@nexusmd/core'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { buildBranchArgv } from './source-branch.js'
import { useDevenvStatus } from './use-devenv-status.js'
import { useDevenvQuery } from './use-devenv-query.js'
import { hasProfileDrafts, useProfileDraftsVersion } from './use-profile-file.js'
import { StartView } from './start-view.jsx'
import { BuildsView } from './builds-view.jsx'
import { LogsView } from './logs-view.jsx'
import { TestsView } from './tests-view.jsx'
import { DatabaseView } from './database-view.jsx'
import { EmulatorView } from './emulator-view.jsx'
import { MacView } from './mac-view.jsx'
import { ProfileView } from './profile-view.jsx'
import { CommandsView } from './commands-view.jsx'
import { RunDrawer } from '@nexusmd/editor-kit/run-drawer.jsx'
import '@nexusmd/editor-kit/devenv-git.css'

const BUILD_ARGV = ['build', 'status', '--json']
const short = c => (c ? c.slice(0, 8) : '')
const when = at => (at ? new Date(at).toLocaleString() : '')
const sourceText = i => (i?.source ? `${i.source.branch} · ${short(i.source.commit)}${i.source.dirty ? ' + uncommitted' : ''}` : '')
const builtText = b => (b ? `${short(b.commit)}${b.dirty ? ' + uncommitted' : ''} · ${when(b.at)}` : 'Never built')

// Plain-language titles for the drawer. The run label stays `devenv …` so existing
// command-matching code (isMine, doctor checks) keeps working.
const TITLES = [
  [/^devenv stop$/, 'Stop environment'],
  [/^devenv doctor$/, 'Health check'],
  [/^devenv backend up$/, 'Start backend'],
  [/^devenv backend down$/, 'Stop backend'],
  [/^devenv test up/, 'Start test stack'],
  [/^devenv test run/, 'Run tests'],
  [/^devenv app install$/, 'Install last Android build'],
  [/^devenv build /, 'Build'],
  [/^devenv source branch /, 'Change branch'],
  [/^devenv start/, 'Start environment'],
]
const friendly = cmd => (TITLES.find(([re]) => re.test(cmd || ''))?.[1] ?? (cmd || '').replace(/^devenv\s+/, ''))

// [title, view, size]. xl dialogs take most of the window and the view fills it (laying out its own padding);
// lg ones are a wider version of the standard dialog.
const MODALS = {
  start: ['Start environment', StartView, 'lg'], builds: ['Builds', BuildsView, 'lg'], logs: ['Logs', LogsView, 'xl-pad'], tests: ['Tests', TestsView, 'lg'],
  database: ['Database', DatabaseView, 'xl-auto'], emulator: ['Android emulator', EmulatorView, 'lg'], mac: ['iOS on Mac', MacView, 'lg'],
  profile: ['Profile', ProfileView, 'xl'], commands: ['All actions', CommandsView, 'lg'],
}
const MODAL_ICONS = { database: 'database', profile: 'edit', logs: 'doc' }

function Tile({ title, meta, children, actions }) {
  return (
    <section className="card nx-tile" aria-label={title}>
      <div className="nx-tile-head">{title}{meta != null && <span className="nx-tile-meta">{meta}</span>}</div>
      <div className="nx-tile-body">{children}</div>
      {actions && <div className="nx-tile-foot">{actions}</div>}
    </section>
  )
}

function Line({ state, children, meta }) {
  return (
    <div className="nx-row">
      <span className="nx-dot" data-state={state} aria-label={state} />
      <span className="nx-trunc">{children}</span>
      {meta && <span className="nx-row-meta">{meta}</span>}
    </div>
  )
}

export function DevenvDashboard({ adapter, picker }) {
  const run = useDevenvRunContext()
  useProfileDraftsVersion()
  const busy = run.state.status === 'starting' || run.state.status === 'running'
  const { status, error, loading, refresh } = useDevenvStatus({ adapter, config: run.config, runStatus: run.state.status })
  const builds = useDevenvQuery({ adapter, config: run.config, argv: BUILD_ARGV, kind: 'builds', normalise: normaliseBuilds, runStatus: run.state.status })
  const [clean, setClean] = React.useState(false)
  const [modal, setModal] = React.useState(null)
  const [query, setQuery] = React.useState('')
  const [actionError, setActionError] = React.useState(null)
  const [title, setTitle] = React.useState(null)
  const [dismissed, setDismissed] = React.useState(undefined)
  const last = React.useRef(null)

  const go = (argv, { exclusive = true, label } = {}) => {
    setActionError(null)
    setDismissed(undefined)
    setTitle(label || null)
    last.current = { argv, exclusive, label }
    run.start(argv, { exclusive, label: `devenv ${argv.join(' ')}` })
  }
  const build = (action, label) => {
    let argv
    try { argv = buildBuildArgv(action) } catch (e) { setActionError(e.message); return }
    go(argv, { label })
  }
  const tryArgv = (fn, label) => { try { go(fn(), { label }) } catch (e) { setActionError(e.message) } }
  // devenv asks which branch through its prompt, which the run context shows as the branch picker.
  const branch = item => tryArgv(() => buildBranchArgv(item.key), `Change branch: ${item.label}`)
  const mobileSource = () => mobile?.source && (
    <div className="nx-list-row">
      <div className="nx-muted nx-trunc" style={{ flex: 1, fontSize: 13 }}>Branch: <span style={{ color: 'var(--text)' }}>{sourceText(mobile)}</span></div>
      <button className="btn sm ghost" disabled={busy} aria-label={`Change branch for ${mobile.label}`} onClick={() => branch(mobile)}>Branch…</button>
    </div>
  )

  const services = status ? [
    ...status.backend.map(b => ({ key: b.key, label: b.label, state: b.state, meta: `port ${b.port}` })),
    ...status.infra.map(i => ({ key: i.service, label: i.service, state: i.state, meta: i.state })),
  ] : []
  const up = services.filter(s => s.state === 'running').length
  const isUp = status ? status.backend.some(b => b.state === 'running') : false
  const apis = builds.data?.apis ?? []
  const stale = apis.filter(a => !a.upToDate && !a.error).length
  const mobile = builds.data?.mobile
  const emu = status?.android.emulator
  const drafts = hasProfileDrafts(run.config)

  const actions = [
    { title: 'Start environment…', group: 'Environment', run: () => setModal('start') },
    { title: 'Stop environment', group: 'Environment', run: () => go(['stop'], { label: 'Stop environment' }) },
    { title: 'Health check', group: 'Environment', run: () => go(['doctor'], { exclusive: false, label: 'Health check' }) },
    { title: 'Build all APIs', group: 'Builds', run: () => build({ kind: 'apis', clean }, 'Build all APIs') },
    { title: 'Run all tests', group: 'Tests', run: () => tryArgv(() => buildTestRunArgv({}), 'Run all tests') },
    { title: 'Start test stack', group: 'Tests', run: () => tryArgv(() => buildTestUpArgv({}), 'Start test stack') },
    { title: 'Build Android app', group: 'Android', run: () => build({ kind: 'mobile', abi: 'x64', deploy: 'fast', install: true }, 'Build Android app and install') },
    { title: 'Build for iOS simulator', group: 'iOS', run: () => build({ kind: 'ios', device: '', noRun: false }, 'Build for iOS simulator') },
    { title: 'Edit profile', group: 'Profile', run: () => setModal('profile') },
  ]
  const q = query.trim().toLowerCase()
  const shown = actions.filter(a => !q || `${a.title} ${a.group}`.toLowerCase().includes(q)).slice(0, q ? 6 : 5)

  const st = run.state
  // A run has no id while it is starting, so the drawer shows then too; closing hides it for that run only.
  const showDrawer = st.status !== 'idle' && st.runId !== dismissed
  const [mTitle, ModalView, size] = modal ? MODALS[modal] : [null, null, null]
  const problem = actionError || error || builds.error

  return (
    <div className="nx-shell">
    <div className="nx-page">
      <header className="nx-head">
        <div>
          <div className="nx-eyebrow">Workspace</div>
          <h2 className="nx-title">Dev Environment</h2>
        </div>
        <div className="nx-head-actions">
          <span className="nx-subtle" style={{ fontSize: 12 }}>{status?.at ? `Updated ${new Date(status.at).toLocaleTimeString()}` : loading ? 'Loading…' : ''}</span>
          <span className={`nx-badge lg ${isUp ? 'ok' : ''}`}>{status ? (isUp ? `Running · ${up} of ${services.length} services` : 'Stopped') : '…'}</span>
          <button className="btn sm ghost" disabled={loading} onClick={() => { refresh(); builds.refresh() }} aria-label="Refresh">Refresh</button>
          <button className="btn sm" disabled={busy} onClick={() => go(['doctor'], { exclusive: false, label: 'Health check' })}>Health check</button>
          {isUp
            ? <button className="btn sm" disabled={busy} onClick={() => go(['stop'], { label: 'Stop environment' })}>Stop environment</button>
            : <button className="btn sm accent" disabled={busy} onClick={() => setModal('start')}>Start environment</button>}
        </div>
      </header>

      {problem && <div className="nx-alert bad" role="alert">{problem}</div>}
      {status && !status.docker.ok && <div className="nx-alert" role="alert">{status.docker.error || "Docker isn't running. Start Docker Desktop, then refresh."}</div>}

      <div className="nx-grid3">
        <Tile title="Services" meta={status ? `${up} of ${services.length} up` : null}
          actions={<>
            <button className="btn sm" disabled={busy} onClick={() => go(['backend', 'up'], { label: 'Start backend' })}>Start backend</button>
            <button className="btn sm ghost" disabled={busy} onClick={() => go(['backend', 'down'], { label: 'Stop backend' })}>Stop backend</button>
          </>}>
          {!status && <span className="nx-muted">Loading…</span>}
          {services.map(s => <Line key={s.key} state={s.state} meta={s.meta}>{s.label}</Line>)}
        </Tile>

        <Tile title="Builds" meta={builds.data ? (stale ? `${stale} need a build` : 'All up to date') : null}
          actions={<>
            <button className="btn sm accent" disabled={busy} onClick={() => build({ kind: 'apis', clean }, clean ? 'Clean build of all APIs' : 'Build all APIs')}>Build all</button>
            <label className="row" style={{ fontSize: 12.5 }}><input type="checkbox" checked={clean} onChange={e => setClean(e.target.checked)} aria-label="Clean first" />Clean first</label>
            <button className="nx-link" onClick={() => setModal('builds')}>Build options…</button>
          </>}>
          {builds.loading && !builds.data && <span className="nx-muted">Loading build status…</span>}
          <div>
            {apis.map(a => (
              <div key={a.key} className="nx-list-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="nx-strong">{a.label}</div>
                  <div className={a.error ? '' : 'nx-muted nx-trunc'} style={{ fontSize: 12, color: a.error ? 'var(--danger)' : undefined }} title={builtText(a.built)}>{a.error || sourceText(a)}</div>
                </div>
                <span className={`nx-badge ${a.error ? 'bad' : a.upToDate ? 'ok' : 'warn'}`}>{a.error ? 'Unavailable' : a.upToDate ? 'Up to date' : 'Needs build'}</span>
                <button className="btn sm ghost" disabled={busy} aria-label={`Change branch for ${a.label}`} onClick={() => branch(a)}>Branch…</button>
                <button className="btn sm ghost" disabled={busy || !!a.error} aria-label={`Build ${a.label}`} onClick={() => build({ kind: 'api', key: a.key, clean }, `Build ${a.label}`)}>Build</button>
              </div>
            ))}
          </div>
        </Tile>

        <Tile title="Tests" meta={status ? (status.test.tracer === 'running' ? 'Test stack up' : 'Test stack down') : null}
          actions={<>
            <button className="btn sm" disabled={busy} onClick={() => tryArgv(() => buildTestRunArgv({}), 'Run all tests')}>Run all tests</button>
            <button className="btn sm ghost" disabled={busy} onClick={() => tryArgv(() => buildTestUpArgv({}), 'Start test stack')}>Start test stack</button>
            <button className="nx-link" onClick={() => setModal('tests')}>Choose tests…</button>
          </>}>
          {status && <>
            <Line state={status.test.tracer}>Request tracer</Line>
            {status.test.apis.map(t => <Line key={t.key} state={t.state} meta={`port ${t.port}`}>{t.label}</Line>)}
          </>}
        </Tile>

        <Tile title="Database" actions={<button className="btn sm" onClick={() => setModal('database')}>Open database tools</button>}>
          {status && <>
            <Line state={status.database.state} meta="port 14330">SQL Server</Line>
            <Line state={status.database.ui}>Database editor</Line>
            <div className="nx-muted" style={{ fontSize: 13 }}>Baseline: <span style={{ color: 'var(--text)' }}>{status.database.baseline || 'none saved'}</span></div>
          </>}
        </Tile>

        <Tile title="Android"
          actions={<>
            <button className="btn sm" disabled={busy} onClick={() => build({ kind: 'mobile', abi: 'x64', deploy: 'fast', install: true }, 'Build Android app and install')}>Build and install</button>
            <button className="btn sm ghost" disabled={busy} onClick={() => build({ kind: 'app-install' }, 'Install last build')}>Install last build</button>
            <button className="nx-link" onClick={() => setModal('builds')}>ABI and deploy…</button>
            <button className="nx-link" onClick={() => setModal('emulator')}>Emulator…</button>
          </>}>
          {status && <>
            <Line state={emu?.running ? 'running' : 'stopped'}>{emu?.running ? `Emulator · ${emu.avd} (${emu.serial})` : 'Emulator stopped'}</Line>
            <Line state={status.android.proxy} meta="port 8888">Network proxy</Line>
          </>}
          {mobileSource()}
          {mobile && <div className="nx-muted" style={{ fontSize: 13 }}>Last build: <span style={{ color: 'var(--text)' }}>{mobile.mode ? `${mobile.mode.deploy} deploy, ${mobile.mode.abi} · ` : ''}{builtText(mobile.built)}</span></div>}
        </Tile>

        <Tile title="iOS on Mac"
          actions={<>
            <button className="btn sm" disabled={busy || !status?.ios.host} onClick={() => build({ kind: 'ios', device: '', noRun: false }, 'Build for iOS simulator')}>Build for simulator</button>
            <button className="nx-link" onClick={() => setModal('builds')}>Device…</button>
            <button className="nx-link" onClick={() => setModal('mac')}>Mac settings…</button>
          </>}>
          {status && (status.ios.host
            ? <Line state="running" meta="connected">{status.ios.host}</Line>
            : <Line state="stopped">{status.ios.error || 'No Mac configured'}</Line>)}
          {mobileSource()}
          {mobile && <div className="nx-muted" style={{ fontSize: 13 }}>Last build: <span style={{ color: 'var(--text)' }}>{mobile.ios ? builtText(mobile.ios) : 'None yet'}</span></div>}
        </Tile>

        <Tile title="Logs" actions={<button className="btn sm" onClick={() => setModal('logs')}>Open logs</button>}>
          <div>
            {services.map(s => (
              <div key={s.key} className="nx-list-row">
                <span className="nx-dot" data-state={s.state} />
                <span style={{ flex: 1 }} className="nx-trunc">{s.label}</span>
                <button className="nx-link" onClick={() => setModal('logs')}>View</button>
              </div>
            ))}
          </div>
        </Tile>

        <Tile title="Profile" meta={drafts ? <span className="nx-badge warn">Unsaved changes</span> : null}
          actions={<>
            <button className="btn sm" onClick={() => setModal('profile')}>Open editor</button>
            <button className="btn sm ghost" disabled={busy} onClick={() => go(['doctor'], { exclusive: false, label: 'Check profile' })}>Check profile</button>
          </>}>
          <span className="nx-muted" style={{ fontSize: 13 }}>Your personal settings for this environment: environment.json, mac.json and any service overrides.</span>
        </Tile>

        <Tile title="More actions" actions={<button className="btn sm ghost" onClick={() => setModal('commands')}>All actions…</button>}>
          <input className="nx-input" placeholder="Search actions…" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search actions" />
          <div>
            {shown.map(a => (
              <button key={a.title} className="nx-action" disabled={busy && a.group !== 'Profile'} onClick={a.run}>
                <span>{a.title}</span><span className="nx-tag">{a.group}</span>
              </button>
            ))}
            {!shown.length && <button className="nx-action" onClick={() => setModal('commands')}><span>Search all actions for "{query}"</span></button>}
          </div>
        </Tile>
      </div>

      {modal && (
        <PlModal open title={mTitle} icon={MODAL_ICONS[modal] || 'build'} onClose={() => setModal(null)} className={size === 'lg' ? 'nx-modal-lg' : size === 'xl-auto' ? 'nx-modal-xl auto' : 'nx-modal-xl'}>
          <div className={size === 'lg' ? undefined : size === 'xl-pad' ? 'nx-modal-fill nx-modal-pad' : 'nx-modal-fill'}
            style={size === 'lg' ? { minHeight: 360, display: 'flex', flexDirection: 'column' } : undefined}>
            <ModalView adapter={adapter} picker={picker} {...(modal === 'builds' ? { builds } : {})} />
          </div>
        </PlModal>
      )}
    </div>

      {showDrawer && (
        <RunDrawer
          title={title && st.command === `devenv ${last.current?.argv.join(' ')}` ? title : friendly(st.command)}
          status={st.status} lines={st.lines} step={st.step} error={st.error} cancelling={st.cancelling} exitCode={st.exitCode}
          onCancel={run.cancel} onClose={() => setDismissed(st.runId)}
          onRetry={last.current ? () => go(last.current.argv, last.current) : undefined} />
      )}
    </div>
  )
}
