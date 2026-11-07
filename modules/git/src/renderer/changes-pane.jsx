import React from 'react'
import { statusCode, groupChanges, actionsFor, isSubmodule, conflictLabels, conflictKind, checkoutName } from '@nexusmd/core'
import { ContextMenu, menuPoint } from './context-menu.jsx'
import { Icon, Segmented } from '@nexusmd/ui'
import { nextSelection } from './change-selection.js'
import { groupByFolder, filterChanges, BIG_LANE } from './change-folders.js'
import { useGitConfig } from './use-git-config.js'
import { getGitConfig, setGitConfig } from './git-config.js'

const ARROW = { stage: '↓', unstage: '↑' }
// Only a conflict both sides changed gets whole-file takes on its row; one where a side deleted or added the file
// is resolved from its own screen, whose wording says so (taking a deleting side removes the file).
const ROW_TAKES = new Set(['both-modified', 'both-added'])
// A repository can have tens of thousands of changed files (build output). Rows past this many are
// not drawn until asked for: every click re-renders the list, and drawing them all took tens of seconds.
export const ROWS_SHOWN = 300
const NOUN = { rebase: 'rebase', merge: 'merge', revert: 'revert', 'cherry-pick': 'cherry-pick' }
// The lanes' shares of the column's height: Not staged gets the larger share above Staged.
const ROWS_BY_LANES = { 1: 'minmax(0, 1fr)', 2: 'minmax(0, 1.3fr) minmax(0, 1fr)', 3: 'minmax(0, 1fr) minmax(0, 1.3fr) minmax(0, 1fr)' }

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

/**
 * The lanes top to bottom: Conflicts (during one), Not staged (unstaged and untracked) and Staged; empty
 * ones are left out. Not staged comes first so what is still to do sits above what is ready.
 */
function lanes(changes, operationKind) {
  const groups = groupChanges(changes)
  const of = area => groups.find(g => g.area === area)?.changes ?? []
  const op = NOUN[operationKind]
  return [
    { id: 'conflict', title: 'Conflicts', tone: 'bad', note: op ? `Resolve each file, then continue the ${op}.` : 'Resolve each file.', changes: of('conflict') },
    { id: 'unstaged', title: 'Not staged', tone: 'warn', bulk: 'stage', changes: [...of('unstaged'), ...of('untracked')] },
    { id: 'staged', title: 'Staged', tone: 'ok', bulk: 'unstage', changes: of('staged') },
  ].filter(l => l.changes.length)
}

