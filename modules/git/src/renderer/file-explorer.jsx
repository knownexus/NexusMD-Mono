import React from 'react'
import { Icon } from '@nexusmd/ui'
import { buildFileTree } from './file-tree.js'
import { ContextMenu, menuPoint } from './context-menu.jsx'
import { PaneResizer, usePaneWidth, EXPLORER_WIDTH } from './pane-resizer.jsx'

// What each explorer was showing (open folders, the file picked, the filter, the scroll), per
// `viewKey`, for the rest of the session: the tab is drawn afresh each time it is opened.
const views = new Map()
const viewOf = key => views.get(key) ?? { open: [], selected: null, filter: '', scrollTop: 0 }
const keep = (key, patch) => views.set(key, { ...viewOf(key), ...patch })
/** Forgets every remembered explorer (open folders, picked file, filter, scroll). */
export function forgetExplorerViews() { views.clear() }

// The tree flattened to the rows that show: folders open in `open`, in tree order. With a filter,
// only files whose path holds it show, inside every folder above them, all open.
function visibleRows(node, open, depth, out, match) {
  for (const d of node.dirs) {
    if (match && !match.dirs.has(d.path)) continue
    const expanded = match ? true : open.has(d.path)
    out.push({ kind: 'dir', path: d.path, name: d.name, depth, expanded })
    if (expanded) visibleRows(d, open, depth + 1, out, match)
  }
  for (const f of node.files) if (!match || match.files.has(f.path)) out.push({ kind: 'file', path: f.path, name: f.name, depth })
  return out
}

// The files whose path holds `text` (any case), and every folder above one of them.
function matching(paths, text) {
  const q = text.trim().toLowerCase()
  if (!q) return null
  const files = new Set(paths.filter(p => p.toLowerCase().includes(q)))
  const dirs = new Set()
  for (const p of files) for (let i = p.indexOf('/'); i > 0; i = p.indexOf('/', i + 1)) dirs.add(p.slice(0, i))
  return { files, dirs }
}

