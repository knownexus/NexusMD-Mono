import React from 'react'
import { buildFileTree, dropFolder, importSummary } from './file-tree.js'
import { ImportDialog } from './import-dialog.jsx'
import { ContextMenu, menuPoint } from './context-menu.jsx'
import { popoutSpec } from './popout-spec.js'
import { ipcMessage } from './use-git-actions.js'
import { openElsewhere } from './open-elsewhere.js'

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
 * `onImported()` asks the workspace to read the changes again.
 */
export function FilesPane({ adapter, host = null, repo, worktreePath, registered, version, onImported = () => {}, onOpenFile = null }) {
  // The right-click menu: { x, y, label, items } for the row it was opened on.
  const [menu, setMenu] = React.useState(null)
  const [list, setList] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [open, setOpen] = React.useState(() => new Set())
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
  const toggle = path => setOpen(prev => { const next = new Set(prev); if (!next.delete(path)) next.add(path); return next })

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
    <section aria-label="Files" className="nx-gw-files-tab" data-dropping={dropping || undefined}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div className="nx-gw-files-hint">Drag files or folders here from your file explorer. Drop them on a folder to add them to it.</div>
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
              <span>{r.name}</span>
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
