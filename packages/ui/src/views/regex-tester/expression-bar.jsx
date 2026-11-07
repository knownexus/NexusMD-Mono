import React from 'react'
import { Icon } from '../../icons.jsx'
import { Segmented } from '../../segmented.jsx'
import { regexErrorInfo } from '../regex-syntax.js'
import { FLAG_INFO } from './constants.js'
import { PatternInput, ReplacementInput } from './pattern-input.jsx'

const MODES = [{ id: 'match', label: 'Match' }, { id: 'sub', label: 'Replace' }]
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// The status chip: what the pattern does to the test text right now.
function chipFor({ state, matches, error }) {
  if (!state.pattern) return { text: 'enter a pattern', tone: 'muted' }
  if (error) return { text: 'invalid pattern', tone: 'danger' }
  if (state.mode === 'sub') return { text: `${matches.length} replaced`, tone: matches.length ? 'success' : 'warning' }
  return matches.length ? { text: plural(matches.length, 'match', 'matches'), tone: 'success' } : { text: 'no matches', tone: 'warning' }
}

/**
 * The expression bar: the pattern between slashes with the flags inline after them, the status chip, the match
 * stepper (Match mode) and the Match | Replace switch; under it the error line when the pattern is invalid, and in
 * Replace mode the replacement row. `error` is the engine's message for the pattern (null when it compiles).
 */
export function ExpressionBar({ state, patch, matches, selIdx, onStep, error, patternRef = null, onCaret = null }) {
  const info = error ? regexErrorInfo(error, state.pattern) : null
  const chip = chipFor({ state, matches, error })
  const n = matches.length
  const sub = state.mode === 'sub'
  return (
    <div className="nx-rt-bar">
      <div className="nx-rt-bar-row">
        <div className="nx-rt-pattern-field" data-invalid={error ? 'true' : undefined}>
          <span className="nx-rt-slash">/</span>
          <PatternInput value={state.pattern} onChange={pattern => patch({ pattern })} inputRef={patternRef} invalid={!!error} onCaret={onCaret} />
          <span className="nx-rt-slash">/</span>
          <span className="nx-rt-flags">
            {FLAG_INFO.map(([f, tip]) => (
              <button key={f} type="button" className="nx-rt-flag" title={tip} aria-pressed={!!state.flags[f]} onClick={() => patch({ flags: { ...state.flags, [f]: !state.flags[f] } })}>{f}</button>
            ))}
          </span>
        </div>
        <span className="nx-rt-chip" data-tone={chip.tone}>{chip.text}</span>
        {!sub && (
          <div className="nx-rt-stepper">
            <button type="button" title="Previous" disabled={n < 2} onClick={() => onStep(-1)}>‹</button>
            <span>{selIdx >= 0 ? `${selIdx + 1} / ${n}` : n ? String(n) : '—'}</span>
            <button type="button" title="Next" disabled={n < 2} onClick={() => onStep(1)}>›</button>
          </div>
        )}
        <Segmented ariaLabel="Mode" value={state.mode} onChange={mode => patch({ mode })} options={MODES} />
      </div>
      {info && (
        <div role="alert" className="nx-rt-error">
          <Icon name="alert" size={12} />
          <span>{[info.message, info.column != null ? `column ${info.column}` : null, info.hint].filter(Boolean).join(' · ')}</span>
        </div>
      )}
      {sub && (
        <div className="nx-rt-replace">
          <span className="nx-rt-eyebrow">With</span>
          <ReplacementInput value={state.subReplacement} onChange={subReplacement => patch({ subReplacement })} />
          <span className="nx-rt-hint">$&amp; whole match · $1 $2 groups · $&lt;name&gt;</span>
        </div>
      )}
    </div>
  )
}
