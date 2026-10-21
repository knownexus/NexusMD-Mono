import React from 'react'
import { diffSides } from '@nexusmd/core'
import { languageForPath } from '../shared/languages.js'
import { highlightLines, changedRange, markRange, Pieces } from '../shared/highlight.jsx'

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

// A hunk patch would also carry a rename, copy or mode change, and a staged deletion has no index
// entry to apply against, so main refuses these and the buttons are hidden.
function wholeFileOnly(file, area) {
  return file.status === 'renamed' || file.status === 'copied' || file.meta.some(m => /^(old|new) mode /.test(m)) ||
    (area === 'staged' && file.status === 'deleted')
}

/**
 * A change's unified diff: a legend naming the old and new sides, line numbers, and hunk buttons.
 * The history passes its own `sides` (parent and commit ids) and `readOnly`, which drops the hunk
 * buttons and the staging advice.
 */
export function DiffPane({ change, diff, onHunk, onLine = null, busy = false, sides: sidesOverride = null, readOnly = false }) {
  // Stable for the memoised rows, which would otherwise re-render on every parent render.
  const lineRef = React.useRef(onLine)
  lineRef.current = onLine
  const clickLine = React.useCallback(n => lineRef.current?.(n), [])
  if (!change) return <div style={{ color: 'var(--text-muted)' }}>Select a file to see its diff.</div>
  const sides = sidesOverride ?? diffSides(change)
  const { result, files, error, loading } = diff
  const hunkLabel = readOnly ? null : sides?.staging === 'stage' ? 'Stage hunk' : sides?.staging === 'unstage' ? 'Unstage hunk' : null
  const showHunks = !!hunkLabel && !!result && !result.binary && !result.truncated && files.length === 1 && !wholeFileOnly(files[0], change.area)
  const textual = result && !result.gone && !result.binary && !result.truncated
  // An empty diff for a tracked change means it was staged or reverted since the list was read.
  const empty = textual && !result.text
  const metaOnly = textual && !!result.text && files.length > 0 && files.every(f => !f.hunks.length) && files.some(f => f.meta.length)
  return (
    <section aria-label="Diff" style={{ minHeight: 0, overflow: 'auto', fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>
      <div aria-label="Diff legend" style={{ display: 'flex', gap: 16, padding: '4px 0', position: 'sticky', top: 0, background: 'var(--surface, var(--bg))' }}>
        {sides?.old && <span style={{ color: 'var(--danger)' }}>{`− old: ${sides.old}`}</span>}
        {sides && <span style={{ color: 'var(--success)' }}>{sides.old ? `+ new: ${sides.new}` : `+ ${sides.new}`}</span>}
        <span style={{ marginLeft: 'auto' }}>{change.path}</span>
        {loading && <span style={{ color: 'var(--text-muted)' }}>Loading…</span>}
      </div>
      {sides?.old && <div aria-hidden="true" style={{ ...GRID, color: 'var(--text-muted)' }}><span>old</span><span>new</span></div>}
      {error && <div role="alert" style={{ color: 'var(--danger)' }}>{error}</div>}
      {result?.gone && note('No longer changed.')}
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
              <HunkLines lines={h.lines} language={languageForPath(f.path || change.path)} onLine={onLine ? clickLine : null} />
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}
