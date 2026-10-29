import React from 'react'
import { buildFileTree, dropFolder, importSummary } from './file-tree.js'
import { ImportDialog } from './import-dialog.jsx'
import { ContextMenu, menuPoint } from './context-menu.jsx'
import { popoutSpec } from './popout-spec.js'
import { ipcMessage } from './use-git-actions.js'
import { openElsewhere } from './open-elsewhere.js'
import { fileMarks } from './file-marks.js'

// A row's name, coloured and marked when the file is changed (a letter for each area it is changed
// in) or the folder holds changes (a dot in the colour of the most pressing one).
function RowName({ row, marks }) {
  if (row.kind === 'dir') {
    const d = marks.dirs.get(row.path)
    return (
      <>
        <span className="nx-gw-tree-name" data-changed={d ? '' : undefined}>{row.name}</span>
        {d && (
          <span className="nx-gw-tree-dot" data-tone={d.tone} title={`${d.count} changed file${d.count === 1 ? '' : 's'} inside`}>
            <span className="nx-sr-only">{`, ${d.count} changed inside`}</span>
          </span>
        )}
      </>
    )
  }
  const f = marks.files.get(row.path)
  return (
    <>
      <span className="nx-gw-tree-name" data-tone={f?.tone}>{row.name}</span>
      {f && (
        <span className="nx-gw-tree-codes">
          {f.marks.map(m => (
            <span key={m.area} className="nx-gw-file-code nx-gw-tree-code" data-tone={m.tone} title={m.label}>
              {m.letter}<span className="nx-sr-only">{`, ${m.label}`}</span>
            </span>
          ))}
        </span>
      )}
    </>
  )
}

const LEGEND = [['ok', 'Staged'], ['warn', 'Not staged'], ['info', 'Untracked'], ['bad', 'Conflicted']]

// What the colours mean, shown while the worktree has changes. Conflicted only when there is one.
function Legend({ marks }) {
  const tones = new Set([...marks.files.values()].flatMap(f => f.marks.map(m => m.tone)))
  return (
    <ul aria-label="What the colours mean" className="nx-gw-files-legend">
      {LEGEND.filter(([tone]) => tone !== 'bad' || tones.has('bad')).map(([tone, label]) => (
        <li key={tone}><span className="nx-gw-dot" data-tone={tone} />{label}</li>
      ))}
    </ul>
  )
}

// The tab is drawn afresh each time it is opened (and for each worktree), so which folders were open
// and how far it was scrolled are kept here, per worktree, for the rest of the session.
const views = new Map()
const viewOf = path => views.get(path) ?? { open: [], scrollTop: 0 }
const keep = (path, patch) => views.set(path, { ...viewOf(path), ...patch })
/** Forgets every remembered Files tab (open folders, scroll). */
export function forgetFilesView() { views.clear() }

// The tree flattened to the rows that are showing: folders open in `open`, in tree order.
function visibleRows(node, open, depth, out) {
  for (const d of node.dirs) {
    out.push({ kind: 'dir', path: d.path, name: d.name, depth, expanded: open.has(d.path) })
    if (open.has(d.path)) visibleRows(d, open, depth + 1, out)
  }
  for (const f of node.files) out.push({ kind: 'file', path: f.path, name: f.name, depth })
  return out
}

/**
 * The Files tab: the worktree's folders, and a drop target for files dragged in from outside the app.
 * Dropping on a folder row copies the files into that folder; on a file row, into its folder; on the
 * empty space or the root row, into the repository root. Names that already exist are asked about
 * first (ImportDialog). Nothing is staged: new files appear as untracked, replaced ones as unstaged.
 * `onImported()` asks the workspace to read the changes again. `changes` (the worktree's) marks each
 * changed file by where its change is (staged, not staged, untracked, conflicted) in the Changes tab's
 * colours, and each folder holding one with a dot. Open folders and the scroll position are kept per
 * worktree, so leaving the tab and coming back finds it as it was.
 */
