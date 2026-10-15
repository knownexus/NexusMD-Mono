import React from 'react'
import { parentLabel } from '@nexusmd/core'
import { DiffPane } from './diff-pane.jsx'
import { MISSING_COMMIT } from './use-commit.js'

const short = oid => (oid ? oid.slice(0, 7) : '')
const EMPTY_DIFF = { result: null, files: [], error: null, loading: false }
const STATUS_COLOUR = { A: 'var(--success)', D: 'var(--danger)', M: 'var(--warning)', R: 'var(--accent)', C: 'var(--accent)' }

function CopyId({ oid }) {
  const [copied, setCopied] = React.useState(false)
  React.useEffect(() => {
    if (!copied) return undefined
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])
  const copy = async () => {
    try { await navigator.clipboard.writeText(oid); setCopied(true) } catch { /* clipboard refused; nothing to undo */ }
  }
  return <button className="btn sm ghost" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
}

/** The focused commit: who and when, its message, its parents, its files and the focused file's diff. */
export function CommitDetail({ commit, oid, parentIndex, onParent, focusedPath, onFile, onJump, filesRef }) {
  if (!oid) return <div style={{ color: 'var(--text-muted)' }}>Select a commit to see what it changed.</div>
  if (commit.missing) return <div role="note">{MISSING_COMMIT}</div>
  if (commit.error) return <div role="alert" style={{ color: 'var(--danger)' }}>{commit.error}</div>
  const d = commit.details
  if (!d) return <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
  const files = commit.files ?? []
  const focusIndex = files.findIndex(f => f.path === focusedPath)
  const focused = focusIndex >= 0 ? files[focusIndex] : null
  const onFilesKey = e => {
    if (!files.length) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = focusIndex < 0 ? 0 : Math.min(files.length - 1, Math.max(0, focusIndex + (e.key === 'ArrowDown' ? 1 : -1)))
      onFile(files[next].path)
    }
  }
  return (
    <section aria-label="Commit" style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, overflow: 'auto' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <code>{d.oid}</code>
        <CopyId oid={d.oid} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        <div>{`${d.author} <${d.authorEmail}> · ${d.authorDate}`}</div>
        {(d.committer !== d.author || d.committerEmail !== d.authorEmail) && <div>{`Committed by ${d.committer} <${d.committerEmail}> · ${d.committerDate}`}</div>}
      </div>
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{d.message}</pre>
      {d.parents.length > 0 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
          <span style={{ color: 'var(--text-muted)' }}>{d.parents.length > 1 ? 'Parents' : 'Parent'}</span>
          {d.parents.map(p => <button key={p} className="btn sm ghost" onClick={() => onJump(p)}>{short(p)}</button>)}
        </div>
      )}
      {d.parents.length > 1 && (
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
          Compare with parent
          <select aria-label="Compare with parent" value={parentIndex} onChange={e => onParent(Number(e.target.value))}>
            {d.parents.map((_, i) => <option key={i} value={i}>{parentLabel(d, i)}</option>)}
          </select>
        </label>
      )}
      <div ref={filesRef} role="listbox" aria-label="Files in commit" tabIndex={0} onKeyDown={onFilesKey}
        aria-activedescendant={focused ? `cfile-${focusIndex}` : undefined} style={{ fontSize: 13 }}>
        {commit.files === null && <span style={{ color: 'var(--text-muted)' }}>Loading files…</span>}
        {commit.files && !files.length && <span style={{ color: 'var(--text-muted)' }}>No file changes against this parent.</span>}
        {files.map((f, i) => (
          <div key={`${f.status}:${f.oldPath ?? ''}:${f.path}`} id={`cfile-${i}`} role="option" aria-selected={f.path === focusedPath}
            onClick={() => onFile(f.path)}
            style={{ display: 'flex', gap: 8, cursor: 'pointer', padding: '1px 4px',
              background: f.path === focusedPath ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : undefined }}>
            <span style={{ fontFamily: 'var(--font-mono, monospace)', color: STATUS_COLOUR[f.status] ?? 'var(--text-muted)' }}>{f.status}</span>
            <span>{f.path}</span>
            {f.oldPath && <span style={{ color: 'var(--text-muted)' }}>{`← ${f.oldPath}`}</span>}
          </div>
        ))}
      </div>
      {focused && (
        // The whole commit pane scrolls; without flex: none the diff would shrink to nothing in it.
        <div style={{ flex: 'none' }}>
          <DiffPane change={{ id: `commit\0${focused.path}`, area: 'commit', path: focused.path }}
            diff={commit.diff ?? EMPTY_DIFF} readOnly
            sides={{ old: commit.parent ? short(commit.parent) : 'empty', new: short(d.oid), staging: null }} />
        </div>
      )}
    </section>
  )
}
