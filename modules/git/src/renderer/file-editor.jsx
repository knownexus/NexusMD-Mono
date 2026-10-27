import React from 'react'
import { PlModal } from '@nexusmd/ui'
import { hasMarkers } from '@nexusmd/core'
import { CodeEditor, languageForPath } from '@nexusmd/editor-kit/code-editor.jsx'
import { useWorktreeFile } from './use-worktree-file.js'
import { isImagePath } from './image-types.js'
import { ImageFile } from './image-view.jsx'

/**
 * The resolve screen's "Edit result…" dialog: the conflict result in an editor. Save result hands the
 * text back through `onSave` (nothing is written to disk here; the resolve screen keeps it as its
 * draft). The footer says whether conflict markers remain: saving with markers doesn't resolve.
 */
export function EditResultDialog({ path, text, onSave, onClose }) {
  const [draft, setDraft] = React.useState(text)
  const markers = hasMarkers(draft)
  const save = () => onSave(draft)
  const onKeyDown = e => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); save() }
  }
  const footer = (
    <>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn accent" title="Ctrl+S" onClick={save}>Save result</button>
    </>
  )
  const note = markers
    ? <span style={{ color: 'var(--warning)' }}>Conflict markers remain: saving keeps them, and the file stays unresolved.</span>
    : <span style={{ color: 'var(--success)' }}>No conflict markers left.</span>
  return (
    <PlModal open wide onClose={onClose} title="Edit result" sub={path} icon="git-branch" footer={footer} footerLeft={note} closeOnBackdrop={false}>
      <div onKeyDown={onKeyDown} style={{ display: 'flex', flexDirection: 'column', height: 'min(60vh, 520px)' }}>
        <CodeEditor value={text} language={languageForPath(path)} onChange={setDraft} ariaLabel={`Edit result for ${path}`} />
      </div>
    </PlModal>
  )
}

/**
 * One worktree file in an editor, or the picture itself for an image (nothing to edit or save there).
 * See TextFileEditor for the editor's behaviour.
 */
export function FileEditor(props) {
  return isImagePath(props.path) && props.adapter.readImage
    ? <ImageFile adapter={props.adapter} repo={props.repo} worktreePath={props.worktreePath} registered={props.registered} path={props.path} />
    : <TextFileEditor {...props} />
}

/**
 * Save (or Ctrl+S) writes it back only if it is unchanged on
 * disk since it was read, otherwise it offers Reload or Overwrite. A file that can't be edited
 * (binary, too large, gone) shows main's reason instead. `line` is passed to CodeEditor as is.
 */
function TextFileEditor({ adapter, repo, worktreePath, registered, path, line = null, onSaved, onDirtyChange }) {
  const f = useWorktreeFile({ adapter, repo, worktreePath, registered, path })
  const save = async opts => { if (await f.save(opts)) onSaved?.() }
  const canSave = f.dirty && !f.saving

  // Reported on every change and as clean when the editor goes away, so the panel's guard never sees stale edits.
  const dirtyChange = React.useRef(onDirtyChange)
  dirtyChange.current = onDirtyChange
  React.useEffect(() => { dirtyChange.current?.(f.dirty) }, [f.dirty])
  React.useEffect(() => () => dirtyChange.current?.(false), [])

  const onKeyDown = e => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault()
      if (canSave) save()
    }
  }

  return (
    <section aria-label="Editor" onKeyDown={onKeyDown} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, gap: 6 }}>
      <div className="nx-editor-head" style={{ padding: '4px 0' }}>
        <span className="nx-editor-path nx-trunc" title={path}>{path}</span>
        {f.dirty && <span className="nx-badge warn">● Unsaved</span>}
        <span className="row" style={{ marginLeft: 'auto', gap: 8 }}>
          <button className="btn sm ghost" disabled={!canSave} onClick={f.revert}>Revert</button>
          <button className="btn sm accent" disabled={!canSave} title="Ctrl+S" onClick={() => save()}>Save</button>
        </span>
      </div>
      {f.restored && <div className="nx-alert" role="status" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}>Unsaved changes from earlier were restored.</div>}
      {f.error && <div className="nx-alert bad" role="alert">{f.error}</div>}
      {f.conflict && (
        <div className="nx-alert bad" role="alert">
          <span style={{ flex: 1 }}>This file changed on disk since you opened it.</span>
          <button className="btn sm" disabled={f.saving} onClick={f.revert}>Reload (discard my changes)</button>
          <button className="btn sm danger" disabled={f.saving} onClick={() => save({ overwrite: true })}>Overwrite</button>
        </div>
      )}
      {f.status === 'loading' && <span className="nx-muted">Loading…</span>}
      {f.status === 'ready' && (
        <CodeEditor value={f.text} language={languageForPath(path)} onChange={f.setText} ariaLabel={`Edit ${path}`} line={line} />
      )}
    </section>
  )
}
