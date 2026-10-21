import React from 'react'
import { conflictLabels, checkoutName, toLf } from '@nexusmd/core'
import { CodeEditor, languageForPath } from '../shared/code-editor.jsx'
import { CodeBlock, linesNotIn } from '../shared/highlight.jsx'
import { useConflict } from './use-conflict.js'
import { NonTextConflict } from './non-text-conflict.jsx'

const TEXT_KINDS = ['both-modified', 'both-added']
// 1-based line of an offset in LF text.
const lineAt = (text, offset) => text.slice(0, offset).split('\n').length

/**
 * One conflicted file being resolved. The current conflict's two sides sit side by side under their
 * labels (by meaning, from conflictLabels), each with its take button; the result below is the whole
 * file, editable, markers and all. Mark resolved stages the result, asking first while markers remain.
 * Files that can't be merged line by line get NonTextConflict's whole-file choices instead.
 * Dirtiness (unsaved result edits) is reported through `onDirtyChange`, and `onResolved` is called
 * after the index changed (resolved, or the resolution undone) so the snapshot can be reloaded.
 */
/**
 * `files`: where this file sits among the worktree's conflicted files, { index, total, prev, next }
 * (prev and next are paths, or null), and `onOpenFile(path)` moves to another of them.
 */
export function ResolvePane({ adapter, repo, tree, registered, change, onResolved, onDirtyChange, files = null, onOpenFile = null }) {
  const path = change.path
  const c = useConflict({ adapter, repo, worktreePath: tree.path, registered, path })
  const labels = conflictLabels(tree.operationInfo, checkoutName(tree))
  // A fresh { line } per navigation, so the result jumps again even to the same line (and not while typing).
  const [jump, setJump] = React.useState(null)
  const [showBase, setShowBase] = React.useState(false)
  const [askMarkers, setAskMarkers] = React.useState(false)
  const [stale, setStale] = React.useState(false)
  // The counter's total is the regions there were when this load finished; a reload starts over.
  const [loaded, setLoaded] = React.useState({ data: null, total: 0 })
  if (c.status === 'ready' && loaded.data !== c.data) {
    setLoaded({ data: c.data, total: c.regions.length })
    setAskMarkers(false)
    setStale(false)
  }

  const dirty = c.status === 'ready' && !!c.data && c.text !== toLf(c.data.working?.text ?? '')
  // Reported on every change and as clean when the pane goes away, so the panel's guard never sees stale edits.
  const dirtyChange = React.useRef(onDirtyChange)
  dirtyChange.current = onDirtyChange
  React.useEffect(() => { dirtyChange.current?.(dirty) }, [dirty])
  React.useEffect(() => () => dirtyChange.current?.(false), [])

  const n = c.regions.length
  const cur = Math.min(c.current, n - 1)
  const region = cur >= 0 ? c.regions[cur] : null
  const nextFile = onOpenFile ? files?.next ?? null : null
  const prevFile = onOpenFile ? files?.prev ?? null : null
  // Past the last conflict (or before the first) carries on into the next (or previous) conflicted file.
  const go = delta => {
    const i = cur + delta
    if (i >= n || (n === 0 && delta > 0)) { if (nextFile) onOpenFile(nextFile); return }
    if (i < 0) { if (prevFile) onOpenFile(prevFile); return }
    c.setCurrent(i)
    setJump({ line: lineAt(c.text, c.regions[i].start) })
  }
  const take = choice => { if (region) c.take(cur, choice) }

  const after = r => {
    if (r === 'ok') onResolved?.()
    else if (r === 'stale') setStale(true)
  }
  const mark = async force => {
    setAskMarkers(false)
    const r = await c.markResolved({ force })
    if (r === 'markers') setAskMarkers(true)
    else after(r)
  }
  const whole = async choice => after(await c.takeWhole(choice))
  const undo = async () => { if (await c.unresolve() === 'ok') onResolved?.() }

  // Alt+↑/↓ move between conflicts, also from inside the result (ahead of CodeMirror's move-line keys);
  // with Shift, between conflicted files.
  const onKeyDownCapture = e => {
    if (!e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    const up = e.key === 'ArrowUp'
    if (e.shiftKey) {
      const target = up ? prevFile : nextFile
      if (!target) return
      e.preventDefault()
      e.stopPropagation()
      onOpenFile(target)
      return
    }
    if (c.status !== 'ready' && !(c.status === 'resolved' && !up && nextFile)) return
    e.preventDefault()
    e.stopPropagation()
    go(up ? -1 : 1)
  }
  const fileName = p => p?.split('/').pop()

  const data = c.data
  const ready = c.status === 'ready' && !!data
  // Line by line only with a working file to edit: a missing one would load as empty and stage an empty file.
  const text = ready && TEXT_KINDS.includes(data.kind) && !data.binary && !data.symlink && !data.missing && !!data.working
  const blocked = c.saving || c.conflict || stale
  const base = data?.stages?.base

  return (
    <section aria-label={`Resolve ${path}`} className="nx-resolve" onKeyDownCapture={onKeyDownCapture}>
      <div className="nx-resolve-head">
        <h3 className="nx-editor-path nx-trunc" title={path} style={{ margin: 0 }}>{`Resolve: ${path}`}</h3>
        {dirty && <span className="nx-badge warn">● Unsaved</span>}
        {text && (
          <span className="row" style={{ marginLeft: 'auto', gap: 6 }}>
            <span className="nx-muted">{`${n} of ${Math.max(loaded.total, n)} left`}</span>
            <button className="btn sm ghost" aria-label="Previous conflict" title={cur <= 0 && prevFile ? `Alt+↑ · goes on to ${prevFile}` : 'Alt+↑'}
              disabled={cur <= 0 && !prevFile} onClick={() => go(-1)}>↑</button>
            <button className="btn sm ghost" aria-label="Next conflict" title={(cur < 0 || cur >= n - 1) && nextFile ? `Alt+↓ · goes on to ${nextFile}` : 'Alt+↓'}
              disabled={(cur < 0 || cur >= n - 1) && !nextFile} onClick={() => go(1)}>↓</button>
          </span>
        )}
        {onOpenFile && files?.total > 1 && (
          <span role="group" aria-label="Conflicted files" className="row" style={{ marginLeft: text ? 0 : 'auto', gap: 6 }}>
            <span className="nx-muted">{files.index >= 0 ? `File ${files.index + 1} of ${files.total}` : `${files.total} files left`}</span>
            <button className="btn sm ghost" aria-label="Previous conflicted file" title={prevFile ? `Alt+Shift+↑ · ${prevFile}` : undefined} disabled={!prevFile} onClick={() => onOpenFile(prevFile)}>‹ File</button>
            <button className="btn sm ghost" aria-label="Next conflicted file" title={nextFile ? `Alt+Shift+↓ · ${nextFile}` : undefined} disabled={!nextFile} onClick={() => onOpenFile(nextFile)}>File ›</button>
          </span>
        )}
      </div>
      {c.status === 'loading' && <span className="nx-muted">Loading…</span>}
      {c.restored && <div className="nx-alert" role="status" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}>Unsaved changes from earlier were restored.</div>}
      {c.error && <div className="nx-alert bad" role="alert">{c.error}</div>}
      {stale ? (
        <div className="nx-alert bad" role="alert">
          <span style={{ flex: 1 }}>This file changed since it was opened.</span>
          <button className="btn sm" onClick={() => c.reload()}>Reload</button>
        </div>
      ) : c.conflict && (
        <div className="nx-alert bad" role="alert">
          <span style={{ flex: 1 }}>This file changed on disk since you opened it.</span>
          <button className="btn sm" disabled={c.saving} onClick={() => c.reload({ discardDraft: true })}>Reload (discard my changes)</button>
          <button className="btn sm" disabled={c.saving} onClick={c.keepMine}>Keep my changes</button>
        </div>
      )}
      {c.status === 'resolved' && (
        <div className="nx-alert" role="status" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
          <span style={{ flex: 1 }}>{`${path} is marked resolved.${onOpenFile && !nextFile && tree.operation ? ' No conflicted files left: continue when ready.' : ''}`}</span>
          {tree.operation && <button className="btn sm" disabled={c.saving} onClick={undo}>Undo resolution</button>}
          {nextFile && <button className="btn sm" title={`${nextFile} · Alt+↓`} onClick={() => onOpenFile(nextFile)}>{`Next conflict: ${fileName(nextFile)} →`}</button>}
        </div>
      )}
      {ready && !text && (
        <NonTextConflict kind={data.kind} labels={labels} binary={!!data.binary} symlink={!!data.symlink} missing={!data.binary && !data.symlink && !data.working} path={path} onTake={whole} busy={blocked} />
      )}
      {text && (
        <>
          {region ? (
            <div className="nx-resolve-sides">
              {['left', 'right'].map(side => (
                <section key={side} aria-label={labels[side].title} className="nx-resolve-side" data-side={side}>
                  <div className="nx-resolve-side-head">
                    <strong className="nx-trunc" title={labels[side].title}>{labels[side].title}</strong>
                    <button className="btn sm" onClick={() => take(side)}>{labels[side].take}</button>
                  </div>
                  {region[side]
                    ? <CodeBlock text={region[side]} language={languageForPath(path)} marked={linesNotIn(region[side], region[side === 'left' ? 'right' : 'left'])} />
                    : <span className="nx-muted">(nothing on this side)</span>}
                </section>
              ))}
            </div>
          ) : (
            <div role="note" className="nx-muted">No conflicts left. Check the result, then mark the file resolved.</div>
          )}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {/* Two plain buttons rather than a menu: reachable and usable from the keyboard like any other. */}
            <span role="group" aria-label="Both" className="row" style={{ gap: 6 }}>
              <button className="btn sm ghost" disabled={!region} onClick={() => take('leftFirst')}>{`Both (${labels.left.version} first)`}</button>
              <button className="btn sm ghost" disabled={!region} onClick={() => take('rightFirst')}>{`Both (${labels.right.version} first)`}</button>
            </span>
            <button className="btn sm ghost" aria-pressed={showBase} disabled={!base} title={base ? undefined : 'No common original'} onClick={() => setShowBase(v => !v)}>Show original</button>
          </div>
          {showBase && base && (
            <div className="nx-resolve-base">
              <CodeEditor value={base.text} language={languageForPath(path)} ariaLabel={`Original ${path}`} readOnly />
            </div>
          )}
          <CodeEditor value={c.text} language={languageForPath(path)} onChange={c.setText} ariaLabel={`Result for ${path}`} line={jump} />
          {askMarkers && (
            <div className="nx-alert" role="alert">
              <span style={{ flex: 1 }}>This file still has conflict markers. Mark it resolved anyway?</span>
              <button className="btn sm danger" disabled={blocked} onClick={() => mark(true)}>Mark resolved anyway</button>
            </div>
          )}
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn sm accent" disabled={blocked} onClick={() => mark(false)}>Mark resolved</button>
          </div>
        </>
      )}
    </section>
  )
}
