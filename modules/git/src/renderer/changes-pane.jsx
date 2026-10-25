import React from 'react'
import { statusCode, groupChanges, actionsFor, toggleSelection, rangeSelection, isSubmodule, conflictLabels, conflictKind, checkoutName } from '@nexusmd/core'
import { CommitComposer } from './commit-composer.jsx'
import { ContextMenu, menuPoint } from './context-menu.jsx'

const VERB = { stage: 'Stage', unstage: 'Unstage', discard: 'Discard', delete: 'Delete' }
const DESTRUCTIVE = new Set(['discard', 'delete'])
// Only a conflict both sides changed gets whole-file takes on its row; one where a side deleted or added the file
// is resolved from its own screen, whose wording says so (taking a deleting side removes the file).
const ROW_TAKES = new Set(['both-modified', 'both-added'])
const NONE = {
  stage: 'Select changes that can be staged',
  unstage: 'Select staged changes',
  discard: 'Select unstaged changes to tracked files',
  delete: 'Select untracked files',
}
// A repository can have tens of thousands of changed files (build output). Rows past this many are
// not drawn until asked for: every click re-renders the list, and drawing them all took tens of seconds.
export const ROWS_SHOWN = 300
const NOUN = { rebase: 'rebase', merge: 'merge', revert: 'revert', 'cherry-pick': 'cherry-pick' }

/** One status letter per row: U conflict, ? untracked, otherwise the change's own letter (M, A, D, R…). */
function letter(c) {
  if (c.area === 'conflict') return 'U'
  if (c.area === 'untracked') return '?'
  return statusCode(c).trim() || 'M'
}
const TONE = { U: 'bad', D: 'bad', A: 'ok', '?': 'ok' }

const split = p => {
  const i = p.lastIndexOf('/')
  return i < 0 ? { name: p, dir: '' } : { name: p.slice(i + 1), dir: p.slice(0, i) }
}

/** Conflicts, Staged and Not staged (unstaged and untracked), in display order; empty ones are left out. */
function sections(changes, operationKind) {
  const groups = groupChanges(changes)
  const of = area => groups.find(g => g.area === area)?.changes ?? []
  const op = NOUN[operationKind]
  return [
    { id: 'conflict', title: 'Conflicts', tone: 'bad', note: op ? `Resolve each file, then continue the ${op}.` : 'Resolve each file.', changes: of('conflict') },
    { id: 'staged', title: 'Staged', tone: 'ok', bulk: 'unstage', changes: of('staged') },
    { id: 'unstaged', title: 'Not staged', tone: 'warn', bulk: 'stage', changes: [...of('unstaged'), ...of('untracked')] },
  ].filter(s => s.changes.length)
}

function ChangeRow({ c, selected, focused, onFocus, onSelect, draft, labels, busy, onResolve, onWrite, onContext }) {
  const { name, dir } = split(c.path)
  const sub = isSubmodule(c)
  const l = letter(c)
  const takes = c.area === 'conflict' && labels && onResolve && ROW_TAKES.has(conflictKind(c.xy))
  const act = c.area === 'conflict' ? { label: 'Resolve', title: `Resolve ${c.path}`, run: () => onFocus(c.id) }
    : sub ? null
    : c.area === 'staged' ? { label: 'Unstage', title: `Unstage ${c.path}`, run: () => onWrite('unstage', [c.id]) }
    : { label: 'Stage', title: `Stage ${c.path}`, run: () => onWrite('stage', [c.id]) }
  return (
    <div className="nx-gw-file" aria-current={focused ? 'true' : undefined} title={c.path}
      onClick={e => (e.shiftKey ? onSelect(c.id, true) : onFocus(c.id))} onContextMenu={onContext ? e => onContext(e, c) : undefined}>
      <input type="checkbox" aria-label={`Select ${c.path}`} checked={selected} disabled={sub}
        onClick={e => e.stopPropagation()} onChange={e => onSelect(c.id, e.nativeEvent.shiftKey)} />
      <span className="nx-gw-file-code" data-tone={TONE[l] ?? 'warn'} title={statusCode(c)}>{l}</span>
      <span className="nx-gw-file-name">
        <span className="base">{name}</span>
        {dir && <span className="dir">{dir}</span>}
        {draft && <span role="img" aria-label="Unsaved edits" title="Unsaved edits" className="nx-gw-t" data-tone="warn">●</span>}
        {c.originalPath && <span className="dir">{`← ${c.originalPath}`}</span>}
        {sub && <span className="dir">submodule</span>}
      </span>
      {act
        ? (
          <button className="btn sm nx-gw-file-act" disabled={busy && c.area !== 'conflict'} aria-label={act.title} title={act.title}
            onClick={e => { e.stopPropagation(); act.run() }}>
            {act.label}
          </button>
        )
        : <span />}
      {takes && (
        <span className="nx-gw-file-takes" onClick={e => e.stopPropagation()}>
          {['left', 'right'].map(side => (
            <button key={side} className="btn sm ghost" disabled={busy} aria-label={`${labels[side].take} for ${c.path}`}
              onClick={() => { if (window.confirm(`Use ${labels[side].version} for the whole of ${c.path}?`)) onResolve(c, side) }}>
              {labels[side].take}
            </button>
          ))}
        </span>
      )}
    </div>
  )
}

