import React from 'react'
import { dropFolder, importSummary } from './file-tree.js'
import { ImportDialog } from './import-dialog.jsx'
import { popoutSpec } from './popout-spec.js'
import { ipcMessage } from './use-git-actions.js'
import { openElsewhere } from './open-elsewhere.js'
import { fileMarks } from './file-marks.js'
import { FileExplorer, PreviewHead, forgetExplorerViews } from './file-explorer.jsx'
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

/** Forgets every remembered Files tab (open folders, picked file, filter, scroll). */
export const forgetFilesView = forgetExplorerViews

/**
 * The Files tab: the worktree's files in the shared explorer (tree and filter, the picked file's
 * preview), and a drop target for files dragged in from outside the app. Dropping on a folder row
 * copies the files into that folder; on a file row, into its folder; anywhere else, into the
 * repository root. Names that already exist are asked about first (ImportDialog). Nothing is staged:
 * new files appear as untracked, replaced ones as unstaged. `onImported()` asks the workspace to read
 * the changes again. `changes` (the worktree's) marks each changed file by where its change is (staged,
 * not staged, untracked, conflicted) in the Changes tab's colours, and each folder holding one with a
 * dot. `onOpenFile(path)` edits a file in the workspace (double-click, Enter, Edit). What was open and
 * picked, the filter and the scroll are kept per worktree, so leaving the tab and coming back finds it as it was.
 */
export function FilesPane({ adapter, host = null, repo, worktreePath, registered, version, onImported = () => {}, onOpenFile = null, changes = [] }) {
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
  const preview = path => {
    const d = deps.current
    return (
      <>
        <PreviewHead path={path} actions={fileActions(path)} />
        {isImagePath(path)
          ? <div className="nx-gw-fx-pad"><ImageView name={path} loadKey={`${path}\0${version}`} load={() => d.adapter.readImage(d.repo, worktreePath, d.registered, path, 'working')} emptyText="This file isn’t there any more." /></div>
          : <TextPreview path={path} loadKey={version} load={() => d.adapter.readFile(d.repo, worktreePath, d.registered, path)} />}
      </>
    )
  }

  const notes = note && <div role={note.bad ? 'alert' : 'status'} className={`nx-alert ${note.bad ? 'bad' : 'good'}`}>{note.text}</div>
  return (
    <div className="nx-gw-files-tab" data-dropping={target !== null || undefined} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <FileExplorer label="Files" rootName={repo?.name || 'Repository'} files={list?.files ?? null} truncated={!!list?.truncated} error={error}
        viewKey={`local:${worktreePath}`} renderName={row => <RowName row={row} marks={marks} />} menuItems={menuItems}
        onOpen={onOpenFile} preview={preview} notes={notes} footer={marks.files.size > 0 && <Legend marks={marks} />}
        emptyNote="To add files, drag them here from your file explorer. Drop them on a folder to put them in it."
        rowProps={row => ({ 'data-drop': (row.kind === 'dir' && target === row.path) || undefined })} />
      {ask && (
        <ImportDialog folder={ask.dir} conflicts={ask.conflicts} onCancel={() => setAsk(null)}
          onDone={replace => { const a = ask; setAsk(null); finish(a.dir, a.sources, replace) }} />
      )}
    </div>
  )
}
