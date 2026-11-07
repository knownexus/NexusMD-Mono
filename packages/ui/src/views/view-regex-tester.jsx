// view-regex-tester.jsx — full React port of docs/regex-tester.html, minus
// the AI "Explain this pattern" tab (no working backend for it) and the
// contentEditable pattern input (replaced with a plain <input> — see the
// design spec for why). Styled with the app's theme tokens.
import React from 'react'
import { Icon } from '../icons.jsx'
import { findMatches, runUnitTests, genCode, REFERENCE_DATA } from './regex-tester-helpers.js'
import { useDocumentAutosave } from './document-store.js'
import { useDocumentsBarSave } from './documents-bar.jsx'
import { stepIndex, replaceSegments } from './regex-syntax.js'
import { GROUP_COLORS, flagsToString, regexAutoName } from './regex-tester/constants.js'
import { SavedPatterns } from './regex-tester/saved-patterns.jsx'
import { ExpressionBar } from './regex-tester/expression-bar.jsx'
import { TestText } from './regex-tester/test-text.jsx'
import { REGEX_CSS } from './regex-tester/styles.js'

const { useState, useEffect, useMemo, useRef } = React

const LANGS = ['JS', 'Python', 'PHP', 'Go', 'Java', 'C#', 'Ruby']
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

export function RegexTesterView() {
  const {
    content: state, setContent: setState, docs, currentDocId, hasUnsavedContent, saveStatus,
    openDoc, newDoc, deleteDoc, duplicateDoc, renameDoc,
  } = useDocumentAutosave({
    storageKey: DOCS_STORAGE_KEY,
    initialContent: DEFAULT_STATE,
    emptyContent: { ...DEFAULT_STATE, pattern: '' },
    isEmpty: s => !s.pattern,
    extractAutoName: regexAutoName,
  })
  useDocumentsBarSave(saveStatus)
  const patternRef = useRef(null)
  const [selIdx, setSelIdx] = useState(-1)
  const [bottomTab, setBottomTab] = useState('code')
  const [codeLang, setCodeLang] = useState('JS')
  const [refFilter, setRefFilter] = useState('')

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

  // The test text with every match replaced, as untouched and replaced spans (null until the pattern compiles).
  const resultSegments = useMemo(
    () => (state.mode === 'sub' && currentRe ? replaceSegments(testStr, currentRe, state.subReplacement) : null),
    [state.mode, currentRe, testStr, state.subReplacement],
  )

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
    setSelIdx(prev => stepIndex(prev, dir, matches.length))
  }
  // Ctrl+↑ / Ctrl+↓ step through the matches from anywhere in the tool.
  function onKeyDown(e) {
    if (!(e.ctrlKey || e.metaKey) || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || state.mode !== 'match') return
    e.preventDefault()
    navMatch(e.key === 'ArrowDown' ? 1 : -1)
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

  return (
    <div className="nx-rt-page" onKeyDown={onKeyDown}>
      <style>{REGEX_CSS}</style>
      <SavedPatterns docs={docs} currentDocId={currentDocId} onOpen={openDoc} onNew={newDoc} onRename={renameDoc} onDuplicate={duplicateDoc} onDelete={deleteDoc} />
      <div className="nx-rt-main">
        <ExpressionBar state={state} patch={patch} matches={matches} selIdx={selIdx} onStep={navMatch} error={patternError} patternRef={patternRef} />
        <TestText state={state} matches={matches} selIdx={selIdx} onSelectMatch={selectMatch} error={patternError} resultSegments={resultSegments}
          onCase={switchTestCase} onAddCase={addTestCase} onText={setTestContent} />
      </div>
      <div className="nx-rt-rail" style={{ padding: 10 }}>
      {/* Bottom grid */}
      <div className="rx-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
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

      </div>
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
