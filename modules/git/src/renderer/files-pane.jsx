import React from 'react'
import { dropFolder, importSummary } from './file-tree.js'
import { ImportDialog } from './import-dialog.jsx'
import { popoutSpec } from './popout-spec.js'
import { ipcMessage } from './use-git-actions.js'
import { openElsewhere } from './open-elsewhere.js'
import { fileMarks } from './file-marks.js'
import { PathBar } from './path-bar.jsx'
import { DiffPane } from './diff-pane.jsx'
import { useDiff } from './use-diff.js'
import { useFileHistory } from './use-file-history.js'
import { FileRail } from './file-rail.jsx'
import { useRail } from './use-rail.js'
import { FileExplorer, forgetExplorerViews } from './file-explorer.jsx'
import { useRecentFiles } from './use-recent-files.js'
import { relativeTime } from './history-pane.jsx'
import { Icon, Segmented } from '@nexusmd/ui'
import { TextPreview } from './file-preview.jsx'
import { ImageView } from './image-view.jsx'
import { isImagePath } from './image-types.js'

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

const baseOf = path => path.slice(path.lastIndexOf('/') + 1)
const dirOf = path => path.slice(0, Math.max(0, path.lastIndexOf('/')))

// The changed files, pinned above the tree: the letter, name and folder; a staged file in the staged colour.
// A few rows are shown, so the tree keeps its room; Show more opens the list (still capped, like the Changes tab's).
const PINNED = 8
const PINNED_MAX = 300

function ChangedPin({ marks, picked, pick }) {
  const [all, setAll] = React.useState(false)
  const list = [...marks.files].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  if (!list.length) return null
  const shown = all ? list.slice(0, PINNED_MAX) : list.slice(0, PINNED)
  return (
    <div role="group" aria-label={`Changed ${list.length}`} className="nx-gw-pin">
      <div className="nx-gw-eyebrow">{`Changed ${list.length}`}</div>
      <div className="nx-gw-pin-list" data-open={all || undefined}>
      {shown.map(([path, f]) => (
        <button key={path} type="button" className="nx-gw-pin-row" title={path} data-tone={f.marks[0].tone} aria-current={picked === path ? 'true' : undefined} onClick={() => pick(path)}>
          <span className="nx-gw-file-code" data-tone={f.marks[0].tone}>{f.marks[0].letter}</span>
          <span className="nx-gw-pin-name">{baseOf(path)}</span>
          {dirOf(path) && <span className="nx-gw-pin-dir">{dirOf(path)}</span>}
        </button>
      ))}
      </div>
      {all && list.length > PINNED_MAX && <div className="nx-gw-fx-note">{`${list.length - PINNED_MAX} more in the Changes tab`}</div>}
      {list.length > PINNED && (
        <button type="button" className="nx-gw-pin-more" onClick={() => setAll(a => !a)}>{all ? 'Show fewer' : `Show ${list.length - PINNED} more`}</button>
      )}
    </div>
  )
}

