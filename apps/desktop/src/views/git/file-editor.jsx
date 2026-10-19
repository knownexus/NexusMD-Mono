import React from 'react'
import { CodeEditor, languageForPath } from '../shared/code-editor.jsx'
import { useWorktreeFile } from './use-worktree-file.js'

/**
 * One worktree file in an editor: Save (or Ctrl+S) writes it back only if it is unchanged on
 * disk since it was read, otherwise it offers Reload or Overwrite. A file that can't be edited
 * (binary, too large, gone) shows main's reason instead. `line` is passed to CodeEditor as is.
 */
export function FileEditor({ adapter, repo, worktreePath, registered, path, line = null, onSaved, onDirtyChange }) {
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
