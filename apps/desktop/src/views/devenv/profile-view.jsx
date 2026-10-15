import React from 'react'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { EnvironmentForm } from './environment-form.jsx'
import { MacForm } from './mac-form.jsx'
import { ProfileFileEditor } from './profile-file-editor.jsx'
import { hasProfileDraft, profileDraftPaths, useProfileDraftsVersion } from './use-profile-file.js'
import { RunPanel } from './run-panel.jsx'

const FORMS = { 'environment.json': EnvironmentForm, 'mac.json': MacForm }

export function ProfileView({ adapter }) {
  const run = useDevenvRunContext()
  const config = run.config
  const [info, setInfo] = React.useState(null)
  const [files, setFiles] = React.useState([])
  const [truncated, setTruncated] = React.useState(false)
  const [error, setError] = React.useState(null)
  const [selected, setSelected] = React.useState('environment.json')

  const refresh = React.useCallback(async () => {
    setError(null)
    try {
      const i = await adapter.profileInfo(config)
      setInfo(i)
      const list = i.exists ? await adapter.profileList(config) : null
      setFiles(list ? list.files.map(x => x.path) : [])
      setTruncated(!!list?.truncated)
    } catch (e) { setError(e?.message || 'Could not read the profile.') }
  }, [adapter, config])
  React.useEffect(() => { refresh() }, [refresh])

  const create = async () => {
    setError(null)
    try { await adapter.profileCreate(config); await refresh() } catch (e) { setError(e?.message || 'Could not create the profile.') }
  }
  useProfileDraftsVersion()
  const choose = p => setSelected(p)
  const draftPaths = profileDraftPaths(config)
  const paths = info?.exists ? [...new Set([...files, 'mac.json', ...draftPaths])].sort((a, b) => a.localeCompare(b)) : []
  const label = p => {
    if (files.includes(p)) return p
    if (p === 'mac.json') return 'mac.json (not created yet)'
    return `${p} (deleted on disk)`
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, flex: 1 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>{info ? `${info.dir}${info.isDefault ? " (devenv's profile folder)" : ' (from Settings)'}` : '…'}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn sm ghost" onClick={refresh}>Refresh</button>
          <button className="btn sm" disabled={!info?.exists} onClick={() => run.start(['doctor'], { exclusive: false, label: 'devenv doctor' })}>Check</button>
        </span>
      </div>
      {error && <div className="card" role="alert" style={{ padding: 10, color: 'var(--danger)' }}>{error}</div>}
      {info && !info.exists && (
        <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span>{`No profile at ${info.dir} yet.`}</span>
          {info.example
            ? <button className="btn sm primary" style={{ alignSelf: 'flex-start' }} onClick={create}>Create from template</button>
            : <span style={{ color: 'var(--text-muted)' }}>There is no profile.example in the devenv folder to start from.</span>}
        </div>
      )}
      {info?.exists && (
        <div style={{ display: 'flex', gap: 12, minHeight: 0, flex: 1 }}>
          <nav aria-label="Profile files" style={{ width: 260, flex: 'none', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {paths.map(p => {
              const unsaved = hasProfileDraft(config, p)
              return (
                <button key={p} className={`btn sm ${p === selected ? '' : 'ghost'}`} aria-current={p === selected ? 'true' : undefined}
                  aria-label={unsaved ? `${label(p)}, unsaved changes` : label(p)} title={unsaved ? 'Unsaved changes' : undefined}
                  style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => choose(p)}>
                  {label(p)}{unsaved && <span aria-hidden="true"> •</span>}
                </button>
              )
            })}
            {truncated && <span style={{ color: 'var(--text-muted)', fontSize: 12, padding: '4px 8px' }}>Only the first 2000 files are listed.</span>}
          </nav>
          <ProfileFileEditor key={selected} adapter={adapter} config={config} path={selected} onSaved={refresh} forms={FORMS} />
        </div>
      )}
      {run.state.command === 'devenv doctor' && run.state.status !== 'idle' && <RunPanel state={run.state} onCancel={run.cancel} />}
    </div>
  )
}
