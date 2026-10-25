import React from 'react'
import { diffSides, actionsFor } from '@nexusmd/core'
import { languageForPath, languageLabel } from '../shared/languages.js'
import { highlightLines, changedRange, markRange, Pieces } from '../shared/highlight.jsx'
import { isImagePath } from './image-types.js'
import { ImageDiff } from './image-view.jsx'

const LINE_STYLE = {
  add: { background: 'color-mix(in srgb, var(--success) 18%, transparent)' },
  del: { background: 'color-mix(in srgb, var(--danger) 18%, transparent)' },
  context: {},
  meta: { color: 'var(--text-muted)', fontStyle: 'italic' },
}
const SIGN = { add: '+', del: '−', context: ' ', meta: ' ' }
const GRID = { display: 'grid', gridTemplateColumns: '5ch 5ch 2ch 1fr', columnGap: 4 }
const size = n => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(n / 1024))} KB`)
const note = text => <div role="note" style={{ color: 'var(--text-muted)', padding: 8 }}>{text}</div>

/**
 * Each line of a hunk as coloured pieces. The old side (context and removed lines) and the new side
 * (context and added lines) are each coloured as the code they are, so a string or comment that
 * opens on one line colours the next. A removed line followed by an added one also has the words
 * that changed between them marked.
 */
export function hunkPieces(lines, language) {
  const side = keep => highlightLines(lines.filter(l => l.kind !== 'meta' && l.kind !== keep).map(l => l.text).join('\n'), language)
  const before = side('add')
  const after = side('del')
  let o = 0
  let n = 0
  const pieces = lines.map(l => {
    if (l.kind === 'meta') return [[l.text, null]]
    if (l.kind === 'del') return before[o++]
    if (l.kind !== 'add') o++
    return after[n++]
  })
  for (let i = 0; i < lines.length;) {
    if (lines[i].kind !== 'del') { i++; continue }
    let d = i
    while (d < lines.length && lines[d].kind === 'del') d++
    let a = d
    while (a < lines.length && lines[a].kind === 'add') a++
    for (let k = 0; k < Math.min(d - i, a - d); k++) {
      const r = changedRange(lines[i + k].text, lines[d + k].text)
      if (!r) continue
      pieces[i + k] = markRange(pieces[i + k], r.before, 'nx-word-del')
      pieces[d + k] = markRange(pieces[d + k], r.after, 'nx-word-add')
    }
    i = a
  }
  return pieces
}

// "@@ -1,3 +1,4 @@ function name()": the line ranges, then the code git names as the hunk's context.
function HunkHeader({ header, children }) {
  const m = /^(@@ [^@]* @@)\s?(.*)$/.exec(header)
  return (
    <div className="nx-hunk-head">
      <span className="nx-hunk-range">{m ? m[1] : header}</span>
      {m?.[2] && <span className="nx-hunk-context" title={m[2]}>{m[2]}</span>}
      {children}
    </div>
  )
}

// One row per line; memoised on the hunk's lines, which useDiff keeps when a reload brings the same diff.
// With `onLine`, a row that has a new-side number opens the file there when clicked.
const HunkLines = React.memo(function HunkLines({ lines, language, onLine }) {
  const pieces = React.useMemo(() => hunkPieces(lines, language), [lines, language])
  return lines.map((l, li) => (
    <div key={li} data-testid="diff-line" data-kind={l.kind} style={{ ...GRID, ...LINE_STYLE[l.kind], ...(onLine && l.newNo != null ? { cursor: 'pointer' } : null) }}
      title={onLine && l.newNo != null ? `Edit at line ${l.newNo}` : undefined} onClick={onLine && l.newNo != null ? () => onLine(l.newNo) : undefined}>
      <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>{l.oldNo ?? ''}</span>
      <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>{l.newNo ?? ''}</span>
      <span>{SIGN[l.kind]}</span>
      <span style={{ whiteSpace: 'pre' }}><Pieces pieces={pieces[li]} /></span>
    </div>
  ))
})

/**
 * A hunk's lines as side-by-side rows: context on both sides, each run of removed lines paired with
 * the added run after it (the shorter run's side left empty), and git's meta lines across both.
 * Each row is { left, right } line indexes (null for an empty side), or { meta } for a meta line.
 */
export function splitRows(lines) {
  const rows = []
  for (let i = 0; i < lines.length;) {
    const kind = lines[i].kind
    if (kind === 'meta') { rows.push({ meta: i++ }); continue }
    if (kind === 'context') { rows.push({ left: i, right: i }); i++; continue }
    let d = i
    while (d < lines.length && lines[d].kind === 'del') d++
    let a = d
    while (a < lines.length && lines[a].kind === 'add') a++
    for (let k = 0; k < Math.max(d - i, a - d); k++) rows.push({ left: i + k < d ? i + k : null, right: d + k < a ? d + k : null })
    i = a
  }
  return rows
}

const SPLIT_GRID = { display: 'grid', gridTemplateColumns: '5ch minmax(0, 1fr) 5ch minmax(0, 1fr)', columnGap: 4 }
const EMPTY_SIDE = { background: 'var(--surface-2)' }

// The side-by-side form of HunkLines: old on the left, new on the right. A new-side cell opens the file there.
const HunkPairs = React.memo(function HunkPairs({ lines, language, onLine }) {
  const pieces = React.useMemo(() => hunkPieces(lines, language), [lines, language])
  const rows = React.useMemo(() => splitRows(lines), [lines])
  const side = (i, no) => {
    if (i == null) return [<span key="n" style={EMPTY_SIDE} />, <span key="t" style={EMPTY_SIDE} />]
    const l = lines[i]
    const style = { ...LINE_STYLE[l.kind] }
    const click = onLine && no === 'newNo' && l.newNo != null ? () => onLine(l.newNo) : undefined
    return [
      <span key="n" style={{ ...style, color: 'var(--text-muted)', textAlign: 'right' }}>{l[no] ?? ''}</span>,
      <span key="t" style={{ ...style, whiteSpace: 'pre', overflow: 'hidden', ...(click ? { cursor: 'pointer' } : null) }}
        title={click ? `Edit at line ${l.newNo}` : undefined} onClick={click}><Pieces pieces={pieces[i]} /></span>,
    ]
  }
  return rows.map((r, ri) => (r.meta != null
    ? <div key={ri} data-testid="diff-pair" data-kind="meta" style={LINE_STYLE.meta}>{lines[r.meta].text}</div>
    : (
      <div key={ri} data-testid="diff-pair" style={SPLIT_GRID}>
        {side(r.left, 'oldNo')}
        {side(r.right, 'newNo')}
      </div>
    )))
})

// Lines added and removed across a diff's files, for the header's +n / −n.
function lineCounts(files) {
  let add = 0
  let del = 0
  for (const f of files) for (const h of f.hunks) for (const l of h.lines) { if (l.kind === 'add') add++; else if (l.kind === 'del') del++ }
  return { add, del }
}

// The file buttons the header offers for a change: Stage or Unstage file, and Discard… (Delete… when untracked).
// A conflict is resolved from its own screen, so it gets none here.
function fileButtons(change) {
  if (!change || change.area === 'conflict') return []
  const a = actionsFor([change], [change.id])
  return [
    a.stage.length && { action: 'stage', label: 'Stage file' },
    a.unstage.length && { action: 'unstage', label: 'Unstage file' },
    a.discard.length && { action: 'discard', label: 'Discard…', name: 'Discard file…', danger: true },
    a.delete.length && { action: 'delete', label: 'Delete…', name: 'Delete file…', danger: true },
  ].filter(Boolean)
}

// A hunk patch would also carry a rename, copy or mode change, and a staged deletion has no index
// entry to apply against, so main refuses these and the buttons are hidden.
function wholeFileOnly(file, area) {
  return file.status === 'renamed' || file.status === 'copied' || file.meta.some(m => /^(old|new) mode /.test(m)) ||
    (area === 'staged' && file.status === 'deleted')
}

/**
 * A change's diff, unified or side by side: a header with the path, language and line counts, the
 * view switch and file buttons; a legend naming the old and new sides; line numbers; hunk buttons.
 * `onFile(action)` runs a header file button (stage | unstage | discard | delete); without it there are none.
 * The history passes its own `sides` (parent and commit ids) and `readOnly`, which drops the hunk
 * and file buttons and the staging advice. `images` ({ load(side, rel), key }) shows a changed image as
 * before and after above the text (an SVG's source still follows); without it a binary file is just noted.
 */
export function DiffPane({ change, diff, onHunk, onLine = null, onFile = null, busy = false, sides: sidesOverride = null, readOnly = false, images = null }) {
  // Stable for the memoised rows, which would otherwise re-render on every parent render.
  const lineRef = React.useRef(onLine)
  lineRef.current = onLine
  const clickLine = React.useCallback(n => lineRef.current?.(n), [])
  const [mode, setMode] = React.useState('unified')
  if (!change) return <div style={{ color: 'var(--text-muted)' }}>Select a file to see its diff.</div>
  const sides = sidesOverride ?? diffSides(change)
  const { result, files, error, loading } = diff
  const language = languageForPath(change.path)
  const counts = lineCounts(files)
  const buttons = readOnly || !onFile ? [] : fileButtons(change)
  const split = mode === 'split'
  const Rows = split ? HunkPairs : HunkLines
  const hunkLabel = readOnly ? null : sides?.staging === 'stage' ? 'Stage hunk' : sides?.staging === 'unstage' ? 'Unstage hunk' : null
  const showHunks = !!hunkLabel && !!result && !result.binary && !result.truncated && files.length === 1 && !wholeFileOnly(files[0], change.area)
  const textual = result && !result.gone && !result.binary && !result.truncated
  // An empty diff for a tracked change means it was staged or reverted since the list was read.
  const empty = textual && !result.text
  const metaOnly = textual && !!result.text && files.length > 0 && files.every(f => !f.hunks.length) && files.some(f => f.meta.length)
  return (
    <section aria-label="Diff" style={{ minHeight: 0, overflow: 'auto', fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg)' }}>
        <div className="nx-gw-diff-head" style={{ padding: '4px 0 8px', fontFamily: 'var(--sans)' }}>
          <div className="nx-gw-diff-path">
            <span className="p" title={change.path}>{change.path}</span>
            {languageLabel(language) && <span className="nx-gw-lang">{languageLabel(language)}</span>}
            {counts.add > 0 && <span className="add" aria-label={`${counts.add} added`}>{`+${counts.add}`}</span>}
            {counts.del > 0 && <span className="del" aria-label={`${counts.del} removed`}>{`−${counts.del}`}</span>}
          </div>
          <div className="nx-gw-diff-actions">
            <div role="group" aria-label="Diff view" className="nx-gw-seg sm">
              <button aria-pressed={!split} onClick={() => setMode('unified')}>Unified</button>
              <button aria-pressed={split} onClick={() => setMode('split')}>Side by side</button>
            </div>
            {buttons.map(b => (
              <button key={b.action} className={`btn sm${b.danger ? ' ghost danger' : ''}`} disabled={busy} aria-label={b.name}
                title={`${b.label.replace('…', '')} ${change.path}`} onClick={() => onFile(b.action)}>{b.label}</button>
            ))}
          </div>
        </div>
        <div aria-label="Diff legend" style={{ display: 'flex', gap: 16, padding: '4px 0' }}>
          {sides?.old && <span style={{ color: 'var(--danger)' }}>{`− old: ${sides.old}`}</span>}
          {sides && <span style={{ color: 'var(--success)' }}>{sides.old ? `+ new: ${sides.new}` : `+ ${sides.new}`}</span>}
          {loading && <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>Loading…</span>}
        </div>
      </div>
      {sides?.old && !split && <div aria-hidden="true" style={{ ...GRID, color: 'var(--text-muted)' }}><span>old</span><span>new</span></div>}
      {error && <div role="alert" style={{ color: 'var(--danger)' }}>{error}</div>}
      {result?.gone && note('No longer changed.')}
      {images && isImagePath(change.path) && result && !result.gone && <ImageDiff change={change} load={images.load} loadKey={images.key} />}
      {result?.binary && note(`Binary file${result.size ? ` (${size(result.size)})` : ''}.${readOnly ? '' : ' Stage or discard it as a whole.'}`)}
      {result?.truncated && note(`This diff is too large to show (${size(result.size)}).${readOnly ? '' : ' Stage or discard the file as a whole.'}`)}
      {empty && change.area !== 'conflict' && note(readOnly ? 'No textual changes.' : change.area === 'untracked' ? 'Empty file.' : 'No longer changed.')}
      {metaOnly && change.area !== 'conflict' && note('No textual changes (mode change or submodule).')}
      {files.map((f, fi) => (
        <div key={fi}>
          {files.length > 1 && <div style={{ fontWeight: 600, paddingTop: 6 }}>{f.path}</div>}
          {f.meta.map((m, i) => <div key={i} style={LINE_STYLE.meta}>{m}</div>)}
          {f.hunks.map((h, hi) => (
            <div key={hi} role="group" aria-label={`Hunk ${hi + 1}`}>
              <HunkHeader header={h.header}>
                {showHunks && (
                  // Disabled while the diff (re)loads too: its stamp may be from before the last write.
                  <button className="btn sm ghost" style={{ marginLeft: 'auto' }} disabled={busy || loading} onClick={() => onHunk(hi, result.stamp)}>{hunkLabel}</button>
                )}
              </HunkHeader>
              <Rows lines={h.lines} language={languageForPath(f.path || change.path)} onLine={onLine ? clickLine : null} />
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}
