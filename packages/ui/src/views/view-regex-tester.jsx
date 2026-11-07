// view-regex-tester.jsx — full React port of docs/regex-tester.html, minus
// the AI "Explain this pattern" tab (no working backend for it) and the
// contentEditable pattern input (replaced with a plain <input> — see the
// design spec for why). Styled with the app's theme tokens.
import React from 'react'
import { findMatches, runUnitTests } from './regex-tester-helpers.js'
import { useDocumentAutosave } from './document-store.js'
import { useDocumentsBarSave } from './documents-bar.jsx'
import { stepIndex, replaceSegments, insertAt } from './regex-syntax.js'
import { flagsToString, regexAutoName } from './regex-tester/constants.js'
import { SavedPatterns } from './regex-tester/saved-patterns.jsx'
import { ExpressionBar } from './regex-tester/expression-bar.jsx'
import { TestText } from './regex-tester/test-text.jsx'
import { RegexRail, useRegexRail, RAIL_WIDTH } from './regex-tester/rail.jsx'
import { railColumns } from '../collapsible-rail.jsx'
import { REGEX_CSS } from './regex-tester/styles.js'

const { useState, useEffect, useMemo, useRef } = React

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
  const rail = useRegexRail()
  // Where the pattern field's caret was last, for Reference tokens (null until the field has been used).
  const caret = useRef(null)

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
  // A Reference token goes where the pattern field's caret is (over its selection), else at the end.
  function insertToken(tok) {
    const at = caret.current ?? { start: state.pattern.length, end: state.pattern.length }
    const next = insertAt(state.pattern, at.start, at.end, tok)
    patch({ pattern: next.text })
    caret.current = { start: next.caret, end: next.caret }
    setTimeout(() => { patternRef.current?.focus(); patternRef.current?.setSelectionRange(next.caret, next.caret) }, 0)
  }
  function addUnitTest(str, expectMatch) {
    if (!str.trim()) return
    patch({ unitTests: [...state.unitTests, { str: str.trim(), expectMatch }] })
  }
  function deleteUnitTest(i) {
    patch({ unitTests: state.unitTests.filter((_, idx) => idx !== i) })
  }

  return (
    <div className="nx-rt-page" onKeyDown={onKeyDown} style={{ gridTemplateColumns: `240px minmax(0, 1fr) ${railColumns(rail.open, RAIL_WIDTH)}` }}>
      <style>{REGEX_CSS}</style>
      <SavedPatterns docs={docs} currentDocId={currentDocId} onOpen={openDoc} onNew={newDoc} onRename={renameDoc} onDuplicate={duplicateDoc} onDelete={deleteDoc} />
      <div className="nx-rt-main">
        <ExpressionBar state={state} patch={patch} matches={matches} selIdx={selIdx} onStep={navMatch} error={patternError} patternRef={patternRef}
          onCaret={(start, end) => { caret.current = { start, end } }} />
        <TestText state={state} matches={matches} selIdx={selIdx} onSelectMatch={selectMatch} error={patternError} resultSegments={resultSegments}
          onCase={switchTestCase} onAddCase={addTestCase} onText={setTestContent} />
      </div>
      <RegexRail rail={rail} pattern={state.pattern} flagsStr={flagsStr} mode={state.mode} replacement={state.subReplacement} error={patternError}
        matches={matches} selIdx={selIdx} onSelect={selectMatch} tests={unitTestResults} onAddTest={addUnitTest} onDeleteTest={deleteUnitTest} onInsert={insertToken} />
    </div>
  )
}