const parentOf = path => path.slice(0, Math.max(0, path.lastIndexOf('/')))
const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`

// The tree's scroll position, kept per view. A screen hidden with display: none loses it, so it is
// put back whenever the tree shows again, and only kept while it shows.
function useKeptScroll(boxRef, viewKey, ready) {
  React.useLayoutEffect(() => {
    const box = boxRef.current
    if (!box || !ready) return undefined
    box.scrollTop = viewOf(viewKey).scrollTop
    const shown = () => { for (let el = box; el; el = el.parentElement) if (getComputedStyle(el).display === 'none') return false; return true }
    const onScroll = () => { if (shown()) keep(viewKey, { scrollTop: box.scrollTop }) }
    box.addEventListener('scroll', onScroll)
    const seen = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) box.scrollTop = viewOf(viewKey).scrollTop })
      : null
    seen?.observe(box)
    return () => { seen?.disconnect(); box.removeEventListener('scroll', onScroll) }
  }, [boxRef, viewKey, ready])
}

/**
 * A repository's files: a tree with a filter on the left, the picked file's preview on the right.
 * Used by the Files tab of a local worktree and of a GitHub repository, so both look and work alike.
 *
 * files: repo-relative paths (null while loading); error: why they couldn't be listed.
 * viewKey: what the open folders, picked file, filter and scroll are remembered under.
 * renderName(row): the row's name (a local tree colours changed files); menuItems(row): its right-click menu.
 * onOpen(path): double-click or Enter on the picked file. preview(path): the right side for a file.
 * notes: shown above the tree (a message); footer: beside the file count (a legend); emptyNote: under
 * "Pick a file" while none is picked. rowProps(row) / treeProps: extra props (drag and drop).
 */
export function FileExplorer({
  label = 'Files', rootName, files, truncated = false, error = null, viewKey,
  renderName = row => <span className="nx-gw-tree-name">{row.name}</span>, menuItems = () => [], onOpen = null, preview,
  notes = null, footer = null, emptyNote = null, rowProps = () => ({}), treeProps = {},
}) {
  const [open, setOpen] = React.useState(() => new Set(viewOf(viewKey).open))
  const [selected, setSelected] = React.useState(() => viewOf(viewKey).selected)
  const [filter, setFilter] = React.useState(() => viewOf(viewKey).filter)
  const [focused, setFocused] = React.useState(null)
  const [menu, setMenu] = React.useState(null)
  const box = React.useRef(null)
  const side = usePaneWidth('explorerWidth', EXPLORER_WIDTH)
  const shownFor = React.useRef(viewKey)
  React.useEffect(() => {
    if (shownFor.current === viewKey) return
    shownFor.current = viewKey
    const v = viewOf(viewKey)
    setOpen(new Set(v.open)); setSelected(v.selected); setFilter(v.filter)
  }, [viewKey])
  React.useEffect(() => { if (shownFor.current === viewKey) keep(viewKey, { open: [...open], selected, filter }) }, [open, selected, filter, viewKey])

  const root = React.useMemo(() => buildFileTree(files ?? []), [files])
  const match = React.useMemo(() => matching(files ?? [], filter), [files, filter])
  const rows = React.useMemo(() => visibleRows(root, open, 0, [], match), [root, open, match])
  const known = React.useMemo(() => new Set(files ?? []), [files])
  const picked = selected && known.has(selected) ? selected : null

  const treeBox = React.useRef(null)
  useKeptScroll(treeBox, viewKey, !!files)

  const toggle = path => setOpen(prev => { const next = new Set(prev); if (!next.delete(path)) next.add(path); return next })
  const collapseAll = () => setOpen(new Set())
  // Picking a file opens every folder above it, so it shows when the filter is cleared.
  const pick = path => {
    setSelected(path)
    setOpen(prev => { const next = new Set(prev); for (let d = parentOf(path); d; d = parentOf(d)) next.add(d); return next })
  }
  const focusRow = path => {
    setFocused(path)
    ;[...(treeBox.current?.querySelectorAll('[data-row]') ?? [])].find(el => el.dataset.row === path)?.focus()
  }
  const openMenu = (e, row) => {
    e.preventDefault()
    const items = menuItems(row)
    if (items.length) setMenu({ ...menuPoint(e), label: row.path || rootName, items })
  }
  const closeMenu = React.useCallback(() => setMenu(null), [])

  // ↑/↓ move between rows, → opens a folder (or steps into it), ← closes it (or steps out to its
  // folder), Home/End go to the ends, Enter picks a file (and opens the picked one) or toggles a folder.
  const onRowKey = (e, row, i) => {
    const go = j => { const r = rows[Math.max(0, Math.min(rows.length - 1, j))]; if (r) { e.preventDefault(); focusRow(r.path) } }
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(rows.length - 1)
    else if (e.key === 'ArrowRight' && row.kind === 'dir') { e.preventDefault(); if (row.expanded) go(i + 1); else toggle(row.path) }
    else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (row.kind === 'dir' && row.expanded && !match) toggle(row.path)
      else if (parentOf(row.path)) focusRow(parentOf(row.path))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (row.kind === 'dir') toggle(row.path)
      else if (e.key === 'Enter' && picked === row.path && onOpen) onOpen(row.path)
      else pick(row.path)
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) openMenu(e, row)
  }
  const onFilterKey = e => {
    if (e.key === 'Escape' && filter) { e.preventDefault(); e.stopPropagation(); setFilter('') }
    if (e.key === 'ArrowDown' && rows.length) { e.preventDefault(); focusRow(rows[0].path) }
  }
  // One row takes Tab into the tree: the focused one, else the picked file, else the first.
  const tabStop = rows.some(r => r.path === focused) ? focused : rows.some(r => r.path === picked) ? picked : rows[0]?.path

  const count = files ? (match ? plural(match.files.size, 'match', 'matches') : plural(files.length, 'file', 'files')) : ''
  return (
    <section aria-label={label} className="nx-gw-fx" ref={box} style={{ '--gw-fx': `${side.width}px` }}>
      <div className="nx-gw-fx-side">
        <div className="nx-gw-fx-tools">
          <label className="nx-gw-fx-filter">
            <Icon name="search" size={12} />
            <input type="search" aria-label="Filter files" placeholder="Filter files" value={filter} spellCheck={false}
              onChange={e => setFilter(e.target.value)} onKeyDown={onFilterKey} />
          </label>
          <button type="button" className="nx-gw-fx-tool" title="Collapse all folders" aria-label="Collapse all folders" disabled={!open.size || !!match} onClick={collapseAll}>
            <Icon name="collapse" size={13} />
          </button>
        </div>
        {notes}
        <div ref={treeBox} className="nx-gw-fx-scroll" {...treeProps}>
          {error && <div role="alert" className="nx-alert bad">{error}</div>}
          {!files && !error && <div className="nx-gw-fx-note">Loading files…</div>}
          {files && (
            <div role="tree" aria-label={`${rootName} folders`} className="nx-gw-tree">
              {rows.map((r, i) => (
                <div key={`${r.kind}:${r.path}`} role="treeitem" aria-level={r.depth + 1} aria-expanded={r.kind === 'dir' ? r.expanded : undefined}
                  aria-selected={r.kind === 'file' ? picked === r.path : undefined} tabIndex={r.path === tabStop ? 0 : -1}
                  data-row={r.path} data-kind={r.kind} className="nx-gw-tree-row" style={{ paddingLeft: 6 + r.depth * 14 }}
                  onClick={() => (r.kind === 'dir' ? toggle(r.path) : pick(r.path))} onFocus={() => setFocused(r.path)}
                  onDoubleClick={r.kind === 'file' && onOpen ? () => onOpen(r.path) : undefined}
                  onContextMenu={e => openMenu(e, r)} onKeyDown={e => onRowKey(e, r, i)} {...rowProps(r)}>
                  <span className="nx-gw-tree-twist" aria-hidden="true">{r.kind === 'dir' && <Icon name={r.expanded ? 'chevron-down' : 'chevron-right'} size={11} />}</span>
                  <Icon name={r.kind === 'dir' ? 'folder' : 'doc'} size={13} className="nx-gw-tree-icon" />
                  {renderName(r)}
                </div>
              ))}
              {match && !rows.length && <div className="nx-gw-fx-note">{`No file path holds “${filter.trim()}”.`}</div>}
              {files.length === 0 && !match && <div className="nx-gw-fx-note">No files yet.</div>}
            </div>
          )}
          {truncated && <div className="nx-gw-fx-note">{`Showing the first ${plural(files?.length ?? 0, 'file', 'files')}.`}</div>}
        </div>
        <div className="nx-gw-fx-foot"><span className="nx-gw-fx-count" aria-live="polite">{count}</span>{footer}</div>
      </div>
      <PaneResizer label="Resize file tree" width={side.width} fallback={EXPLORER_WIDTH} boxRef={box} onDrag={side.onDrag} onDone={side.onDone} className="nx-gw-fx-resizer" />
      <div className="nx-gw-fx-preview">
        {picked ? preview(picked) : (
          <div className="nx-gw-fx-empty">
            <Icon name="doc" size={22} />
            <span>Pick a file to see it here.</span>
            {onOpen && <span className="nx-gw-fx-note">Double-click or press Enter to edit it.</span>}
            {emptyNote && <span className="nx-gw-fx-note">{emptyNote}</span>}
          </div>
        )}
      </div>
      <ContextMenu menu={menu} onClose={closeMenu} />
    </section>
  )
}

/** The preview's head: the file's folder and name, and its actions ({ label, onSelect, primary? }). */
export function PreviewHead({ path, actions = [], children = null }) {
  const name = path.split('/').pop()
  const dir = parentOf(path)
  return (
    <div className="nx-gw-fx-head">
      <div className="nx-gw-fx-title" title={path}>
        <span className="nx-gw-fx-name">{name}</span>
        {dir && <span className="nx-gw-fx-dir">{dir}</span>}
      </div>
      {children}
      <div className="nx-gw-fx-actions">
        {actions.map(a => (
          <button key={a.label} type="button" className={`btn sm${a.primary ? '' : ' ghost'}`} title={a.title} onClick={a.onSelect}>{a.label}</button>
        ))}
      </div>
    </div>
  )
}