function Section({ section, selected, focusId, onFocus, onSelect, onSelectionChange, drafts, labels, busy, onResolve, onWrite, onContext }) {
  const { title, changes } = section
  const [limit, setLimit] = React.useState(ROWS_SHOWN)
  const chosenSet = React.useMemo(() => new Set(selected), [selected])
  const draftSet = React.useMemo(() => new Set(drafts), [drafts])
  // The focused row is always drawn, so keyboard moves and reviews never land on a hidden file.
  const focusAt = focusId ? changes.findIndex(c => c.id === focusId) : -1
  const shown = Math.min(changes.length, Math.max(limit, focusAt + 1))
  const ids = changes.filter(c => !isSubmodule(c)).map(c => c.id)
  const chosen = ids.filter(id => chosenSet.has(id)).length
  const box = React.useRef(null)
  React.useEffect(() => { if (box.current) box.current.indeterminate = chosen > 0 && chosen < ids.length }, [chosen, ids.length])
  const toggleAll = () => onSelectionChange(chosen === ids.length
    ? selected.filter(id => !ids.includes(id))
    : [...selected, ...ids.filter(id => !selected.includes(id))])
  const bulk = section.bulk && ids.length > 0
  return (
    <div role="group" aria-label={`${title} (${changes.length})`} className="nx-gw-sec">
      <div className="nx-gw-sec-head">
        <input ref={box} type="checkbox" aria-label={`Select all ${title}`} checked={ids.length > 0 && chosen === ids.length}
          disabled={!ids.length} onChange={toggleAll} />
        <span className="nx-gw-dot" data-tone={section.tone} />
        <span className="nx-gw-sec-title">{title}</span>
        <span className="nx-gw-sec-n">{changes.length}</span>
        {bulk && (
          <button className="nx-gw-sec-btn" disabled={busy} onClick={() => onWrite(section.bulk, ids)}>
            {section.bulk === 'stage' ? 'Stage all' : 'Unstage all'}
          </button>
        )}
      </div>
      {section.note && <div className="nx-gw-sec-note">{section.note}</div>}
      {changes.slice(0, shown).map(c => (
        <ChangeRow key={c.id} c={c} selected={chosenSet.has(c.id)} focused={c.id === focusId} onFocus={onFocus} onSelect={onSelect}
          draft={draftSet.has(c.path)} labels={labels} busy={busy} onResolve={onResolve} onWrite={onWrite} onContext={onContext} />
      ))}
      {shown < changes.length && (
        <button className="nx-gw-sec-btn" style={{ margin: '6px 8px' }} onClick={() => setLimit(shown + ROWS_SHOWN * 4)}>
          {`Show ${Math.min(ROWS_SHOWN * 4, changes.length - shown)} more (${changes.length - shown} not shown)`}
        </button>
      )}
    </div>
  )
}

/**
 * A worktree's changed files (the left column of the Changes tab): the selection toolbar, sections with
 * per-row Stage / Unstage / Resolve, the last result, and the commit composer stuck to the bottom.
 * `onAction(action)` reviews the selection; `onWrite(action, ids)` stages or unstages straight away;
 * `onCommit({ message, amend, push })` commits this worktree. `onPopout(kind, change)` (editor | conflict | diff),
 * when given, adds the right-click menu that opens a change in a window of its own.
 */