// The last few files opened in this worktree this session.
function RecentPin({ recent, picked, pick }) {
  if (!recent.length) return null
  return (
    <div role="group" aria-label="Recent" className="nx-gw-pin">
      <div className="nx-gw-eyebrow">Recent</div>
      {recent.map(r => (
        <button key={r.path} type="button" className="nx-gw-pin-row" title={r.path} aria-current={picked === r.path ? 'true' : undefined} onClick={() => pick(r.path)}>
          <Icon name="clock" size={11} />
          <span className="nx-gw-pin-name">{baseOf(r.path)}</span>
          <span className="nx-gw-pin-dir">{relativeTime(r.openedAt)}</span>
        </button>
      ))}
    </div>
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

// File or Diff for each worktree's picked file, for the session.
const fileViews = new Map()

/** Forgets every remembered Files tab (open folders, picked file, filter, scroll, File or Diff). */
export function forgetFilesView() { forgetExplorerViews(); fileViews.clear() }

// The change a file's Diff shows: the unstaged one first, else the staged one (the same choice the editor makes).
const changeFor = (changes, path) => changes.find(c => c.path === path && c.area !== 'staged') ?? changes.find(c => c.path === path) ?? null

// The new-side line numbers of the added lines in a diff: the lines the file view tints as changed.
function addedLines(files) {
  const out = []
  for (const f of files) for (const h of f.hunks) for (const l of h.lines) if (l.kind === 'add' && l.newNo != null) out.push(l.newNo)
  return out
}

// Lines added and removed in a diff, for the panel's status card (null until the diff is read).
function lineCounts(files) {
  if (!files.length) return null
  let add = 0
  let del = 0
  for (const f of files) for (const h of f.hunks) for (const l of h.lines) { if (l.kind === 'add') add++; else if (l.kind === 'del') del++ }
  return { add, del }
}

// The picked file's right-hand panel: its change and line counts, its latest commits, and the ways to open it.
function LocalRail({ path, change, d, worktreePath, version, onView, onWrite, onAction, onOpenCommit, onEdit, elsewhere, onElsewhere, onReveal, onNewWindow }) {
  const history = useFileHistory({ adapter: d.adapter, repo: d.repo, cwd: worktreePath, registered: d.registered, path, version })
  const diff = useDiff({ adapter: d.adapter, repo: d.repo, worktreePath, registered: d.registered, change, version })
  return (
    <FileRail path={path} change={change} counts={lineCounts(diff.files)} commits={history.commits} elsewhere={elsewhere}
      onViewDiff={onView} onStage={c => onWrite?.('stage', [c.id])} onUnstage={c => onWrite?.('unstage', [c.id])}
      onDiscard={c => onAction?.(c.area === 'untracked' ? 'delete' : 'discard', [c.id])} onOpenCommit={oid => onOpenCommit?.(oid)}
      onEdit={onEdit} onElsewhere={onElsewhere} onReveal={onReveal} onNewWindow={onNewWindow} />
  )
}

// The picked file: a path bar with File | Diff (Diff only for a changed file) and the file with its changed
// lines tinted and a status footer, or the same diff as Changes.
function LocalPreview({ path, change, d, worktreePath, version, repoName, view, onView, image }) {
  const diff = useDiff({ adapter: d.adapter, repo: d.repo, worktreePath, registered: d.registered, change: image ? null : change, version })
  const marked = React.useMemo(() => addedLines(diff.files), [diff.files])
  const showDiff = !!change && !image && view === 'diff'
  return (
    <>
      <PathBar segments={[repoName, ...path.split('/')]}>
        {change && !image && (
          <Segmented size="sm" ariaLabel="File or diff" value={view} onChange={onView} options={[{ id: 'file', label: 'File' }, { id: 'diff', label: 'Diff' }]} />
        )}
      </PathBar>
      {image
        ? <div className="nx-gw-fx-pad"><ImageView name={path} loadKey={`${path}\0${version}`} load={() => d.adapter.readImage(d.repo, worktreePath, d.registered, path, 'working')} emptyText="This file isn’t there any more." /></div>
        : showDiff
          ? <div className="nx-gw-fx-diff"><DiffPane change={change} diff={diff} readOnly onHunk={() => {}} /></div>
          : <TextPreview path={path} loadKey={version} markedLines={marked} showStatus load={() => d.adapter.readFile(d.repo, worktreePath, d.registered, path)} />}
    </>
  )
}

/**
 * The Files tab: the worktree's files in the shared explorer (tree and filter, the picked file's
 * preview), and a drop target for files dragged in from outside the app. Dropping on a folder row
 * copies the files into that folder; on a file row, into its folder; anywhere else, into the
 * repository root. Names that already exist are asked about first (ImportDialog). Nothing is staged:
 * new files appear as untracked, replaced ones as unstaged. `onImported()` asks the workspace to read
 * the changes again. `changes` (the worktree's) marks each changed file by where its change is (staged,
 * not staged, untracked, conflicted) in the Changes tab's colours, and each folder holding one with a
 * dot. `onOpenFile(path)` edits a file in the workspace (double-click, Enter, Edit). `onWrite(action, ids)` and
 * `onAction(action, ids)` stage / unstage and review a discard or delete for the panel's buttons; `onOpenCommit(oid)`
 * shows a commit in History. What was open and
 * picked, the filter and the scroll are kept per worktree, so leaving the tab and coming back finds it as it was.
 */
export function FilesPane({ adapter, host = null, repo, worktreePath, registered, version, onImported = () => {}, onOpenFile = null, changes = [], onWrite = null, onAction = null, onOpenCommit = null }) {
  const [list, setList] = React.useState(null)
  const [error, setError] = React.useState(null)
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
  const marks = React.useMemo(() => fileMarks(changes), [changes])
  const rootRef = React.useRef(null)
  const rail = useRail('files', { rootRef })
  const viewKey = `${repo?.path}|${worktreePath}`
  const [, redraw] = React.useReducer(n => n + 1, 0)
  const viewOf = () => fileViews.get(viewKey) ?? 'file'
  const setView = v => { fileViews.set(viewKey, v); redraw() }
  const recent = useRecentFiles(`${repo?.path}|${worktreePath}`)

  const finish = async (dir, sources, replace) => {
    setBusy(true)
    try {
      const d = deps.current
      const r = await d.adapter.importFiles(d.repo, worktreePath, d.registered, dir, sources, { replace })
      const first = r.failed?.[0]
      setNote({ bad: r.failed?.length > 0, text: `${importSummary(r)}${first ? ` ${first.rel}: ${first.error}` : ''}` })
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

  const attempt = async fn => {
    setNote(null)
    try { await fn() } catch (e) { setNote({ bad: true, text: ipcMessage(e) }) }
  }
  const reveal = path => attempt(() => deps.current.adapter.reveal(deps.current.repo, worktreePath, deps.current.registered, path))
  const inWindow = path => attempt(() => deps.current.adapter.openWindow(popoutSpec('editor', { repo: deps.current.repo, worktree: worktreePath, registered: deps.current.registered, path })))
  const elsewhere = () => openElsewhere({ host, adapter: deps.current.adapter, repo: deps.current.repo, worktreePath, registered: deps.current.registered })
  const fileActions = path => {
    const other = elsewhere()
    return [
      ...(onOpenFile ? [{ label: 'Edit', primary: true, title: 'Edit it here, with its changes', onSelect: () => onOpenFile(path) }] : []),
      { label: other.label, onSelect: () => attempt(() => other.run(path)) },
      { label: 'Open in new window', onSelect: () => inWindow(path) },
    ]
  }
  const menuItems = row => [
    ...(row.kind === 'file' ? fileActions(row.path).map(({ label, onSelect }) => ({ label: label === 'Edit' ? 'Open' : label, onSelect })) : []),
    { label: 'Show in Explorer', onSelect: () => reveal(row.path) },
  ]
  const preview = path => (
    <LocalPreview key={path} path={path} change={changeFor(changes, path)} d={deps.current} worktreePath={worktreePath} version={version}
      repoName={repo?.name || 'Repository'} view={viewOf()} onView={setView} image={isImagePath(path)} />
  )
  const detailsFor = path => {
    if (!path) return <div className="nx-gw-crail"><div className="nx-gw-rail-note">Pick a file to see its details.</div></div>
    const other = elsewhere()
    return (
      <LocalRail key={path} path={path} change={changeFor(changes, path)} d={deps.current} worktreePath={worktreePath} version={version}
        onView={() => setView('diff')} onWrite={onWrite} onAction={onAction} onOpenCommit={onOpenCommit}
        onEdit={onOpenFile ? () => onOpenFile(path) : null} elsewhere={other} onElsewhere={() => attempt(() => other.run(path))}
        onReveal={() => reveal(path)} onNewWindow={() => inWindow(path)} />
    )
  }

  const notes = note && <div role={note.bad ? 'alert' : 'status'} className={`nx-alert ${note.bad ? 'bad' : 'good'}`}>{note.text}</div>
  return (
    <div className="nx-gw-files-tab" ref={rootRef} data-dropping={target !== null || undefined} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <FileExplorer label="Files" rootName={repo?.name || 'Repository'} files={list?.files ?? null} truncated={!!list?.truncated} error={error}
        viewKey={`local:${worktreePath}`} renderName={row => <RowName row={row} marks={marks} />} menuItems={menuItems}
        onOpen={onOpenFile} preview={preview} notes={notes} onPick={recent.touch} highlightMatches rail={detailsFor} railLabel="File details" railOpen={rail.open} onRailToggle={rail.toggle}
        pins={({ pick, picked }) => (
          <>
            <ChangedPin marks={marks} picked={picked} pick={pick} />
            <RecentPin recent={recent.recent} picked={picked} pick={pick} />
          </>
        )} footer={marks.files.size > 0 && <Legend marks={marks} />}
        emptyNote="To add files, drag them here from your file explorer. Drop them on a folder to put them in it."
        rowProps={row => ({ 'data-drop': (row.kind === 'dir' && target === row.path) || undefined })} />
      {ask && (
        <ImportDialog folder={ask.dir} conflicts={ask.conflicts} onCancel={() => setAsk(null)}
          onDone={replace => { const a = ask; setAsk(null); finish(a.dir, a.sources, replace) }} />
      )}
    </div>
  )
}
