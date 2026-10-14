import React from 'react'
import { isProfilePath } from '@nexusmd/core'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { useProfileFiles } from './use-profile-files.js'
import { hasDraft, useDraftsVersion } from './profile-drafts.js'
import { ProfileEditor } from './profile-editor.jsx'
import { RunPanel } from './run-panel.jsx'
import { inputStyle } from './profile-fields.jsx'

const PINNED = [
  { path: 'environment.json', label: 'Environment' },
  { path: 'mac.json', label: 'Mac' },
]
const MINE = ['devenv setup profile', 'devenv doctor']
const isMine = cmd => MINE.includes(cmd)
const folderOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const nameOf = p => p.slice(p.lastIndexOf('/') + 1)

function FileButton({ label, path, selected, draft, muted, onSelect }) {
  return (
    <button className={`btn sm ${selected ? '' : 'ghost'}`} aria-pressed={selected} title={path}
      style={{ justifyContent: 'flex-start', textAlign: 'left', color: muted ? 'var(--text-muted)' : undefined }} onClick={() => onSelect(path)}>
      {label}{draft ? <span aria-label="unsaved"> •</span> : null}
    </button>
  )
}

function NewFile({ files, onCreate }) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [error, setError] = React.useState(null)
  const create = () => {
    const p = name.trim().replace(/\\/g, '/')
    if (!isProfilePath(p)) { setError('Use a path inside the profile, like sql/cleanup.sql.'); return }
    if (files.some(f => f.path.toLowerCase() === p.toLowerCase())) { setError(`${p} already exists.`); return }
    onCreate(p)
    setOpen(false); setName(''); setError(null)
  }
  if (!open) return <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>New file…</button>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <input aria-label="New file path" autoFocus style={inputStyle} placeholder="sql/cleanup.sql" value={name}
        onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') create(); if (e.key === 'Escape') setOpen(false) }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn sm" onClick={create}>Create</button>
        <button className="btn sm ghost" onClick={() => { setOpen(false); setError(null) }}>Cancel</button>
      </div>
      {error && <span role="note" style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</span>}
    </div>
  )
}

export function ProfileView({ adapter, picker }) {
  const run = useDevenvRunContext()
  const busy = run.state.status === 'starting' || run.state.status === 'running'
  const profile = useProfileFiles({ adapter, config: run.config, runStatus: run.state.status })
  const [selected, setSelected] = React.useState(null)
  const [created, setCreated] = React.useState([])
  useDraftsVersion()

  const go = (argv, exclusive) => run.start(argv, { exclusive, label: `devenv ${argv.join(' ')}` })
  const dir = profile.dir
  const current = selected ?? (profile.exists ? 'environment.json' : null)
  const pinnedPaths = PINNED.map(p => p.path)
  const listed = profile.files.map(f => f.path)
  const others = [...new Set([...listed, ...created])]
    .filter(p => !pinnedPaths.includes(p.toLowerCase()))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  const has = p => listed.some(l => l.toLowerCase() === p)
  let lastFolder = null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      {profile.error && <div className="card" role="alert" style={{ padding: 10, color: 'var(--danger)' }}>{profile.error}</div>}

      <div className="card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Profile folder</span>
          <strong style={{ overflowWrap: 'anywhere' }}>{dir ?? '…'}</strong>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{run.config?.profile ? '(from Settings)' : "(devenv's default)"}</span>
        </div>
        <button className="btn sm ghost" disabled={!profile.exists} onClick={() => adapter.open({ path: dir }).catch(() => {})}>Open folder</button>
        <button className="btn sm" disabled={busy || !profile.exists} onClick={() => go(['doctor'], false)}>Check</button>
        <button className="btn sm ghost" disabled={profile.loading} onClick={profile.refresh}>Refresh</button>
      </div>

      {profile.loaded && !profile.exists && (
        <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <strong>{`No profile at ${dir} yet.`}</strong>
          <span style={{ color: 'var(--text-muted)' }}>Copies devenv's profile.example; files that already exist are kept.</span>
          <button className="btn sm primary" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => go(['setup', 'profile'], true)}>Create from template</button>
        </div>
      )}

      {isMine(run.state.command) && run.state.status !== 'idle' && <RunPanel state={run.state} onCancel={run.cancel} />}

      {profile.exists && dir && (
        <div style={{ display: 'flex', gap: 12, minHeight: 0, alignItems: 'flex-start' }}>
          <nav aria-label="Profile files" style={{ width: 240, flex: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {PINNED.map(p => (
              <FileButton key={p.path} path={p.path} selected={current === p.path} draft={hasDraft(dir, p.path)}
                label={has(p.path) ? p.label : `${p.label} (not set up)`} muted={!has(p.path)} onSelect={setSelected} />
            ))}
            {others.map(p => {
              const folder = folderOf(p)
              const header = folder !== lastFolder && folder ? <div key={`h:${folder}`} style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{folder}/</div> : null
              lastFolder = folder
              return (
                <React.Fragment key={p}>
                  {header}
                  <FileButton path={p} label={nameOf(p)} selected={current === p} draft={hasDraft(dir, p)} onSelect={setSelected} />
                </React.Fragment>
              )
            })}
            {profile.truncated && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Showing the first 2000 files.</span>}
            <NewFile files={profile.files} onCreate={p => { setCreated(c => [...c, p]); setSelected(p) }} />
          </nav>
          <div style={{ flex: 1, minWidth: 0 }}>
            {current && (
              <ProfileEditor key={`${dir}\u0000${current}`} adapter={adapter} config={run.config} dir={dir} path={current} picker={picker}
                busyLabel={busy ? run.state.command : null} onSaved={() => profile.refresh()} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
