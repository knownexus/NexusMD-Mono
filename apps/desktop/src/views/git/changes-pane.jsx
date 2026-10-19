import React from 'react'
import { statusCode, groupChanges, actionsFor, toggleSelection, rangeSelection, isSubmodule } from '@nexusmd/core'

const AREA_COLOUR = { staged: 'var(--success)', unstaged: 'var(--warning)', untracked: 'var(--warning)', conflict: 'var(--danger)' }
const VERB = { stage: 'Stage', unstage: 'Unstage', discard: 'Discard', delete: 'Delete' }
const DESTRUCTIVE = new Set(['discard', 'delete'])
const NONE = {
  stage: 'Select changes that can be staged',
  unstage: 'Select staged changes',
  discard: 'Select unstaged changes to tracked files',
  delete: 'Select untracked files',
}

function ChangeGroup({ group, selected, focusId, onFocus, onSelect, onSelectionChange, drafts }) {
  const ids = group.changes.filter(c => !isSubmodule(c)).map(c => c.id)
  const chosen = ids.filter(id => selected.includes(id)).length
  const box = React.useRef(null)
  React.useEffect(() => { if (box.current) box.current.indeterminate = chosen > 0 && chosen < ids.length }, [chosen, ids.length])
  const toggleAll = () => onSelectionChange(chosen === ids.length
    ? selected.filter(id => !ids.includes(id))
    : [...selected, ...ids.filter(id => !selected.includes(id))])
  const title = `${group.title} (${group.changes.length})`
  return (
    <div role="group" aria-label={title}>
      <label style={{ display: 'flex', gap: 6, fontWeight: 600, padding: '4px 0' }}>
        <input ref={box} type="checkbox" aria-label={`Select all ${group.title}`} checked={ids.length > 0 && chosen === ids.length}
          disabled={!ids.length} onChange={toggleAll} />
        {title}
      </label>
      {group.changes.map(c => (
        <div key={c.id} aria-current={c.id === focusId ? 'true' : undefined}
          onClick={e => (e.shiftKey ? onSelect(c.id, true) : onFocus(c.id))}
          style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 4px', cursor: 'pointer', background: c.id === focusId ? 'var(--accent-soft)' : undefined }}>
          <input type="checkbox" aria-label={`Select ${c.path}`} checked={selected.includes(c.id)} disabled={isSubmodule(c)}
            onClick={e => e.stopPropagation()} onChange={e => onSelect(c.id, e.nativeEvent.shiftKey)} />
          <span style={{ color: AREA_COLOUR[c.area], whiteSpace: 'pre' }}>{statusCode(c)}</span>
          <span>{c.path}</span>
          {drafts.includes(c.path) && <span role="img" aria-label="Unsaved edits" title="Unsaved edits" style={{ color: 'var(--warning)' }}>●</span>}
          {c.originalPath && <span style={{ color: 'var(--text-muted)' }}>{`← ${c.originalPath}`}</span>}
          {isSubmodule(c) && <span style={{ color: 'var(--text-muted)' }}>submodule</span>}
        </div>
      ))}
    </div>
  )
}

/** A worktree's changed files with selection, the file-action toolbar and the last result. */
export function ChangesPane({ tree, selected, onSelectionChange, focusId, onFocus, onAction, onCommit, busy = false, status = null, drafts = [] }) {
  const groups = groupChanges(tree.changes)
  const ordered = groups.flatMap(g => g.changes)
  const actions = actionsFor(tree.changes, selected)
  const canCommit = tree.changes.some(c => c.area === 'staged')
  const select = (id, shift) => onSelectionChange(shift && focusId ? rangeSelection(ordered, selected, focusId, id) : toggleSelection(selected, id))
  const run = action => { if (!busy && actions[action].length) onAction(action) }
  const commit = () => { if (!busy && canCommit) onCommit() }
  const onKeyDown = e => {
    // Ctrl+C is copy, not Commit; and keys on a row's own checkbox belong to that checkbox.
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target !== e.currentTarget && e.target.tagName === 'INPUT') return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const i = ordered.findIndex(c => c.id === focusId)
      const next = ordered[Math.min(ordered.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next) onFocus(next.id)
    } else if (e.key === ' ' && focusId) {
      e.preventDefault()
      select(focusId, e.shiftKey)
    } else if (e.key === 's') run('stage')
    else if (e.key === 'u') run('unstage')
    else if (e.key === 'c') commit()
  }
  return (
    <section aria-label="Changes" style={{ display: 'grid', gridTemplateRows: 'auto auto 1fr', gap: 8, minHeight: 0 }}>
      <div role="toolbar" aria-label="File actions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {Object.keys(VERB).map(a => {
          const n = actions[a].length
          return (
            <button key={a} className={`btn sm${DESTRUCTIVE.has(a) ? ' danger' : ''}`} disabled={busy || !n} title={n ? undefined : NONE[a]}
              onClick={() => run(a)}>
              {`${VERB[a]}${n ? ` ${n}` : ''}${DESTRUCTIVE.has(a) ? '…' : ''}`}
            </button>
          )
        })}
        <button className="btn sm" disabled={busy || !canCommit} title={canCommit ? undefined : 'Stage changes to commit'} onClick={commit}>Commit…</button>
        {busy && <span aria-live="polite" style={{ color: 'var(--text-muted)' }}>Working…</span>}
      </div>
      <div>
        {status && (
          <div role={status.ok ? 'status' : 'alert'} style={{ color: status.ok ? 'var(--text-muted)' : 'var(--danger)', whiteSpace: 'pre-wrap' }}>
            {status.text}
          </div>
        )}
      </div>
      {!groups.length
        ? <div style={{ color: 'var(--text-muted)' }}>No changes.</div>
        : (
          <div tabIndex={0} aria-label="Changed files" onKeyDown={onKeyDown} style={{ overflow: 'auto', minHeight: 0, fontFamily: 'var(--font-mono, monospace)' }}>
            {groups.map(g => (
              <ChangeGroup key={g.area} group={g} selected={selected} focusId={focusId} onFocus={onFocus} onSelect={select} onSelectionChange={onSelectionChange} drafts={drafts} />
            ))}
          </div>
        )}
    </section>
  )
}
