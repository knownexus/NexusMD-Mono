import React from 'react'
import { tokenizePattern } from '../regex-syntax.js'
import { groupColor } from './constants.js'

const KIND_COLOR = { escape: 'var(--accent)', class: 'var(--success)', quant: 'var(--warning)', literal: 'var(--text)' }

// A coloured copy of the text drawn behind a transparent input, so what is typed is what is coloured.
function Overlay({ overlayRef, children }) {
  return <div className="nx-rt-overlay" aria-hidden="true" ref={overlayRef}>{children}</div>
}

/**
 * The pattern field: an input whose text is drawn transparent over a coloured copy. Escapes are the accent
 * colour, classes success, quantifiers warning, literals plain, each capture group's parentheses in the group's
 * colour, and the ( of a group never closed in the danger colour.
 */
export function PatternInput({ value, onChange, inputRef = null, invalid = false }) {
  const overlay = React.useRef(null)
  const tokens = React.useMemo(() => tokenizePattern(value), [value])
  const sync = e => { if (overlay.current) overlay.current.scrollLeft = e.target.scrollLeft }
  return (
    <div className="nx-rt-pattern-wrap">
      <Overlay overlayRef={overlay}>
        {tokens.map((t, i) => {
          const color = t.group ? groupColor(t.group) : KIND_COLOR[t.kind]
          const style = t.kind === 'unclosed' ? { color: 'var(--danger)', background: 'var(--danger-soft)' } : { color: color ?? 'var(--text)' }
          return <span key={i} data-kind={t.kind} data-group={t.group} style={style}>{t.text}</span>
        })}
      </Overlay>
      <input ref={inputRef} className="nx-rt-pattern-input" value={value} onChange={e => onChange(e.target.value)} onScroll={sync} onSelect={sync} onKeyUp={sync}
        placeholder="Enter pattern…" spellCheck={false} aria-label="Pattern" aria-invalid={invalid || undefined} />
    </div>
  )
}

/** The replacement field: the same trick, with $1, $2… drawn in their group's colour. */
export function ReplacementInput({ value, onChange }) {
  const overlay = React.useRef(null)
  const parts = React.useMemo(() => value.split(/(\$\d{1,2})/g).filter(Boolean), [value])
  const sync = e => { if (overlay.current) overlay.current.scrollLeft = e.target.scrollLeft }
  return (
    <div className="nx-rt-pattern-wrap nx-rt-replace-wrap">
      <Overlay overlayRef={overlay}>
        {parts.map((p, i) => (/^\$\d{1,2}$/.test(p)
          ? <span key={i} data-group={Number(p.slice(1))} style={{ color: groupColor(Number(p.slice(1))) }}>{p}</span>
          : <span key={i}>{p}</span>))}
      </Overlay>
      <input className="nx-rt-pattern-input" value={value} onChange={e => onChange(e.target.value)} onScroll={sync} onSelect={sync} onKeyUp={sync}
        placeholder="$1, $2, $& …" spellCheck={false} aria-label="Replacement" />
    </div>
  )
}
