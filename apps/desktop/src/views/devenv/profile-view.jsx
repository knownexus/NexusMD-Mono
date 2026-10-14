import React from 'react'
import { PlModal } from '@nexusmd/ui'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { ProfileFileEditor } from './profile-file-editor.jsx'
import { discardProfileDraft } from './use-profile-file.js'
import { RunPanel } from './run-panel.jsx'

const FORMS = {}

export function ProfileView({ adapter }) {
  const run = useDevenvRunContext()
  const config = run.config
  const [info, setInfo] = React.useState(null)
  const [files, setFiles] = React.useState([])
  const [error, setError] = React.useState(null)
  const [selected, setSelected] = React.useState('environment.json')
  const [dirty, setDirty] = React.useState(false)
  const [pending, setPending] = React.useState(null)

  const refresh = React.useCallback(async () => {
    setError(null)
    try {
      const i = await adapter.profileInfo(config)
      setInfo(i)
      setFiles(i.exists ? (await adapter.profileList(config)).files.map(x => x.path) : [])
    } catch (e) { setError(e?.message || 'Could not read the profile.') }
  }, [adapter, config])
  React.useEffect(() => { refresh() }, [refresh])

  const create = async () => {
    setError(null)
    try { await adapter.profileCreate(config); await refresh() } catch (e) { setError(e?.message || 'Could not create the profile.') }
  }
  const choose = p => { if (p === selected) return; if (dirty) setPending(p); else setSelected(p) }
  const paths = info?.exists ? [...new Set([...files, 'mac.json'])].sort((a, b) => a.localeCompare(b)) : []
  const label = p => (p === 'mac.json' && !files.includes('mac.json') ? 'mac.json (not created yet)' : p)

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
            {paths.map(p => (
              <button key={p} className={`btn sm ${p === selected ? '' : 'ghost'}`} aria-current={p === selected ? 'true' : undefined}
                aria-label={label(p)} style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => choose(p)}>{label(p)}</button>
            ))}
          </nav>
          <ProfileFileEditor key={selected} adapter={adapter} config={config} path={selected} onDirtyChange={setDirty} forms={FORMS} />
        </div>
      )}
      <PlModal open={!!pending} onClose={() => setPending(null)} title="Unsaved changes"
        footer={<>
          <button className="btn sm ghost" onClick={() => setPending(null)}>Keep editing</button>
          <button className="btn sm danger" onClick={() => { discardProfileDraft(config, selected); setDirty(false); setSelected(pending); setPending(null) }}>Discard changes</button>
        </>}>
        <p>{`${selected} has unsaved changes.`}</p>
        <p style={{ color: 'var(--text-muted)' }}>Discarding keeps nothing - the file stays as it is on disk.</p>
      </PlModal>
      {run.state.command === 'devenv doctor' && run.state.status !== 'idle' && <RunPanel state={run.state} onCancel={run.cancel} />}
    </div>
  )
}
