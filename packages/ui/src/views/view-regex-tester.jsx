// view-regex-tester.jsx — full React port of docs/regex-tester.html, minus
// the AI "Explain this pattern" tab (no working backend for it) and the
// contentEditable pattern input (replaced with a plain <input> — see the
// design spec for why). Styled with the app's theme tokens.
import React from 'react'
import { Icon } from '../icons.jsx'
import {
  findMatches, buildOverlaySegments, splitMatchByGroups, runUnitTests, genCode, REFERENCE_DATA,
} from './regex-tester-helpers.js'
import { useDocumentAutosave, relativeTime } from './document-store.js'
import { DocumentsModal } from './documents-modal.jsx'

const { useState, useEffect, useMemo, useRef } = React

const FLAG_INFO = [
  ['g', 'Global — find all matches'],
  ['i', 'Case insensitive'],
  ['m', 'Multiline — ^ and $ match line ends'],
  ['s', 'Dotall — . matches newlines'],
  ['u', 'Unicode'],
]
const LANGS = ['JS', 'Python', 'PHP', 'Go', 'Java', 'C#', 'Ruby']
// Per-capture-group highlight colors: a small fixed, theme-independent
// palette (group N needs a stable, distinguishable color, not a semantic
// theme color).
const GROUP_COLORS = ['#818cf8', '#60a5fa', '#34d399', '#fb923c', '#c084fc', '#f472b6']
const DOCS_STORAGE_KEY = 'regex_tester_documents'

const DEFAULT_STATE = {
  pattern: '(\\w+)@([\\w.-]+\\.[a-z]{2,})',
  flags: { g: true, i: false, m: false, s: false, u: false },
  mode: 'match',
  testCases: [
    { name: 'Email', content: 'support@example.com\nsales@company.org\njohn.doe@email.co.uk\n\nInvalid: notanemail, @nodomain.com' },
    { name: 'URL', content: 'https://www.example.com/path?q=1&page=2\nhttp://sub.example.co.uk#anchor\nftp://files.server.net/data.zip' },
    { name: 'Phone', content: '+1 (555) 123-4567\n+44 20 7946 0958\n555.867.5309\n1-800-GOT-JUNK' },
    { name: 'Dates', content: '2024-01-15\n15/01/2024\nJanuary 15, 2024\nJan 15 2024' },
  ],
  tcIndex: 0,
  subReplacement: '',
  unitTests: [
    { str: 'test@example.com', expectMatch: true },
    { str: 'not-an-email', expectMatch: false },
  ],
}

function flagsToString(flags) {
  return Object.keys(flags).filter(f => flags[f]).join('')
}

// A saved doc's display name: the pattern itself, since that's the natural
// identifier for a saved regex.
function regexAutoName(state) {
  return state.pattern ? `/${state.pattern}/${flagsToString(state.flags)}`.slice(0, 80) : 'Untitled'
}