export function FilesPane({ adapter, host = null, repo, worktreePath, registered, version, onImported = () => {}, onOpenFile = null, changes = [] }) {
  // The right-click menu: { x, y, label, items } for the row it was opened on.
  const [menu, setMenu] = React.useState(null)
  const [list, setList] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [open, setOpen] = React.useState(() => new Set(viewOf(worktreePath).open))
  const [target, setTarget] = React.useState(null)
  const [ask, setAsk] = React.useState(null)
  const [note, setNote] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  // Only the worktree's identity (and a new snapshot) lists the files again; the parent passes fresh-but-equal objects.
  const deps = React.useRef({ adapter, repo, registered })
  deps.current = { adapter, repo, registered }
  const repoPath = repo?.path
  const repoName = repo?.name
  const load = React.useCallback(() => {
    const d = deps.current
    return d.adapter.files(d.repo, worktreePath, d.registered).then(
      r => { setList(r); setError(null) },
      e => setError(ipcMessage(e) || 'Could not list the files.'),
    )
  }, [worktreePath])
  React.useEffect(() => { load() }, [load, repoPath, repoName, version])

  const root = React.useMemo(() => buildFileTree(list?.files ?? []), [list])
  const rows = React.useMemo(() => visibleRows(root, open, 0, []), [root, open])
  const marks = React.useMemo(() => fileMarks(changes), [changes])
  const toggle = path => setOpen(prev => { const next = new Set(prev); if (!next.delete(path)) next.add(path); return next })

  // Kept per worktree: the open folders as they change, and the scroll position of the box the tab
  // scrolls in (the panel's). Another worktree shows its own; the scroll comes back once the files are listed.
  const shownFor = React.useRef(worktreePath)
  React.useEffect(() => {
    if (shownFor.current === worktreePath) return
    shownFor.current = worktreePath
    setOpen(new Set(viewOf(worktreePath).open))
  }, [worktreePath])
  React.useEffect(() => { if (shownFor.current === worktreePath) keep(worktreePath, { open: [...open] }) }, [open, worktreePath])
  const rootRef = React.useRef(null)
  const scroller = () => rootRef.current?.closest('.nx-gw-files-body') ?? rootRef.current?.parentElement ?? null
  // The scroll is only kept once the files are listed and the old position put back: until then the
  // box is short, and anything that scrolls it is clamped to 0. The panel also reuses its scrolling box
  // for the next tab (clamping it as the content goes), so the position is taken as the tab closes (a
  // layout cleanup runs before that); and a hidden screen (display: none) resets it, so it isn't kept
  // while hidden and is put back when the screen shows again.
  const restoredFor = React.useRef(null)
  React.useLayoutEffect(() => {
    const box = scroller()
    if (!box) return undefined
    let live = true
    const ready = () => live && restoredFor.current === worktreePath
    const shown = () => {
      for (let el = box; el; el = el.parentElement) if (getComputedStyle(el).display === 'none') return false
      return true
    }
    const onScroll = () => { if (ready() && shown()) keep(worktreePath, { scrollTop: box.scrollTop }) }
    box.addEventListener('scroll', onScroll)
    const seen = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(entries => {
        if (ready() && entries.some(e => e.isIntersecting)) box.scrollTop = viewOf(worktreePath).scrollTop
      })
      : null
    seen?.observe(box)
    return () => {
      if (ready() && shown()) keep(worktreePath, { scrollTop: box.scrollTop })
      live = false
      seen?.disconnect()
      box.removeEventListener('scroll', onScroll)
    }
  }, [worktreePath])
  const listed = !!list
  React.useLayoutEffect(() => {
    if (!listed || restoredFor.current === worktreePath) return
    restoredFor.current = worktreePath
    const box = scroller()
    if (box) box.scrollTop = viewOf(worktreePath).scrollTop
  }, [listed, worktreePath, rows])

  const finish = async (dir, sources, replace) => {
    setBusy(true)
    try {
      const d = deps.current
      const r = await d.adapter.importFiles(d.repo, worktreePath, d.registered, dir, sources, { replace })
      const first = r.failed?.[0]
      setNote({ bad: r.failed?.length > 0, text: `${importSummary(r)}${first ? ` ${first.rel}: ${first.error}` : ''}` })
      if (dir) setOpen(prev => new Set([...prev, ...dir.split('/').map((_, i, a) => a.slice(0, i + 1).join('/'))]))
      await load()
      onImported()
    } catch (e) {
      setNote({ bad: true, text: ipcMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  const drop = async (dir, files) => {
    setNote(null)
    const sources = files.map(f => adapter.pathForFile(f)).filter(Boolean)
    if (!sources.length) { setNote({ bad: true, text: "Couldn't read where the dropped items came from." }); return }
    try {
      const d = deps.current
      const plan = await d.adapter.importFiles(d.repo, worktreePath, d.registered, dir, sources, { dryRun: true })
      if (plan.conflicts.length) setAsk({ dir, sources, conflicts: plan.conflicts })
      else await finish(dir, sources, [])
    } catch (e) {
      setNote({ bad: true, text: ipcMessage(e) })
    }
  }

  // The folder under the pointer: its row's (a file row stands for its folder), else the root.
  const folderAt = e => {
    const row = e.target.closest?.('[data-row]')
    return row ? dropFolder({ kind: row.dataset.kind, path: row.dataset.row }) : ''
  }
  const hasFiles = e => [...(e.dataTransfer?.types ?? [])].includes('Files')
  const onDragOver = e => {
    if (!hasFiles(e) || busy) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const dir = folderAt(e)
    if (dir !== target) setTarget(dir)
  }
  const onDragLeave = e => { if (!e.currentTarget.contains(e.relatedTarget)) setTarget(null) }
  const onDrop = e => {
    if (!hasFiles(e) || busy) return
    e.preventDefault()
    setTarget(null)
    drop(folderAt(e), [...e.dataTransfer.files])
  }

  const closeMenu = React.useCallback(() => setMenu(null), [])
  const attempt = async fn => {
    setNote(null)
    try { await fn() } catch (e) { setNote({ bad: true, text: ipcMessage(e) }) }
  }
  const openMenu = (e, r) => {
    e.preventDefault()
    const file = r.kind === 'file'
    const items = []
    if (file && onOpenFile) items.push({ label: 'Open', onSelect: () => onOpenFile(r.path) })
    if (file) {
      items.push({
        label: 'Open in new window',
        onSelect: () => attempt(() => deps.current.adapter.openWindow(popoutSpec('editor', { repo: deps.current.repo, worktree: worktreePath, registered: deps.current.registered, path: r.path }))),
      })
    }
    if (file) {
      const elsewhere = openElsewhere({ host, adapter: deps.current.adapter, repo: deps.current.repo, worktreePath, registered: deps.current.registered })
      items.push({ label: elsewhere.label, onSelect: () => attempt(() => elsewhere.run(r.path)) })
    }
    items.push({ label: 'Show in Explorer', onSelect: () => reveal(r.path) })
    setMenu({ ...menuPoint(e), label: r.path || 'Repository root', items })
  }
  const reveal = path => attempt(() => deps.current.adapter.reveal(deps.current.repo, worktreePath, deps.current.registered, path))
  const onRowKey = (e, r) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (r.kind === 'dir') toggle(r.path)
      else if (onOpenFile) onOpenFile(r.path)
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      openMenu(e, r)
    }
  }

  const dropping = target !== null
  return (
    <section ref={rootRef} aria-label="Files" className="nx-gw-files-tab" data-dropping={dropping || undefined}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div className="nx-gw-files-hint">Drag files or folders here from your file explorer. Drop them on a folder to add them to it.</div>
      {marks.files.size > 0 && <Legend marks={marks} />}
      {note && <div role={note.bad ? 'alert' : 'status'} className={`nx-alert ${note.bad ? 'bad' : 'good'}`}>{note.text}</div>}
      {error && <div role="alert" className="nx-alert bad">{error}</div>}
      {!list && !error && <div style={{ color: 'var(--text-muted)' }}>Loading files…</div>}
      {list && (
        <div role="tree" aria-label="Repository folders" className="nx-gw-tree">
          <div role="treeitem" aria-level={1} aria-expanded="true" tabIndex={0} data-row="" data-kind="dir" className="nx-gw-tree-row nx-gw-tree-root" data-drop={target === '' || undefined}
            onContextMenu={e => openMenu(e, { path: '', kind: 'dir' })} onKeyDown={e => onRowKey(e, { path: '', kind: 'dir' })}>
            <span aria-hidden="true">▾</span><span>{repo?.name || 'Repository root'}</span>
          </div>
          {rows.map(r => (
            <div key={`${r.kind}:${r.path}`} role="treeitem" aria-level={r.depth + 2} aria-expanded={r.kind === 'dir' ? r.expanded : undefined}
              data-row={r.path} data-kind={r.kind} className="nx-gw-tree-row" data-drop={(r.kind === 'dir' && target === r.path) || undefined}
              tabIndex={0} style={{ paddingLeft: 8 + (r.depth + 1) * 16 }} onClick={r.kind === 'dir' ? () => toggle(r.path) : undefined}
              onDoubleClick={r.kind === 'file' && onOpenFile ? () => onOpenFile(r.path) : undefined}
              onContextMenu={e => openMenu(e, r)} onKeyDown={e => onRowKey(e, r)}>
              <span aria-hidden="true">{r.kind === 'dir' ? (r.expanded ? '▾' : '▸') : ''}</span>
              <RowName row={r} marks={marks} />
            </div>
          ))}
          {list.truncated && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Showing the first 50,000 files.</div>}
        </div>
      )}
      <ContextMenu menu={menu} onClose={closeMenu} />
      {ask && (
        <ImportDialog folder={ask.dir} conflicts={ask.conflicts} onCancel={() => setAsk(null)}
          onDone={replace => { const a = ask; setAsk(null); finish(a.dir, a.sources, replace) }} />
      )}
    </section>
  )
}
