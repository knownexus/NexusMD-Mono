import React from 'react'
import { diffSides } from '@nexusmd/core'

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

/** A change's unified diff: a legend naming the old and new sides, line numbers, and hunk buttons. */
export function DiffPane({ change, diff, onHunk, busy = false }) {
  if (!change) return <div style={{ color: 'var(--text-muted)' }}>Select a file to see its diff.</div>
  const sides = diffSides(change)
  const { result, files, error, loading } = diff
  const hunkLabel = sides?.staging === 'stage' ? 'Stage hunk' : sides?.staging === 'unstage' ? 'Unstage hunk' : null
  const showHunks = !!hunkLabel && !!result && !result.binary && !result.truncated && files.length === 1
  const plain = result && !result.gone && !result.binary && !result.truncated && !result.text
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
      {result?.binary && note(`Binary file${result.size ? ` (${size(result.size)})` : ''}. Stage or discard it as a whole.`)}
      {result?.truncated && note(`This diff is too large to show (${size(result.size)}). Stage or discard the file as a whole.`)}
      {change.area === 'conflict' && note('Resolve in your editor, then stage the file.')}
      {plain && change.area !== 'conflict' && note(change.area === 'untracked' ? 'Empty file.' : 'No textual changes (mode change or submodule).')}
      {files.map((f, fi) => (
        <div key={fi}>
          {files.length > 1 && <div style={{ fontWeight: 600, paddingTop: 6 }}>{f.path}</div>}
          {f.meta.map((m, i) => <div key={i} style={LINE_STYLE.meta}>{m}</div>)}
          {f.hunks.map((h, hi) => (
            <div key={hi} role="group" aria-label={`Hunk ${hi + 1}`}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-muted)', paddingTop: 6 }}>
                <span>{h.header}</span>
                {showHunks && (
                  <button className="btn sm ghost" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => onHunk(hi, result.stamp)}>{hunkLabel}</button>
                )}
              </div>
              {h.lines.map((l, li) => (
                <div key={li} data-testid="diff-line" data-kind={l.kind} style={{ ...GRID, ...LINE_STYLE[l.kind] }}>
                  <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>{l.oldNo ?? ''}</span>
                  <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>{l.newNo ?? ''}</span>
                  <span>{SIGN[l.kind]}</span>
                  <span style={{ whiteSpace: 'pre' }}>{l.text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}