export function RegexTesterView() {
  const {
    content: state, setContent: setState, docs, currentDocId, hasUnsavedContent,
    openDoc, newDoc, deleteDoc, renameDoc,
  } = useDocumentAutosave({
    storageKey: DOCS_STORAGE_KEY,
    initialContent: DEFAULT_STATE,
    emptyContent: { ...DEFAULT_STATE, pattern: '' },
    isEmpty: s => !s.pattern,
    extractAutoName: regexAutoName,
  })
  const [showDocsModal, setShowDocsModal] = useState(false)
  const [selIdx, setSelIdx] = useState(-1)
  const [bottomTab, setBottomTab] = useState('code')
  const [codeLang, setCodeLang] = useState('JS')
  const [refFilter, setRefFilter] = useState('')
  const overlayRef = useRef(null)

  function patch(p) { setState(prev => ({ ...prev, ...p })) }

  const flagsStr = flagsToString(state.flags)
  const testCase = state.testCases[state.tcIndex] || state.testCases[0]
  const testStr = testCase.content

  const matches = useMemo(() => {
    if (!state.pattern) return []
    return findMatches(state.pattern, flagsStr, testStr) || []
  }, [state.pattern, flagsStr, testStr])

  useEffect(() => { if (selIdx >= matches.length) setSelIdx(-1) }, [matches.length, selIdx])

  const patternError = useMemo(() => {
    if (!state.pattern) return null
    try { new RegExp(state.pattern, flagsStr); return null }
    catch (e) { return e.message }
  }, [state.pattern, flagsStr])

  const unitTestResults = useMemo(
    () => runUnitTests(state.unitTests, state.pattern, flagsStr),
    [state.unitTests, state.pattern, flagsStr]
  )

  const currentRe = useMemo(() => {
    if (!state.pattern || patternError) return null
    try { return new RegExp(state.pattern, flagsStr) } catch { return null }
  }, [state.pattern, flagsStr, patternError])

  const subResult = useMemo(() => {
    if (!currentRe || !testStr) return null
    try { return testStr.replace(currentRe, state.subReplacement) }
    catch { return 'INVALID' }
  }, [currentRe, testStr, state.subReplacement])

  const overlaySegments = useMemo(() => buildOverlaySegments(testStr, matches), [testStr, matches])

  function setTestContent(content) {
    const next = state.testCases.map((tc, i) => i === state.tcIndex ? { ...tc, content } : tc)
    patch({ testCases: next })
  }
  function switchTestCase(i) { patch({ tcIndex: i }); setSelIdx(-1) }
  function addTestCase() {
    const name = window.prompt('Test case name:', `Case ${state.testCases.length + 1}`)
    if (!name) return
    const next = [...state.testCases, { name: name.trim() || `Case ${state.testCases.length + 1}`, content: '' }]
    patch({ testCases: next, tcIndex: next.length - 1 })
    setSelIdx(-1)
  }
  function toggleFlag(f) { patch({ flags: { ...state.flags, [f]: !state.flags[f] } }) }
  function navMatch(dir) {
    if (!matches.length) return
    setSelIdx(prev => {
      if (prev < 0) return dir > 0 ? 0 : matches.length - 1
      return (prev + dir + matches.length) % matches.length
    })
  }
  function selectMatch(i) { setSelIdx(prev => prev === i ? -1 : i) }
  function insertToken(tok) { patch({ pattern: state.pattern + tok }) }
  function addUnitTest(str, expectMatch) {
    if (!str.trim()) return
    patch({ unitTests: [...state.unitTests, { str: str.trim(), expectMatch }] })
  }
  function deleteUnitTest(i) {
    patch({ unitTests: state.unitTests.filter((_, idx) => idx !== i) })
  }

  const chip = !state.pattern
    ? { text: 'enter a pattern', tone: 'muted' }
    : patternError
      ? { text: 'invalid pattern', tone: 'danger' }
      : { text: `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`, tone: matches.length ? 'success' : 'warning' }

  const chipColors = {
    muted:   { color: 'var(--text-subtle)', background: 'var(--surface-2)' },
    danger:  { color: 'var(--danger)', background: 'var(--danger-soft)' },
    success: { color: 'var(--success)', background: 'var(--success-soft)' },
    warning: { color: 'var(--warning)', background: 'var(--warning-soft)' },
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, padding: 16, boxSizing: 'border-box' }}>
      <style>{`
        .rt-btn { display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border:1px solid var(--border); border-radius:var(--radius-sm); background:transparent; color:var(--text-muted); cursor:pointer; font-size:11.5px; }
        .rt-btn:hover:not(:disabled) { background:var(--surface-2); color:var(--text); }
        .rt-btn:disabled { opacity:.35; cursor:default; }
        .rt-btn.on { background:var(--accent-soft); border-color:var(--accent-border); color:var(--accent); }
        .rt-tab { font-size:10.5px; font-weight:600; padding:7px 13px; background:none; border:none; border-bottom:2px solid transparent; color:var(--text-muted); text-transform:uppercase; letter-spacing:.6px; cursor:pointer; }
        .rt-tab:hover { color:var(--text); }
        .rt-tab.on { color:var(--accent); border-bottom-color:var(--accent); }
        mark.rt-m { background: var(--warning-soft); border-bottom:2px solid var(--warning); border-radius:2px; color:inherit; padding:0; }
        mark.rt-m.sel { filter: brightness(1.3); }
      `}</style>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 600 }}>/<em style={{ fontStyle: 'normal', color: 'var(--accent)' }}>{state.pattern || '…'}</em>/</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 9px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', ...chipColors[chip.tone] }}>{chip.text}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 2 }}>
          <button className="rt-btn" disabled={matches.length < 2} onClick={() => navMatch(-1)} title="Previous">‹</button>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, minWidth: 34, textAlign: 'center', color: 'var(--text-subtle)' }}>
            {matches.length ? (selIdx < 0 ? `${matches.length}` : `${selIdx + 1}/${matches.length}`) : '—'}
          </span>
          <button className="rt-btn" disabled={matches.length < 2} onClick={() => navMatch(1)} title="Next">›</button>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 2 }}>
          <button className={`rt-btn${state.mode === 'match' ? ' on' : ''}`} onClick={() => patch({ mode: 'match' })}>Match</button>
          <button className={`rt-btn${state.mode === 'sub' ? ' on' : ''}`} onClick={() => patch({ mode: 'sub' })}>Substitution</button>
        </div>
        <button className="rt-btn" onClick={newDoc}><Icon name="plus" size={12}/> New</button>
        <button className="rt-btn" onClick={() => setShowDocsModal(true)}>
          <Icon name="doc" size={12}/> Documents{docs.length > 0 ? ` (${docs.length})` : ''}
        </button>
      </div>

      {/* Expression panel */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 10, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 13px', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.7px', color: 'var(--text-subtle)' }}>
          <span>Expression</span>
          <div style={{ display: 'flex', gap: 3 }}>
            {FLAG_INFO.map(([f, tip]) => (
              <button key={f} className={`rt-btn${state.flags[f] ? ' on' : ''}`} title={tip} onClick={() => toggleFlag(f)} style={{ padding: '2px 7px', fontFamily: 'var(--mono)' }}>{f}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 13px', gap: 7 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 18, color: 'var(--text-subtle)' }}>/</span>
          <input
            value={state.pattern} onChange={e => patch({ pattern: e.target.value })}
            placeholder="Enter pattern…" spellCheck={false}
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--text)' }}
          />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 18, color: 'var(--text-subtle)' }}>/</span>
        </div>
        {patternError && (
          <div style={{ padding: '6px 13px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--danger)', background: 'var(--danger-soft)', borderTop: '1px solid var(--border)' }}>{patternError}</div>
        )}
      </div>

      {/* Test string panel */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 10, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 8px', borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
          {state.testCases.map((tc, i) => (
            <button key={i} className={`rt-btn${i === state.tcIndex ? ' on' : ''}`} onClick={() => switchTestCase(i)}>{tc.name}</button>
          ))}
          <button className="rt-btn" onClick={addTestCase} title="New test case" style={{ marginLeft: 4 }}><Icon name="plus" size={12}/></button>
        </div>
        <div style={{ position: 'relative', height: 190 }}>
          <div aria-hidden="true" ref={overlayRef} style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', fontFamily: 'var(--mono)', fontSize: 13, lineHeight: 1.75,
            padding: '10px 13px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden',
          }}>
            {overlaySegments.map((seg, i) => seg.matchIndex === null
              ? <React.Fragment key={i}>{seg.text}</React.Fragment>
              : (
                <mark key={i} className={`rt-m${seg.matchIndex === selIdx ? ' sel' : ''}`}>
                  {splitMatchByGroups(seg.text, seg.groupSpans).map((piece, pi) => piece.colorIndex === null
                    ? <React.Fragment key={pi}>{piece.text}</React.Fragment>
                    : <span key={pi} style={{ borderBottom: `2px solid ${GROUP_COLORS[piece.colorIndex]}`, background: `${GROUP_COLORS[piece.colorIndex]}18` }}>{piece.text}</span>
                  )}
                </mark>
              )
            )}
          </div>
          <textarea
            value={testStr} onChange={e => setTestContent(e.target.value)}
            onScroll={e => {
              if (overlayRef.current) {
                overlayRef.current.scrollTop = e.target.scrollTop
                overlayRef.current.scrollLeft = e.target.scrollLeft
              }
            }}
            placeholder="Enter test string…" spellCheck={false}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%', background: 'transparent', border: 'none', outline: 'none',
              resize: 'none', fontFamily: 'var(--mono)', fontSize: 13, lineHeight: 1.75, padding: '10px 13px', color: 'transparent', caretColor: 'var(--text)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowY: 'auto', boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 13px', borderTop: '1px solid var(--border)', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-subtle)' }}>
          <span>{testStr.length} chars</span>
          <span>{matches.length ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}` : (state.pattern ? 'no matches' : '–')}</span>
        </div>
      </div>

      {/* Substitution panel */}
      {state.mode === 'sub' && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 10, overflow: 'hidden' }}>
          <div style={{ padding: '6px 13px', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.7px', color: 'var(--text-subtle)' }}>Substitution</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 13px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.7px', color: 'var(--text-subtle)', fontWeight: 600, whiteSpace: 'nowrap' }}>Replace with</span>
            <input
              value={state.subReplacement} onChange={e => patch({ subReplacement: e.target.value })}
              placeholder="$1, $2, $& …" spellCheck={false}
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--success)' }}
            />
          </div>
          <div style={{ padding: '8px 13px', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', lineHeight: 1.7, minHeight: 42 }}>
            {subResult === null
              ? <span style={{ color: 'var(--text-subtle)' }}>Result will appear here</span>
              : subResult === 'INVALID' ? 'Invalid substitution pattern' : (subResult || '(empty string)')}
          </div>
        </div>
      )}

      {/* Bottom grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {/* Match info */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          <div style={{ padding: '6px 13px', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.7px', color: 'var(--text-subtle)' }}>Match information</div>
          <div style={{ padding: 11, maxHeight: 340, overflowY: 'auto' }}>
            {!matches.length ? (
              <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-subtle)', fontSize: 12, lineHeight: 1.7 }}>
                {state.pattern ? 'No matches found' : 'Enter a pattern and test string to see matches'}
              </div>
            ) : matches.map((m, i) => {
              const end = m.index + m.value.length
              const namedKeys = Object.keys(m.named || {})
              return (
                <div key={i} onClick={() => selectMatch(i)} style={{
                  border: `1px solid ${i === selIdx ? 'var(--warning)' : 'var(--border)'}`, borderRadius: 'var(--radius-sm)', overflow: 'hidden',
                  cursor: 'pointer', background: 'var(--bg)', marginBottom: 6,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 9px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--warning-soft)', border: '1px solid var(--warning)', color: 'var(--warning)' }}>Match {i + 1}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-subtle)' }}>{m.index}–{end} · len {m.value.length}</span>
                  </div>
                  <div style={{ padding: '5px 9px', fontFamily: 'var(--mono)', fontSize: 12, wordBreak: 'break-all', color: 'var(--text)', borderBottom: m.groups.length ? '1px solid var(--border)' : 'none' }}>
                    {m.value ? m.value : <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>empty match</span>}
                  </div>
                  {m.groups.map((g, gi) => (
                    <div key={gi} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '4px 9px', borderBottom: gi === m.groups.length - 1 ? 'none' : '1px solid var(--border)' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '1px 5px', borderRadius: 'var(--radius-sm)', flexShrink: 0, marginTop: 1, color: GROUP_COLORS[gi % 6], border: `1px solid ${GROUP_COLORS[gi % 6]}50`, background: `${GROUP_COLORS[gi % 6]}10` }}>
                        {namedKeys[gi] ? `?<${namedKeys[gi]}>` : `Group ${gi + 1}`}
                      </span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: g == null ? 'var(--text-subtle)' : 'var(--text)', fontStyle: g == null ? 'italic' : 'normal', wordBreak: 'break-all' }}>
                        {g != null ? g : 'undefined'}
                      </span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>

        {/* Tabbed panel */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
            <button className={`rt-tab${bottomTab === 'code' ? ' on' : ''}`} onClick={() => setBottomTab('code')}>Code gen</button>
            <button className={`rt-tab${bottomTab === 'tests' ? ' on' : ''}`} onClick={() => setBottomTab('tests')}>Unit tests</button>
            <button className={`rt-tab${bottomTab === 'ref' ? ' on' : ''}`} onClick={() => setBottomTab('ref')}>Reference</button>
          </div>

          {bottomTab === 'code' && (
            <div style={{ padding: 11, maxHeight: 340, overflowY: 'auto' }}>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 9 }}>
                {LANGS.map(l => (
                  <button key={l} className={`rt-btn${codeLang === l ? ' on' : ''}`} onClick={() => setCodeLang(l)}>{l}</button>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 5 }}>
                <button className="rt-btn" onClick={() => navigator.clipboard.writeText(state.pattern ? genCode(codeLang, state.pattern, flagsStr) : '')}>
                  <Icon name="copy" size={12}/> Copy
                </button>
              </div>
              <pre style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 11, fontFamily: 'var(--mono)', fontSize: 11.5, lineHeight: 1.7, color: 'var(--text)', whiteSpace: 'pre', overflowX: 'auto', margin: 0 }}>
                {state.pattern ? genCode(codeLang, state.pattern, flagsStr) : '// Enter a pattern to generate code'}
              </pre>
            </div>
          )}

          {bottomTab === 'tests' && (
            <UnitTestsPanel tests={unitTestResults} onAdd={addUnitTest} onDelete={deleteUnitTest} />
          )}

          {bottomTab === 'ref' && (
            <ReferencePanel filter={refFilter} onFilterChange={setRefFilter} onInsert={insertToken} />
          )}
        </div>
      </div>

      {showDocsModal && (
        <DocumentsModal
          docs={docs}
          currentDocId={currentDocId}
          hasUnsavedContent={hasUnsavedContent}
          onOpen={id => { openDoc(id); setShowDocsModal(false) }}
          onNew={() => { newDoc(); setShowDocsModal(false) }}
          onDelete={deleteDoc}
          onRename={renameDoc}
          onClose={() => setShowDocsModal(false)}
          renderPreview={doc => {
            const activeCase = doc.content.testCases?.[doc.content.tcIndex]
            const firstLine = (activeCase?.content || '').split('\n')[0]
            return (
              <div style={{ padding: '14px 12px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--accent)', wordBreak: 'break-all' }}>
                  {doc.content.pattern
                    ? `/${doc.content.pattern}/${flagsToString(doc.content.flags)}`
                    : <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>Empty pattern</span>}
                </div>
                {firstLine && (
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {firstLine}
                  </div>
                )}
              </div>
            )
          }}
          metaText={doc => relativeTime(doc.updatedAt)}
        />
      )}
    </div>
  )
}

function UnitTestsPanel({ tests, onAdd, onDelete }) {
  const [str, setStr] = useState('')
  const [expect, setExpect] = useState('1')

  function submit() {
    onAdd(str, expect === '1')
    setStr('')
  }

  const passing = tests.filter(t => t.result === 'pass').length
  const failing = tests.filter(t => t.result === 'fail').length

  return (
    <div style={{ padding: 11, maxHeight: 340, overflowY: 'auto' }}>
      <div style={{ display: 'flex', gap: 5, marginBottom: 9, alignItems: 'center' }}>
        <input
          value={str} onChange={e => setStr(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          placeholder="Test string…"
          style={{ flex: 1, fontFamily: 'var(--mono)', padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, outline: 'none' }}
        />
        <select value={expect} onChange={e => setExpect(e.target.value)} style={{ fontSize: 11, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'var(--text)' }}>
          <option value="1">should match</option>
          <option value="0">no match</option>
        </select>
        <button className="rt-btn" onClick={submit}>Add</button>
      </div>
      {tests.length === 0 ? (
        <div style={{ padding: '14px 0', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 12 }}>No tests yet. Add strings above.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 7, marginBottom: 9, fontSize: 11, color: 'var(--text-muted)' }}>
            <b style={{ color: 'var(--text)' }}>{passing}/{tests.length}</b> passing · <b style={{ color: 'var(--text)' }}>{failing}</b> failing
          </div>
          {tests.map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 9px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: 5, fontFamily: 'var(--mono)', fontSize: 11.5, background: 'var(--bg)' }}>
              <span style={{
                width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, flexShrink: 0, fontWeight: 700,
                color: t.result === 'pass' ? 'var(--success)' : t.result === 'fail' ? 'var(--danger)' : 'var(--text-subtle)',
                background: t.result === 'pass' ? 'var(--success-soft)' : t.result === 'fail' ? 'var(--danger-soft)' : 'var(--surface-2)',
                border: `1px solid ${t.result === 'pass' ? 'var(--success)' : t.result === 'fail' ? 'var(--danger)' : 'var(--border)'}`,
              }}>{t.result === 'pass' ? '✓' : t.result === 'fail' ? '✗' : '?'}</span>
              <span style={{ flex: 1, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.str}</span>
              <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 'var(--radius-sm)', color: 'var(--text-subtle)', border: '1px solid var(--border)', background: 'var(--surface-2)', whiteSpace: 'nowrap' }}>{t.expectMatch ? 'should match' : 'no match'}</span>
              <button onClick={() => onDelete(i)} style={{ fontSize: 15, background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>×</button>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function ReferencePanel({ filter, onFilterChange, onInsert }) {
  const q = filter.trim().toLowerCase()
  const groups = q
    ? REFERENCE_DATA.map(g => ({ ...g, i: g.i.filter(it => it.k.toLowerCase().includes(q) || it.d.toLowerCase().includes(q)) })).filter(g => g.i.length)
    : REFERENCE_DATA

  return (
    <div style={{ padding: 11, maxHeight: 340, overflowY: 'auto' }}>
      <input
        value={filter} onChange={e => onFilterChange(e.target.value)}
        placeholder="Filter…"
        style={{ width: '100%', marginBottom: 9, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
      />
      {groups.map(g => (
        <div key={g.t} style={{ marginBottom: 13 }}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--text-subtle)', marginBottom: 4, padding: '0 2px' }}>{g.t}</div>
          {g.i.map(it => (
            <div key={it.k} onClick={() => onInsert(it.k)} style={{ display: 'flex', gap: 7, padding: '3px 5px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', alignItems: 'flex-start' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent)', minWidth: 72, flexShrink: 0 }}>{it.k}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>{it.d}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