export function ChangesPane({ tree, selected, onSelectionChange, focusId, onFocus, onAction, onWrite = () => {}, onCommit, onResolve = null, busy = false, status = null, drafts = [], onPopout = null }) {
  const [menu, setMenu] = React.useState(null)
  const [popError, setPopError] = React.useState(null)
  const closeMenu = React.useCallback(() => setMenu(null), [])
  const popout = async (kind, c) => {
    setPopError(null)
    try { await onPopout(kind, c) } catch (e) { setPopError(String(e?.message || e).replace(/^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/, '')) }
  }
  // A conflicted file is resolved, not edited, and a deleted one has nothing to edit; a submodule has neither.
  const onContext = onPopout ? (e, c) => {
    if (isSubmodule(c)) return
    const items = c.area === 'conflict'
      ? [{ label: 'Resolve in new window', onSelect: () => popout('conflict', c) }]
      : [
        ...(letter(c) === 'D' ? [] : [{ label: 'Edit in new window', onSelect: () => popout('editor', c) }]),
        { label: 'Diff in new window', onSelect: () => popout('diff', c) },
      ]
    e.preventDefault()
    setMenu({ ...menuPoint(e), label: c.path, items })
  } : undefined
  const list = sections(tree.changes, tree.operationInfo?.kind)
  const labels = conflictLabels(tree.operationInfo, checkoutName(tree))
  const ordered = list.flatMap(s => s.changes)
  const actions = actionsFor(tree.changes, selected)
  const root = React.useRef(null)
  const select = (id, shift) => onSelectionChange(shift && focusId ? rangeSelection(ordered, selected, focusId, id) : toggleSelection(selected, id))
  const run = action => { if (!busy && actions[action].length) onAction(action) }
  const write = (action, ids) => { if (!busy && ids.length) onWrite(action, ids) }
  // c goes to the commit summary (absent during an operation, when committing is paused).
  const compose = () => root.current?.querySelector('input[aria-label="Commit summary"]')?.focus()
  const onKeyDown = e => {
    // Ctrl+C is copy, not Commit; and keys on a row's own checkbox belong to that checkbox.
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target !== e.currentTarget && (e.target.tagName === 'INPUT' || e.target.closest('button'))) return
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
    else if (e.key === 'c') { e.preventDefault(); compose() }
  }
  return (
    <section ref={root} aria-label="Changes" className="nx-gw-files">
      <div role="toolbar" aria-label="File actions" className="nx-gw-files-tools">
        {Object.keys(VERB).map(a => {
          const n = actions[a].length
          return (
            <button key={a} className={`btn sm ghost${DESTRUCTIVE.has(a) ? ' danger' : ''}`} disabled={busy || !n} title={n ? undefined : NONE[a]}
              onClick={() => run(a)}>
              {`${VERB[a]}${n ? ` ${n}` : ''}${DESTRUCTIVE.has(a) ? '…' : ''}`}
            </button>
          )
        })}
        {busy && <span aria-live="polite" className="nx-gw-t" data-tone="muted">Working…</span>}
      </div>
      {status && (
        <div role={status.ok ? 'status' : 'alert'} className="nx-gw-files-status" data-tone={status.ok ? undefined : 'bad'}>
          {status.text}
        </div>
      )}
      {popError && <div role="alert" className="nx-gw-files-status" data-tone="bad">{popError}</div>}
      <ContextMenu menu={menu} onClose={closeMenu} />
      <div tabIndex={0} aria-label="Changed files" onKeyDown={onKeyDown} className="nx-gw-files-list">
        {!list.length
          ? (
            <div className="nx-gw-files-empty">
              <strong>Working tree clean</strong>
              <span>Nothing to stage or commit on this branch.</span>
            </div>
          )
          : list.map(s => (
            <Section key={s.id} section={s} selected={selected} focusId={focusId} onFocus={onFocus} onSelect={select} onSelectionChange={onSelectionChange}
              drafts={drafts} labels={labels} busy={busy} onResolve={onResolve} onWrite={write} onContext={onContext} />
          ))}
      </div>
      <CommitComposer tree={tree} busy={busy} onCommit={onCommit} />
    </section>
  )
}
