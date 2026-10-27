import React from 'react'
import { parentLabel } from '@nexusmd/core'
import { DiffPane } from './diff-pane.jsx'
import { MISSING_COMMIT } from './use-commit.js'
import { relativeTime } from './history-pane.jsx'

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
  return <button className="btn sm" onClick={copy}>{copied ? 'Copied' : 'Copy hash'}</button>
}

const when = iso => { const t = Date.parse(iso); return Number.isNaN(t) ? iso : relativeTime(t) }

function Counts({ file }) {
  if (file.added == null && file.removed == null) return null
  return (
    <span className="nx-gw-cfile-counts" aria-label={`${file.added} added, ${file.removed} removed`}>
      <span className="add">{`+${file.added}`}</span>{' '}<span className="del">{`−${file.removed}`}</span>
    </span>
  )
}

/**
 * The focused commit: its hash, subject, who and when, its actions (`actions`: [{ label, onSelect,
 * danger?, disabled?, title? }] after Copy hash), the rest of its message, its parents, a card of
 * the files it changed and the focused file's diff.
 */
export function CommitDetail({ commit, oid, parentIndex, onParent, focusedPath, onFile, onJump, filesRef, actions = [] }) {
  if (!oid) return <div style={{ color: 'var(--text-muted)' }}>Select a commit to see what it changed.</div>
  if (commit.missing) return <div role="note">{MISSING_COMMIT}</div>
  if (commit.error) return <div role="alert" style={{ color: 'var(--danger)' }}>{commit.error}</div>
  const d = commit.details
  if (!d) return <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
  const files = commit.files ?? []
  const [subject, ...rest] = d.message.split('\n')
  const body = rest.join('\n').trim()
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
    <section aria-label="Commit" className="nx-gw-cdetail">
      <div className="nx-gw-cdetail-hash" title={d.oid}>{short(d.oid)}</div>
      <h3 className="nx-gw-cdetail-subject">{subject}</h3>
      <div className="nx-gw-cdetail-who">
        <div title={`${d.author} <${d.authorEmail}> · ${d.authorDate}`}>{`${d.author} committed ${when(d.authorDate)}`}</div>
        {(d.committer !== d.author || d.committerEmail !== d.authorEmail) && <div>{`Committed by ${d.committer} <${d.committerEmail}> · ${d.committerDate}`}</div>}
      </div>
      <div className="nx-gw-cdetail-actions">
        <CopyId oid={d.oid} />
        {actions.map(a => (
          <button key={a.label} className={`btn sm${a.danger ? ' ghost danger' : ''}`} disabled={!!a.disabled} title={a.title} onClick={a.onSelect}>{a.label}</button>
        ))}
      </div>
      {body && <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13 }}>{body}</pre>}
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
      <div className="nx-gw-cfiles">
        <div className="nx-gw-cfiles-head">{commit.files ? `${files.length} file${files.length === 1 ? '' : 's'} changed` : 'Files changed'}</div>
        <div ref={filesRef} role="listbox" aria-label="Files in commit" tabIndex={0} onKeyDown={onFilesKey}
          aria-activedescendant={focused ? `cfile-${focusIndex}` : undefined}>
          {commit.files === null && <div className="nx-gw-cfile" style={{ color: 'var(--text-muted)', cursor: 'default' }}>Loading files…</div>}
          {commit.files && !files.length && <div className="nx-gw-cfile" style={{ color: 'var(--text-muted)', cursor: 'default' }}>No file changes against this parent.</div>}
          {files.map((f, i) => (
            <div key={`${f.status}:${f.oldPath ?? ''}:${f.path}`} id={`cfile-${i}`} role="option" aria-selected={f.path === focusedPath}
              className="nx-gw-cfile" onClick={() => onFile(f.path)}>
              <span style={{ fontFamily: 'var(--mono, monospace)', fontWeight: 600, color: STATUS_COLOUR[f.status] ?? 'var(--text-muted)' }}>{f.status}</span>
              <span className="nx-gw-cfile-path" title={f.path}>
                <span>{f.path}</span>
                {f.oldPath && <span style={{ color: 'var(--text-muted)' }}>{` `}<span>{`← ${f.oldPath}`}</span></span>}
              </span>
              <Counts file={f} />
            </div>
          ))}
        </div>
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
