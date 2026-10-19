import React from 'react'
import { conflictLabels, toLf } from '@nexusmd/core'
import { CodeEditor, languageForPath } from '../shared/code-editor.jsx'
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
export function ResolvePane({ adapter, repo, tree, registered, change, onResolved, onDirtyChange }) {
  const path = change.path
  const c = useConflict({ adapter, repo, worktreePath: tree.path, registered, path })
  const labels = conflictLabels(tree.operationInfo, tree.branch)
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
  const go = delta => {
    const i = cur + delta
    if (i < 0 || i >= n) return
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

  // Alt+↑/↓ move between conflicts, also from inside the result (ahead of CodeMirror's move-line keys).
  const onKeyDownCapture = e => {
    if (!e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    if (c.status !== 'ready') return
    e.preventDefault()
    e.stopPropagation()
    go(e.key === 'ArrowUp' ? -1 : 1)
  }

  const data = c.data
  const ready = c.status === 'ready' && !!data
  const text = ready && TEXT_KINDS.includes(data.kind) && !data.binary && !data.symlink
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
            <button className="btn sm ghost" aria-label="Previous conflict" title="Alt+↑" disabled={cur <= 0} onClick={() => go(-1)}>↑</button>
            <button className="btn sm ghost" aria-label="Next conflict" title="Alt+↓" disabled={cur < 0 || cur >= n - 1} onClick={() => go(1)}>↓</button>
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
          <span style={{ flex: 1 }}>{`${path} is marked resolved.`}</span>
          {tree.operation && <button className="btn sm" disabled={c.saving} onClick={undo}>Undo resolution</button>}
        </div>
      )}
      {ready && !text && (
        <NonTextConflict kind={data.kind} labels={labels} binary={!!data.binary} symlink={!!data.symlink} onTake={whole} busy={blocked} />
      )}
      {text && (
        <>
          {region ? (
            <div className="nx-resolve-sides">
              {['left', 'right'].map(side => (
                <section key={side} aria-label={labels[side].title} className="nx-resolve-side">
                  <div className="nx-resolve-side-head">
                    <strong className="nx-trunc" title={labels[side].title}>{labels[side].title}</strong>
                    <button className="btn sm" onClick={() => take(side)}>{labels[side].take}</button>
                  </div>
                  {region[side] ? <pre>{region[side]}</pre> : <span className="nx-muted">(nothing on this side)</span>}
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
