import React from 'react'
import { Icon } from '../../icons.jsx'
import { Segmented } from '../../segmented.jsx'
import { genCode, REFERENCE_DATA } from '../regex-tester-helpers.js'
import { groupColor } from './constants.js'

export const LANGS = ['JS', 'Python', 'PHP', 'Go', 'Java', 'C#', 'Ruby']

/** Matches: a compact card per match, its groups beneath. Selecting a card selects the match in the text too. */
export function MatchesPanel({ matches, selIdx, onSelect, hasPattern }) {
  if (!matches.length) return <div className="nx-rt-panel-note">{hasPattern ? 'No matches found' : 'Enter a pattern and test text to see matches'}</div>
  return (
    <div className="nx-rt-panel-body">
      {matches.map((m, i) => {
        const namedKeys = Object.keys(m.named || {})
        return (
          <div key={i} className="nx-rt-match" data-selected={i === selIdx ? 'true' : undefined} onClick={() => onSelect(i)}>
            <div className="nx-rt-match-head">
              <span className="nx-rt-badge">{i + 1}</span>
              {m.value ? <span className="nx-rt-match-value">{m.value}</span> : <span className="nx-rt-match-value nx-rt-faint">empty match</span>}
              <span className="nx-rt-match-range">{`${m.index}–${m.index + m.value.length} · len ${m.value.length}`}</span>
            </div>
            {m.groups.map((g, gi) => (
              <div key={gi} className="nx-rt-group">
                <span className="nx-rt-group-label"><span className="nx-rt-swatch-sq" style={{ background: groupColor(gi + 1) }} />{namedKeys[gi] ? `?<${namedKeys[gi]}>` : `Group ${gi + 1}`}</span>
                {g != null ? <span className="nx-rt-group-value">{g}</span> : <span className="nx-rt-group-value nx-rt-faint">undefined</span>}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// The snippet cut into plain text, comments, strings and keywords, for colouring.
const CODE_TOKEN = /(\/\/[^\n]*|#[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(const|let|var|if|else|for|foreach|while|import|from|def|return|new|func|package|public|static|void|class|using|end|puts|print|echo|as|do|in|string|try|catch)\b/g
function codeParts(code) {
  const parts = []
  let at = 0
  for (const m of code.matchAll(CODE_TOKEN)) {
    if (m.index > at) parts.push({ text: code.slice(at, m.index) })
    parts.push({ text: m[0], tok: m[1] ? 'comment' : m[2] ? 'string' : 'keyword' })
    at = m.index + m[0].length
  }
  if (at < code.length) parts.push({ text: code.slice(at) })
  return parts
}

/** Code: the pattern as code in the chosen language (the Replace mode's replacement in its replace line). */
export function CodePanel({ lang, onLang, pattern, flagsStr, replacement, mode }) {
  const code = pattern ? genCode(lang, pattern, flagsStr, mode === 'sub' && replacement ? replacement : undefined) : '// Enter a pattern to generate code'
  const parts = React.useMemo(() => codeParts(code), [code])
  return (
    <div className="nx-rt-panel-fill">
      <div className="nx-rt-code-tools">
        <select aria-label="Language" className="nx-rt-select" value={lang} onChange={e => onLang(e.target.value)}>
          {LANGS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <span className="nx-rt-code-note">The pattern, ready to paste.</span>
        <button type="button" className="nx-rt-ghost" disabled={!pattern} onClick={() => navigator.clipboard?.writeText(code)}><Icon name="copy" size={12} /> Copy</button>
      </div>
      <pre className="nx-rt-code">{parts.map((p, i) => (p.tok ? <span key={i} data-tok={p.tok}>{p.text}</span> : <React.Fragment key={i}>{p.text}</React.Fragment>))}</pre>
    </div>
  )
}

const DOT = { pass: '✓', fail: '✗', pending: '?' }
const EXPECT = [{ id: 'match', label: 'Match' }, { id: 'none', label: 'No match' }]

/** Tests: how many pass, a row per test, and the add bar pinned at the bottom (Enter adds). */
export function TestsPanel({ tests, onAdd, onDelete }) {
  const [str, setStr] = React.useState('')
  const [expect, setExpect] = React.useState('match')
  const pending = tests.filter(t => t.result === 'pending').length
  const passing = tests.filter(t => t.result === 'pass').length
  const submit = () => {
    if (!str.trim()) return
    onAdd(str, expect === 'match')
    setStr('')
  }
  return (
    <div className="nx-rt-panel-fill">
      <div className="nx-rt-panel-body">
        {!tests.length
          ? <div className="nx-rt-panel-note">No tests yet. Add a string below.</div>
          : (
            <>
              <div className="nx-rt-tests-summary">
                {pending ? <span>{`${pending} ${pending === 1 ? 'test' : 'tests'} pending`}</span> : <span>{`${passing}/${tests.length} passing`}</span>}
                {!!pending && <span className="nx-rt-faint">They run again as soon as the pattern compiles.</span>}
              </div>
              {tests.map((t, i) => (
                <div key={i} className="nx-rt-test-row">
                  <span className="nx-rt-dot" data-result={t.result}>{DOT[t.result]}</span>
                  <span className="nx-rt-test-str" title={t.str}>{t.str}</span>
                  <span className="nx-rt-test-kind">{t.expectMatch ? 'should match' : 'no match'}</span>
                  <button type="button" className="nx-rt-test-del" aria-label="Delete test" title="Delete test" onClick={() => onDelete(i)}>×</button>
                </div>
              ))}
            </>
          )}
      </div>
      <div className="nx-rt-addbar">
        <input value={str} onChange={e => setStr(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit() }} placeholder="Test string…" spellCheck={false} aria-label="New test string" />
        <Segmented size="sm" ariaLabel="Expected result" value={expect} onChange={setExpect} options={EXPECT} />
      </div>
    </div>
  )
}

/** Reference: the cheat sheet with a filter; a click hands the token to onInsert (the caret's place is the page's). */
export function ReferencePanel({ onInsert }) {
  const [filter, setFilter] = React.useState('')
  const q = filter.trim().toLowerCase()
  const groups = q
    ? REFERENCE_DATA.map(g => ({ ...g, i: g.i.filter(it => it.k.toLowerCase().includes(q) || it.d.toLowerCase().includes(q)) })).filter(g => g.i.length)
    : REFERENCE_DATA
  return (
    <div className="nx-rt-panel-fill">
      <div className="nx-rt-ref-filter"><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter…" spellCheck={false} aria-label="Filter reference" /></div>
      <div className="nx-rt-panel-body">
        {groups.map(g => (
          <div key={g.t} className="nx-rt-ref-group">
            <div className="nx-rt-eyebrow">{g.t}</div>
            {g.i.map(it => (
              <div key={it.k} className="nx-rt-ref-item" onClick={() => onInsert(it.k)}>
                <span className="nx-rt-ref-key">{it.k}</span>
                <span className="nx-rt-ref-desc">{it.d}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
