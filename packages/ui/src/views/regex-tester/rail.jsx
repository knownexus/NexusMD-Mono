import React from 'react'
import { CollapsibleRail } from '../../collapsible-rail.jsx'
import { usePersisted } from '../../app-components.jsx'
import { MatchesPanel, CodePanel, TestsPanel, ReferencePanel } from './panels.jsx'

export const RAIL_WIDTH = 360
const TABS = ['matches', 'code', 'tests', 'reference']
const STORAGE_KEY = 'regex_tester_rail'

/** Whether the right-hand panel is open and which tab shows, remembered. The page reads `open` to size its column. */
export function useRegexRail() {
  const [saved, setSaved] = usePersisted(STORAGE_KEY, { open: true, tab: 'matches' })
  const open = saved?.open !== false
  const tab = TABS.includes(saved?.tab) ? saved.tab : 'matches'
  const setOpen = value => setSaved(prev => ({ ...prev, tab, open: typeof value === 'function' ? value(open) : value }))
  const setTab = next => setSaved(prev => ({ ...prev, open, tab: next }))
  return { open, tab, setOpen, setTab }
}

/**
 * The Regex Tester's right-hand panel: Matches N | Code | Tests passing/total | Reference. It collapses to a
 * strip labelled with what is under it ("Matches · 3", "Code · Python", "Tests · 3 pending").
 * `tests` are runUnitTests' results; `onInsert(token)` puts a reference token in the pattern.
 */
export function RegexRail({ rail: given = null, pattern, flagsStr, mode, replacement, error, matches, selIdx, onSelect, tests, onAddTest, onDeleteTest, onInsert }) {
  const own = useRegexRail()
  const rail = given ?? own
  const [lang, setLang] = React.useState('JS')
  const passing = tests.filter(t => t.result === 'pass').length
  const pending = tests.filter(t => t.result === 'pending').length
  const labels = {
    matches: `Matches · ${matches.length}`,
    code: `Code · ${lang}`,
    tests: pending ? `Tests · ${pending} pending` : `Tests · ${passing}/${tests.length}`,
    reference: 'Reference',
  }
  const head = [
    ['matches', 'Matches', matches.length], ['code', 'Code', null], ['tests', 'Tests', `${passing}/${tests.length}`], ['reference', 'Reference', null],
  ]
  return (
    <CollapsibleRail open={rail.open} onToggle={() => rail.setOpen(o => !o)} label={labels[rail.tab]}>
      <div role="tablist" aria-label="Regex tools" className="nx-rt-rail-tabs">
        {head.map(([id, label, n]) => (
          <button key={id} type="button" role="tab" aria-selected={rail.tab === id} className="nx-rt-rail-tab" onClick={() => rail.setTab(id)}>
            {label}{n != null && n !== 0 && <>{' '}<span className="n">{n}</span></>}
          </button>
        ))}
      </div>
      {rail.tab === 'matches' && <MatchesPanel matches={matches} selIdx={selIdx} onSelect={onSelect} hasPattern={!!pattern && !error} />}
      {rail.tab === 'code' && <CodePanel lang={lang} onLang={setLang} pattern={pattern} flagsStr={flagsStr} replacement={replacement} mode={mode} />}
      {rail.tab === 'tests' && <TestsPanel tests={tests} onAdd={onAddTest} onDelete={onDeleteTest} />}
      {rail.tab === 'reference' && <ReferencePanel onInsert={onInsert} />}
    </CollapsibleRail>
  )
}