function ChangeRow({ c, selected, focused, onRowClick, draft, labels, busy, onResolve, onWrite, onFocus, onContext }) {
  const { name, dir } = split(c.path)
  const sub = isSubmodule(c)
  const l = letter(c)
  const takes = c.area === 'conflict' && labels && onResolve && ROW_TAKES.has(conflictKind(c.xy))
  const act = c.area === 'conflict' ? { label: 'Resolve', title: `Resolve ${c.path}`, run: () => onFocus(c.id) }
    : sub ? null
    : c.area === 'staged' ? { label: ARROW.unstage, title: `Unstage ${c.path}`, run: () => onWrite('unstage', [c.id]) }
    : { label: ARROW.stage, title: `Stage ${c.path}`, run: () => onWrite('stage', [c.id]) }
  return (
    <div className="nx-gw-file" aria-current={focused ? 'true' : undefined} data-selected={selected || undefined} title={c.path}
      onClick={e => onRowClick(c, e)} onContextMenu={onContext ? e => onContext(e, c) : undefined}>
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
          <button className={`nx-gw-file-act${c.area === 'conflict' ? ' text' : ''}`} disabled={busy && c.area !== 'conflict'} aria-label={act.title} title={act.title}
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

// More files than ROWS_SHOWN in one list (or one folder) are not drawn until asked for.
function Rows({ changes, focusId, limit, onMore, more, row }) {
  const focusAt = focusId ? changes.findIndex(c => c.id === focusId) : -1
  const shown = Math.min(changes.length, Math.max(limit, focusAt + 1))
  return (
    <>
      {changes.slice(0, shown).map(c => (
        <ChangeRow key={c.id} c={c} focused={c.id === focusId} selected={row.chosen.has(c.id)} draft={row.drafts.has(c.path)} {...row} />
      ))}
      {shown < changes.length && (
        <button className="nx-gw-sec-btn nx-gw-more" onClick={() => onMore(shown + ROWS_SHOWN * 4)}>
          {more(Math.min(ROWS_SHOWN * 4, changes.length - shown), changes.length - shown)}
        </button>
      )}
    </>
  )
}

function FolderRow({ folder, open, onToggle }) {
  return (
    <div className="nx-gw-folder" role="button" tabIndex={-1} aria-expanded={open} title={folder.path} onClick={onToggle}>
      <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} />
      <span className="nx-gw-file-code" data-tone={TONE[folder.letter] ?? 'warn'}>{folder.letter}</span>
      <span className="nx-gw-folder-path">{folder.path}</span>
      <span className="nx-gw-folder-n">{folder.count}</span>
    </div>
  )
}

function Lane({ lane, selected, focusId, onRowClick, onFocus, onFocusFolder, drafts, labels, busy, onResolve, onWrite, onContext, treeKey }) {
  const { title, changes } = lane
  const config = useGitConfig()
  const mode = config.view.laneMode
  const big = changes.length > BIG_LANE
  const [limit, setLimit] = React.useState(ROWS_SHOWN)
  const [query, setQuery] = React.useState('')
  const [open, setOpen] = React.useState(() => new Set())
  const [folderLimits, setFolderLimits] = React.useState({})
  // Another worktree starts with its own filter and open folders.
  const [shownFor, setShownFor] = React.useState(treeKey)
  if (shownFor !== treeKey) { setShownFor(treeKey); setQuery(''); setOpen(new Set()); setFolderLimits({}); setLimit(ROWS_SHOWN) }
  const chosen = React.useMemo(() => new Set(selected), [selected])
  const draftSet = React.useMemo(() => new Set(drafts), [drafts])
  const visible = React.useMemo(() => (big ? filterChanges(changes, query) : changes), [big, changes, query])
  const folders = React.useMemo(() => (big && mode === 'folders' ? groupByFolder(visible) : null), [big, mode, visible])
  const movable = changes.filter(c => !isSubmodule(c))
  const picked = movable.filter(c => chosen.has(c.id))
  const verb = lane.bulk === 'stage' ? 'Stage' : 'Unstage'
  const bulkLabel = `${verb} ${picked.length ? picked.length : 'all'} ${ARROW[lane.bulk]}`
  const row = { chosen, drafts: draftSet, labels, busy, onResolve, onWrite, onFocus, onContext, onRowClick }
  const toggle = f => {
    setOpen(prev => { const next = new Set(prev); if (!next.delete(f.path)) next.add(f.path); return next })
    onFocusFolder?.({ path: f.path, area: lane.id, count: f.count, ids: f.files.filter(c => !isSubmodule(c)).map(c => c.id) })
  }
  return (
    <div role="group" aria-label={`${title} (${changes.length})`} className="nx-gw-lane" data-lane={lane.id}>
      <div className="nx-gw-lane-head" data-tone={lane.tone}>
        <span className="nx-gw-lane-title">{title}</span>
        <span className="nx-gw-sec-n">{changes.length}</span>
        {lane.bulk && movable.length > 0 && (
          <button className="nx-gw-lane-btn" disabled={busy} onClick={() => onWrite(lane.bulk, (picked.length ? picked : movable).map(c => c.id))}>{bulkLabel}</button>
        )}
      </div>
      {big && (
        <div className="nx-gw-lane-tools">
          <label className="nx-gw-lane-filter">
            <Icon name="search" size={11} />
            <input type="search" aria-label={`Filter ${title}`} placeholder="Filter files" value={query} spellCheck={false}
              onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape' && query) { e.preventDefault(); e.stopPropagation(); setQuery('') } }} />
          </label>
          <Segmented size="sm" ariaLabel={`${title} view`} value={mode} onChange={laneMode => setGitConfig({ view: { ...getGitConfig().view, laneMode } })}
            options={[{ id: 'folders', label: 'Folders' }, { id: 'flat', label: 'Flat' }]} />
        </div>
      )}
      <div className="nx-gw-lane-body">
        {lane.note && <div className="nx-gw-sec-note">{lane.note}</div>}
        {big && query && !visible.length && <div className="nx-gw-sec-note">No file matches.</div>}
        {folders
          ? folders.slice(0, limit).map(f => {
            // A folder holding the focused file is open, so the file is never hidden.
            const isOpen = open.has(f.path) || (!!focusId && f.files.some(c => c.id === focusId))
            return (
              <React.Fragment key={f.path}>
                <FolderRow folder={f} open={isOpen} onToggle={() => toggle(f)} />
                {isOpen && (
                  <div className="nx-gw-folder-files">
                    <Rows changes={f.files} focusId={focusId} limit={folderLimits[f.path] ?? ROWS_SHOWN} onMore={n => setFolderLimits(m => ({ ...m, [f.path]: n }))}
                      more={n => `Show ${n} more in this folder`} row={row} />
                  </div>
                )}
              </React.Fragment>
            )
          })
          : <Rows changes={visible} focusId={focusId} limit={limit} onMore={setLimit} more={(n, left) => `Show ${n} more (${left} not shown)`} row={row} />}
        {folders && folders.length > limit && (
          <button className="nx-gw-sec-btn nx-gw-more" onClick={() => setLimit(limit + ROWS_SHOWN * 4)}>{`Show more folders (${folders.length - limit} not shown)`}</button>
        )}
      </div>
    </div>
  )
}

const fileWord = n => (n > 1 ? ` ${n} files` : '')

/**
 * A worktree's changed files (the left column of the Changes tab): the Not staged and Staged lanes (and
 * Conflicts during one), each scrolling on its own, with a header action that stages or unstages the lane or
 * its selected files and the last result. Click selects a file
 * (Ctrl toggles, Shift ranges); the right-click menu stages, unstages, discards or deletes the selection.
 * `onAction(action, ids?)` reviews a file action; `onWrite(action, ids)` stages or unstages straight away;
 * `onCompose()` (the c key) moves to the commit form. `onPopout(kind, change)` (editor | conflict | diff),
 * when given, adds the pop-out items to the menu.
 */
export function ChangesPane({ tree, selected, onSelectionChange, focusId, onFocus, onAction, onWrite = () => {}, onResolve = null, busy = false, status = null, drafts = [], onPopout = null, onFocusFolder = null, onCompose = null }) {
  const [menu, setMenu] = React.useState(null)
  const [popError, setPopError] = React.useState(null)
  const closeMenu = React.useCallback(() => setMenu(null), [])
  const popout = async (kind, c) => {
    setPopError(null)
    try { await onPopout(kind, c) } catch (e) { setPopError(String(e?.message || e).replace(/^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/, '')) }
  }
  const list = lanes(tree.changes, tree.operationInfo?.kind)
  const labels = conflictLabels(tree.operationInfo, checkoutName(tree))
  const ordered = list.flatMap(s => s.changes)
  const actions = actionsFor(tree.changes, selected)
  const write = (action, ids) => { if (!busy && ids.length) onWrite(action, ids) }
  const run = action => { if (!busy && actions[action].length) onAction(action) }
  const onRowClick = (c, e) => {
    const mods = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }
    onSelectionChange(nextSelection({ ordered, selected, focusId }, c.id, mods))
    if (!mods.shift) onFocus(c.id)
  }
  // The row's menu acts on the whole selection when the row is part of it, else on the row alone. A conflicted
  // file is resolved, not edited, and a deleted one has nothing to edit; a submodule has neither.
  const onContext = (e, c) => {
    const ids = selected.includes(c.id) ? selected : [c.id]
    const a = actionsFor(tree.changes, ids)
    const items = []
    // A conflict is resolved from its own screen, so it gets no stage / discard items.
    const fileActions = c.area === 'conflict' ? [] : null
    for (const kind of fileActions ?? ['stage', 'unstage']) {
      const n = a[kind].length
      if (n) items.push({ label: `${kind === 'stage' ? 'Stage' : 'Unstage'}${fileWord(n)}`, onSelect: () => write(kind, a[kind].map(x => x.id)) })
    }
    for (const kind of fileActions ?? ['discard', 'delete']) {
      const n = a[kind].length
      if (n) items.push({ label: `${kind === 'discard' ? 'Discard' : 'Delete'}${fileWord(n)}…`, onSelect: () => { if (!busy) onAction(kind, a[kind].map(x => x.id)) } })
    }
    if (onPopout && !isSubmodule(c)) {
      if (c.area === 'conflict') items.push({ label: 'Resolve in new window', onSelect: () => popout('conflict', c) })
      else {
        if (letter(c) !== 'D') items.push({ label: 'Edit in new window', onSelect: () => popout('editor', c) })
        items.push({ label: 'Diff in new window', onSelect: () => popout('diff', c) })
      }
    }
    if (!items.length) return
    e.preventDefault()
    setMenu({ ...menuPoint(e), label: c.path, items })
  }
  const onKeyDown = e => {
    // Ctrl+C is copy, not Commit; and keys on a row's own button belong to that button.
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target !== e.currentTarget && (e.target.tagName === 'INPUT' || e.target.closest('button'))) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const i = ordered.findIndex(c => c.id === focusId)
      const next = ordered[Math.min(ordered.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next) onFocus(next.id)
    } else if (e.key === ' ' && focusId) {
      e.preventDefault()
      onSelectionChange(nextSelection({ ordered, selected, focusId }, focusId, { ctrl: true }))
    } else if (e.key === 's') run('stage')
    else if (e.key === 'u') run('unstage')
    else if (e.key === 'c' && onCompose) { e.preventDefault(); onCompose() }
  }
  return (
    <section aria-label="Changes" className="nx-gw-files">
      {busy && <div aria-live="polite" className="nx-gw-files-status">Working…</div>}
      {status && (
        <div role={status.ok ? 'status' : 'alert'} className="nx-gw-files-status" data-tone={status.ok ? undefined : 'bad'}>
          {status.text}
        </div>
      )}
      {popError && <div role="alert" className="nx-gw-files-status" data-tone="bad">{popError}</div>}
      <ContextMenu menu={menu} onClose={closeMenu} />
      <div tabIndex={0} aria-label="Changed files" onKeyDown={onKeyDown} className="nx-gw-lanes" style={{ gridTemplateRows: ROWS_BY_LANES[list.length || 2] }}>
        {!list.length
          ? (
            <>
              <div role="group" aria-label="Not staged (0)" className="nx-gw-lane" data-lane="unstaged">
                <div className="nx-gw-lane-head"><span className="nx-gw-lane-title">Not staged</span><span className="nx-gw-sec-n">0</span></div>
                <div className="nx-gw-files-empty">
                  <span className="nx-gw-clean-badge"><Icon name="check" size={12} /></span>
                  <strong>Working tree clean</strong>
                  <span>{`Edits to files on ${tree.branch ?? 'this branch'} appear here.`}</span>
                </div>
              </div>
              <div role="group" aria-label="Staged (0)" className="nx-gw-lane" data-lane="staged">
                <div className="nx-gw-lane-head" data-tone="ok"><span className="nx-gw-lane-title">Staged</span><span className="nx-gw-sec-n">0</span></div>
                <div className="nx-gw-files-empty"><span>Nothing staged.</span></div>
              </div>
            </>
          )
          : list.map(l => (
            <Lane key={l.id} lane={l} selected={selected} focusId={focusId} onRowClick={onRowClick} onFocus={onFocus} onFocusFolder={onFocusFolder} treeKey={tree.path}
              drafts={drafts} labels={labels} busy={busy} onResolve={onResolve} onWrite={write} onContext={onContext} />
          ))}
      </div>
    </section>
  )
}
