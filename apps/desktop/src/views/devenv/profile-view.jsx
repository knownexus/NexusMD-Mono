import React from 'react'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { EnvironmentForm } from './environment-form.jsx'
import { MacForm } from './mac-form.jsx'
import { ProfileFileEditor } from './profile-file-editor.jsx'
import { hasProfileDraft, profileDraftPaths, useProfileDraftsVersion } from './use-profile-file.js'
import { RunPanel } from './run-panel.jsx'

const FORMS = { 'environment.json': EnvironmentForm, 'mac.json': MacForm }

// "docker/api.json" shows as a muted "docker/" and a plain "api.json".
function FileName({ path, note }) {
  const cut = path.lastIndexOf('/') + 1
  return (
    <span className="nx-trunc" style={{ minWidth: 0 }}>
      {cut > 0 && <span className="dir">{path.slice(0, cut)}</span>}
      {path.slice(cut)}
      {note && <span className="ghost">{` ${note}`}</span>}
    </span>
  )
}

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
  const draftPaths = profileDraftPaths(config)
  const paths = info?.exists ? [...new Set([...files, 'mac.json', ...draftPaths])].sort((a, b) => a.localeCompare(b)) : []
  const note = p => (files.includes(p) ? null : p === 'mac.json' ? '(not created yet)' : '(deleted on disk)')
  const label = p => (note(p) ? `${p} ${note(p)}` : p)
  const doctor = run.state.command === 'devenv doctor' && run.state.status !== 'idle'

  return (
    <div className="nx-modal-fill">
      <div className="nx-profile">
        <div className="nx-profile-bar">
          <span className="nx-muted" style={{ fontSize: 12.5 }}>Folder</span>
          <span className="nx-mono nx-trunc" style={{ fontSize: 12.5, minWidth: 0, flex: '0 1 auto' }} title={info?.dir}>{info ? info.dir : '…'}</span>
          {info && <span className="nx-badge">{info.isDefault ? "devenv's profile folder" : 'From Settings'}</span>}
          <span className="row" style={{ marginLeft: 'auto', gap: 8 }}>
            <button className="btn sm ghost" onClick={refresh}>Refresh</button>
            <button className="btn sm" disabled={!info?.exists} onClick={() => run.start(['doctor'], { exclusive: false, label: 'devenv doctor' })}>Check profile</button>
          </span>
        </div>

        {info?.exists && (
          <nav aria-label="Profile files" className="nx-profile-files">
            {paths.map(p => {
              const unsaved = hasProfileDraft(config, p)
              return (
                <button key={p} className="nx-file" aria-current={p === selected ? 'true' : undefined}
                  aria-label={unsaved ? `${label(p)}, unsaved changes` : label(p)} title={unsaved ? 'Unsaved changes' : p} onClick={() => setSelected(p)}>
                  <FileName path={p} note={note(p)} />
                  {unsaved && <span className="mark" aria-hidden="true">•</span>}
                </button>
              )
            })}
            {truncated && <span className="nx-field-hint" style={{ padding: '6px 10px' }}>Only the first 2000 files are listed.</span>}
          </nav>
        )}

        <div className="nx-profile-main" style={info?.exists ? undefined : { gridColumn: '1 / -1' }}>
          {error && <div className="nx-editor-notes"><div className="nx-alert bad" role="alert">{error}</div></div>}
          {info && !info.exists && (
            <div className="nx-editor-body">
              <div className="nx-section" style={{ maxWidth: 520 }}>
                <div className="nx-section-body">
                  <span className="nx-strong">{`No profile at ${info.dir} yet.`}</span>
                  {info.example
                    ? <>
                        <span className="nx-section-note">Start from devenv's template, then fill in your own settings here.</span>
                        <button className="btn sm accent" style={{ alignSelf: 'flex-start' }} onClick={create}>Create from template</button>
                      </>
                    : <span className="nx-section-note">There is no profile.example in the devenv folder to start from.</span>}
                </div>
              </div>
            </div>
          )}
          {info?.exists && <ProfileFileEditor key={selected} adapter={adapter} config={config} path={selected} onSaved={refresh} forms={FORMS} />}
          {doctor && <div style={{ padding: '0 20px 16px', display: 'flex', minHeight: 0 }}><RunPanel state={run.state} onCancel={run.cancel} /></div>}
        </div>
      </div>
    </div>
  )
}
