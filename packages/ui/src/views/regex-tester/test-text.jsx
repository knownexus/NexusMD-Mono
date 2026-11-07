import React from 'react'
import { Icon } from '../../icons.jsx'
import { buildOverlaySegments, splitMatchByGroups } from '../regex-tester-helpers.js'
import { tokenizePattern } from '../regex-syntax.js'
import { GROUP_COLORS, groupColor } from './constants.js'

// Where the caret is, as the footer says it: 1-based line and column.
function caretPlace(text, pos) {
  const before = text.slice(0, pos)
  const line = before.split('\n').length
  return { line, col: pos - (before.lastIndexOf('\n') + 1) + 1 }
}

/**
 * The test text: a tab per case (and + for another), the editor with a line-number gutter and the matches
 * drawn behind the text, and a footer. Groups are underlined in their colour, a match outside any group in
 * the warning colour, the selected match more strongly. An invalid pattern shows plain text. In Replace mode the
 * editor shares the width with the RESULT, whose replaced spans are marked. A click inside a highlight selects
 * that match (the overlay is behind the text, so the caret's place says which).
 */
export function TestText({ state, matches, selIdx, onSelectMatch, error, resultSegments, onCase, onAddCase, onText }) {
  const overlayRef = React.useRef(null)
  const gutterRef = React.useRef(null)
  const [caret, setCaret] = React.useState(0)
  const testCase = state.testCases[state.tcIndex] || state.testCases[0]
  const text = testCase.content
  const sub = state.mode === 'sub'
  const segments = React.useMemo(() => (error ? [{ text, matchIndex: null }] : buildOverlaySegments(text, matches)), [error, text, matches])
  const groups = React.useMemo(() => {
    const numbers = tokenizePattern(state.pattern).filter(t => t.kind === 'group-open' && t.group).map(t => t.group)
    return [...new Set(numbers)]
  }, [state.pattern])
  const lines = text.split('\n').length
  const result = resultSegments ? resultSegments.map(s => s.text).join('') : null

  const sync = e => {
    const { scrollTop, scrollLeft } = e.target
    if (overlayRef.current) { overlayRef.current.scrollTop = scrollTop; overlayRef.current.scrollLeft = scrollLeft }
    if (gutterRef.current) gutterRef.current.scrollTop = scrollTop
  }
  const track = e => setCaret(e.target.selectionStart ?? 0)
  const click = e => {
    const pos = e.currentTarget.selectionStart ?? 0
    setCaret(pos)
    const i = matches.findIndex(m => m.value && pos >= m.index && pos < m.index + m.value.length)
    if (i >= 0 && !error) onSelectMatch(i)
  }
  const place = caretPlace(text, caret)
  return (
    <div className="nx-rt-test">
      <div className="nx-rt-cases">
        <div role="tablist" aria-label="Test cases" className="nx-rt-case-tabs">
          {state.testCases.map((tc, i) => (
            <button key={i} type="button" role="tab" className="nx-rt-case" aria-selected={i === state.tcIndex} onClick={() => onCase(i)}>{tc.name}</button>
          ))}
          <button type="button" className="nx-rt-case-add" title="New test case" aria-label="New test case" onClick={onAddCase}><Icon name="plus" size={12} /></button>
        </div>
        <div className="nx-rt-legend">
          {groups.map(n => (
            <span key={n} className="nx-rt-legend-item"><span className="nx-rt-swatch" style={{ background: groupColor(n) }} />{`Group ${n}`}</span>
          ))}
        </div>
      </div>
      <div className="nx-rt-panes" data-split={sub ? '' : undefined}>
        <div className="nx-rt-editor">
          <div className="nx-rt-gutter" aria-hidden="true" ref={gutterRef}>
            {Array.from({ length: lines }, (_, i) => <span key={i}>{i + 1}</span>)}
          </div>
          <div className="nx-rt-editor-body">
            <div className="nx-rt-overlay" aria-hidden="true" ref={overlayRef} style={{ alignItems: 'flex-start', display: 'block' }}>
              {segments.map((seg, i) => {
                if (!seg.text) return null
                if (seg.matchIndex === null) return <React.Fragment key={i}>{seg.text}</React.Fragment>
                return (
                  <mark key={i} className={`nx-rt-m${seg.matchIndex === selIdx ? ' sel' : ''}`}>
                    {splitMatchByGroups(seg.text, seg.groupSpans).map((piece, pi) => (piece.colorIndex === null
                      ? <React.Fragment key={pi}>{piece.text}</React.Fragment>
                      : <span key={pi} style={{ borderBottom: `2px solid ${GROUP_COLORS[piece.colorIndex]}`, background: `${GROUP_COLORS[piece.colorIndex]}18` }}>{piece.text}</span>))}
                  </mark>
                )
              })}
            </div>
            <textarea className="nx-rt-textarea" value={text} onChange={e => { onText(e.target.value); track(e) }} onScroll={sync} onSelect={track} onKeyUp={track} onClick={click}
              placeholder="Enter test string…" spellCheck={false} wrap="off" aria-label="Test text" />
          </div>
        </div>
        {sub && (
          <div className="nx-rt-result">
            <div className="nx-rt-result-head">
              <span className="nx-rt-eyebrow" style={{ color: 'var(--success)' }}>Result</span>
              <button type="button" className="nx-rt-ghost" disabled={result == null} onClick={() => navigator.clipboard?.writeText(result)}>Copy</button>
            </div>
            {resultSegments
              ? (
                <div className="nx-rt-result-text">
                  {resultSegments.map((s, i) => (s.replaced ? <span key={i} className="nx-rt-replaced">{s.text}</span> : <React.Fragment key={i}>{s.text}</React.Fragment>))}
                </div>
              )
              : <div className="nx-rt-note">Fix the pattern to see the result.</div>}
          </div>
        )}
      </div>
      <div className="nx-rt-foot">
        <span>{sub && result != null ? `${text.length} chars → ${result.length} chars` : `${text.length} chars · Ln ${place.line}, Col ${place.col}`}</span>
        <span className="nx-rt-foot-hint">Click a match to select it · Ctrl ↑/↓ to step</span>
      </div>
    </div>
  )
}
