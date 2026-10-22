import React from 'react'
import { conflictLabels, checkoutName, toLf, resolveRegion } from '@nexusmd/core'
import { CodeEditor, languageForPath } from '../shared/code-editor.jsx'
import { CodeBlock, linesNotIn } from '../shared/highlight.jsx'
import { useConflict } from './use-conflict.js'
import { NonTextConflict, nonTextPill } from './non-text-conflict.jsx'
import { EditResultDialog } from './file-editor.jsx'
import { conflictSides } from './conflict-sides.js'

const TEXT_KINDS = ['both-modified', 'both-added']
// 1-based line of an offset in LF text.
const lineAt = (text, offset) => text.slice(0, offset).split('\n').length
// How many lines a conflict section holds (sections end with their newline).
const lineCount = s => (s ? s.split('\n').length - (s.endsWith('\n') ? 1 : 0) : 0)
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const TINT = { theirs: 'nx-res-theirs', mine: 'nx-res-mine' }

// What the sides put into the result: nothing taken yet. `text` is the result these ranges belong to;
// they are only shown while the result is still exactly that.
const NO_TAKES = { text: null, before: null, ranges: [], last: null, prev: null }

/**
 * One conflicted file being resolved. The current conflict's two sides sit in cards (incoming `--info`,
 * yours `--violet`), each with its Use button; the result below is the whole file, read-only and tinted
 * by where each line came from, and Edit result… opens it in an editor. Mark resolved (& next) stages the
 * result and moves on to the next conflicted file; it waits until no conflict blocks are left.
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
  const sides = conflictSides(labels, tree.operationInfo)
  // A fresh { line } per navigation, so the result jumps again even to the same line.
  const [jump, setJump] = React.useState(null)
  const [showBase, setShowBase] = React.useState(false)
  const [askMarkers, setAskMarkers] = React.useState(false)
  const [stale, setStale] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [takes, setTakes] = React.useState(NO_TAKES)
  const [loaded, setLoaded] = React.useState(null)
  if (c.status === 'ready' && loaded !== c.data) {
    setLoaded(c.data)
    setAskMarkers(false)
    setStale(false)
    setTakes(NO_TAKES)
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

  // The takes so far, while the result is still what they made it (an edit forgets them).
  const t = takes.text === c.text ? takes : NO_TAKES
  // The takes before the last one (what Show markers goes back to).
  const before = t.prev && t.prev.text === t.before ? t.prev : NO_TAKES
  // Puts `choice` in for block `index` (`r`) of `text`, remembering what each side put in so the result
  // can be tinted and the take put back (Show markers).
  const takeIn = (text, prior, r, index, choice) => {
    const order = { left: ['left'], right: ['right'], leftFirst: ['left', 'right'], rightFirst: ['right', 'left'] }[choice]
    const next = resolveRegion(text, index, choice)
    const delta = order.map(k => r[k]).join('').length - (r.end - r.start)
    const ranges = prior.ranges.map(g => (g.from >= r.end ? { ...g, from: g.from + delta, to: g.to + delta } : g))
    let at = r.start
    for (const k of order) {
      if (r[k]) ranges.push({ from: at, to: at + r[k].length, role: sides[k].role })
      at += r[k].length
    }
    setTakes({ text: next, before: text, ranges, last: { region: r, choice, index }, prev: prior })
    c.setText(next)
  }
  // Undoes the last take: its conflict block (markers and all) comes back.
  const showMarkers = () => {
    if (!t.last) return
    setTakes(before)
    c.setText(t.before)
    c.setCurrent(t.last.index)
    setJump({ line: lineAt(t.before, t.last.region.start) })
  }
  const take = choice => {
    if (region) takeIn(c.text, t, region, cur, choice)
    // Nothing left to resolve: another choice for the last block swaps it in place.
    else if (t.last && t.last.choice !== choice) takeIn(t.before, before, t.last.region, t.last.index, choice)
  }

  const after = r => {
    if (r === 'ok') onResolved?.()
    else if (r === 'stale') setStale(true)
    return r === 'ok'
  }
  // Resolved goes straight on to the next conflicted file, if there is one.
  const advance = () => {
    if (!nextFile) return
    dirtyChange.current?.(false)
    onOpenFile(nextFile)
  }
  const mark = async force => {
    setAskMarkers(false)
    const r = await c.markResolved({ force })
    if (r === 'markers') setAskMarkers(true)
    else if (after(r)) advance()
  }
  const whole = async choice => { if (after(await c.takeWhole(choice))) advance() }
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
  const nonText = ready && !text
  const missing = !!data && !data.binary && !data.symlink && !data.working
  const pill = nonText ? nonTextPill({ kind: data.kind, labels, op: tree.operationInfo, binary: !!data.binary, symlink: !!data.symlink, missing }) : null

  // The result's line tints: marker lines, each side's lines inside a block, and what the takes put in.
  const lineClasses = React.useMemo(() => {
    if (!text) return null
    const out = []
    const add = (from, count, cls) => { for (let i = 0; i < count; i++) out.push([from + i, cls]) }
    for (const r of c.regions) {
      let ln = lineAt(c.text, r.start)
      add(ln++, 1, 'nx-res-marker')
      const l = lineCount(r.left)
      add(ln, l, TINT[sides.left.role]); ln += l
      if (r.base != null) { const b = lineCount(r.base); add(ln, b + 1, 'nx-res-marker'); ln += b + 1 }
      add(ln++, 1, 'nx-res-marker')
      const rc = lineCount(r.right)
      add(ln, rc, TINT[sides.right.role]); ln += rc
      add(ln, 1, 'nx-res-marker')
    }
    for (const g of t.ranges) {
      if (g.to <= g.from) continue
      const a = lineAt(c.text, g.from)
      add(a, lineAt(c.text, g.to - 1) - a + 1, TINT[g.role])
    }
    return out
  // sides only change with the operation, which reloads the pane.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, c.text, c.regions, t])

  // The block on the cards: the current one, or once none are left, the last one taken (showing the choice).
  const shown = region ?? t.last?.region ?? null
  const chosen = region ? null : t.last?.choice ?? null
  const resolveLabel = nextFile ? 'Mark resolved & next' : 'Mark resolved'
  const resolveTitle = n > 0
    ? `Resolve the ${plural(n, 'conflict block')} left first: use a side, combine them, or edit the result`
    : nextFile ? `Stage ${path} and open ${nextFile}` : `Stage ${path}`

  return (
    <>
      <section aria-label={`Resolve ${path}`} className="nx-resolve" onKeyDownCapture={onKeyDownCapture}>
        <div className="nx-resolve-head">
          <h3 className="nx-resolve-title" title={path}>
            <span className="nx-resolve-kicker">Conflict</span>{' '}
            <span className="nx-resolve-path">{path}</span>
          </h3>
          {pill && <span className={`nx-badge ${pill.tone}`}>{pill.text}</span>}
          {dirty && <span className="nx-badge warn">● Unsaved</span>}
          {onOpenFile && files?.total > 1 && (
            <span role="group" aria-label="Conflicted files" className="row" style={{ marginLeft: 'auto', gap: 6 }}>
              <span className="nx-muted">{files.index >= 0 ? `File ${files.index + 1} of ${files.total}` : `${files.total} files left`}</span>
              <button className="btn sm ghost nx-resolve-nav" aria-label="Previous conflicted file" title={prevFile ? `Alt+Shift+↑ · ${prevFile}` : undefined} disabled={!prevFile} onClick={() => onOpenFile(prevFile)}>‹</button>
              <button className="btn sm ghost nx-resolve-nav" aria-label="Next conflicted file" title={nextFile ? `Alt+Shift+↓ · ${nextFile}` : undefined} disabled={!nextFile} onClick={() => onOpenFile(nextFile)}>›</button>
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
        {nonText && (
          <NonTextConflict kind={data.kind} labels={labels} op={tree.operationInfo} binary={!!data.binary} symlink={!!data.symlink} missing={missing}
            path={path} onTake={whole} busy={blocked} hasNext={!!nextFile} />
        )}
        {text && (
          <>
            <p className="nx-resolve-explain">
              {tree.operationInfo?.kind === 'rebase'
                ? <>Both sides changed the same lines. <strong data-role="theirs">{sides.theirs.title}</strong> is already in your branch; <strong data-role="mine">{sides.mine.title}</strong> is being replayed on top. Use a side, combine them, or edit the result.</>
                : <>Both sides changed the same lines: <strong data-role="theirs">{sides.theirs.title}</strong> and <strong data-role="mine">{sides.mine.title}</strong>. Use a side, combine them, or edit the result.</>}
            </p>
            {shown ? (
              <div className="nx-resolve-sides">
                {[sides.left, sides.right].map(s => {
                  const using = chosen === s.key
                  return (
                    <section key={s.key} aria-label={s.title} className="nx-resolve-side" data-side={s.key} data-role={s.role} data-chosen={using || undefined}>
                      <div className="nx-resolve-side-head">
                        <span className="nx-resolve-side-name">
                          <span className="kicker">{s.kicker}</span>
                          <strong className="nx-trunc" title={s.title}>{s.title}</strong>
                        </span>
                        <button className={`btn sm${using ? ' nx-resolve-using' : ''}`} aria-pressed={using} title={s.take} onClick={() => take(s.key)}>{using ? '✓ Using this' : s.use}</button>
                      </div>
                      {shown[s.key]
                        ? <CodeBlock text={shown[s.key]} language={languageForPath(path)} marked={linesNotIn(shown[s.key], shown[s.key === 'left' ? 'right' : 'left'])} />
                        : <span className="nx-muted">(nothing on this side)</span>}
                    </section>
                  )
                })}
              </div>
            ) : (
              <div role="note" className="nx-muted">No conflicts left. Check the result, then mark the file resolved.</div>
            )}
            <div className="nx-resolve-row">
              <span className="nx-resolve-label">Result</span>
              {/* Plain buttons rather than a menu: reachable and usable from the keyboard like any other. */}
              <span role="group" aria-label="Both" className="row" style={{ gap: 6 }}>
                {[[sides.theirsFirst, 'Both, theirs first'], [sides.mineFirst, 'Both, mine first']].map(([choice, label]) => (
                  <button key={choice} className="btn sm ghost" aria-pressed={chosen === choice} disabled={!shown} onClick={() => take(choice)}>{label}</button>
                ))}
              </span>
              <button className="btn sm ghost" disabled={!t.last} title={t.last ? 'Put the last conflict block back, markers and all' : 'Nothing taken to undo'} onClick={showMarkers}>Show markers</button>
              <button className="btn sm ghost" aria-pressed={showBase} disabled={!base} title={base ? undefined : 'No common original'} onClick={() => setShowBase(v => !v)}>Show original</button>
              <span className={`nx-resolve-state ${n > 0 ? 'bad' : 'ok'}`}>
                {n > 0 ? `${plural(n, 'conflict block')} left in this file` : 'Conflict resolved — review, then mark resolved'}
              </span>
              <span className="row" style={{ gap: 4 }}>
                <button className="btn sm ghost" aria-label="Previous conflict" title={cur <= 0 && prevFile ? `Alt+↑ · goes on to ${prevFile}` : 'Alt+↑'}
                  disabled={cur <= 0 && !prevFile} onClick={() => go(-1)}>↑</button>
                <button className="btn sm ghost" aria-label="Next conflict" title={(cur < 0 || cur >= n - 1) && nextFile ? `Alt+↓ · goes on to ${nextFile}` : 'Alt+↓'}
                  disabled={(cur < 0 || cur >= n - 1) && !nextFile} onClick={() => go(1)}>↓</button>
              </span>
            </div>
            {showBase && base && (
              <div className="nx-resolve-base">
                <CodeEditor value={base.text} language={languageForPath(path)} ariaLabel={`Original ${path}`} readOnly />
              </div>
            )}
            <div className="nx-resolve-result">
              <CodeEditor value={c.text} language={languageForPath(path)} ariaLabel={`Result for ${path}`} line={jump} readOnly lineClasses={lineClasses} />
            </div>
            {askMarkers && (
              <div className="nx-alert" role="alert">
                <span style={{ flex: 1 }}>This file still has conflict markers. Mark it resolved anyway?</span>
                <button className="btn sm danger" disabled={blocked} onClick={() => mark(true)}>Mark resolved anyway</button>
              </div>
            )}
            <div className="nx-resolve-actions">
              <button className="btn" disabled={c.saving} onClick={() => setEditing(true)}>Edit result…</button>
              <button className="btn accent" disabled={blocked || n > 0} title={resolveTitle} onClick={() => mark(false)}>{resolveLabel}</button>
            </div>
          </>
        )}
      </section>
      {editing && text && (
        <EditResultDialog path={path} text={c.text} onClose={() => setEditing(false)}
          onSave={value => { c.setText(value); setEditing(false) }} />
      )}
    </>
  )
}
