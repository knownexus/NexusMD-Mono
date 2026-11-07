import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, within } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider } from '../src/index.js'
import { RegexRail } from '../src/views/regex-tester/rail.jsx'
import { findMatches, runUnitTests } from '../src/views/regex-tester-helpers.js'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function memStorage() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
const match = (index, value, groups = [], named = {}) => ({ index, value, groups, indices: null, named })
const UNIT = [{ str: 'a1', expectMatch: true }, { str: 'zz', expectMatch: false }, { str: 'b2', expectMatch: false }]

function show(over = {}, storage = memStorage()) {
  const pattern = over.pattern ?? '\\d+'
  const flagsStr = over.flagsStr ?? 'g'
  const p = {
    pattern, flagsStr, mode: 'match', replacement: '', error: null,
    matches: over.matches ?? findMatches(pattern, flagsStr, 'a1 b22 c333') ?? [], selIdx: -1, onSelect: vi.fn(),
    tests: runUnitTests(UNIT, pattern, flagsStr), onAddTest: vi.fn(), onDeleteTest: vi.fn(), onInsert: vi.fn(), ...over,
  }
  const tree = props => (
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {} }}><RegexRail {...props} /></NexusDataProvider>
  )
  const r = render(tree(p))
  return { ...p, ...r, storage, again: next => render(tree({ ...p, ...next })) }
}
const tab = (p, name) => p.getByRole('tab', { name })

describe('RegexRail tabs', () => {
  it('has Matches N, Code, Tests passing/total and Reference, Matches first', () => {
    const p = show()
    expect(tab(p, 'Matches 3').getAttribute('aria-selected')).toBe('true')
    expect(tab(p, 'Code')).toBeTruthy()
    expect(tab(p, 'Tests 2/3')).toBeTruthy()
    expect(tab(p, 'Reference')).toBeTruthy()
  })

  it('switches tabs', () => {
    const p = show()
    fireEvent.click(tab(p, 'Reference'))
    expect(tab(p, 'Reference').getAttribute('aria-selected')).toBe('true')
    expect(p.getByPlaceholderText('Filter…')).toBeTruthy()
  })

  it('hides to a strip whose label says what is under it, and shows again from the strip', () => {
    const p = show()
    fireEvent.click(p.getByRole('button', { name: 'Hide panel' }))
    expect(p.queryByRole('tab', { name: 'Code' })).toBeNull()
    fireEvent.click(p.getByRole('button', { name: 'Show Matches · 3' }))
    expect(tab(p, 'Code')).toBeTruthy()
  })

  it('labels the strip Code · <language> and Tests · N pending', () => {
    const p = show()
    fireEvent.click(tab(p, 'Code'))
    fireEvent.change(p.getByLabelText('Language'), { target: { value: 'Python' } })
    fireEvent.click(p.getByRole('button', { name: 'Hide panel' }))
    expect(p.getByRole('button', { name: 'Show Code · Python' })).toBeTruthy()
    cleanup()
    const q = show({ pattern: '(', error: 'bad', matches: [], tests: runUnitTests(UNIT, '(', 'g') })
    fireEvent.click(tab(q, /^Tests/))
    fireEvent.click(q.getByRole('button', { name: 'Hide panel' }))
    expect(q.getByRole('button', { name: 'Show Tests · 3 pending' })).toBeTruthy()
  })

  it('remembers whether it is open and which tab, across a remount', () => {
    const storage = memStorage()
    const p = show({}, storage)
    fireEvent.click(tab(p, 'Reference'))
    fireEvent.click(p.getByRole('button', { name: 'Hide panel' }))
    cleanup()
    const q = show({}, storage)
    expect(q.queryByRole('tab', { name: 'Reference' })).toBeNull()
    fireEvent.click(q.getByRole('button', { name: /^Show Reference/ }))
    expect(tab(q, 'Reference').getAttribute('aria-selected')).toBe('true')
  })

  it('falls back to Matches when the remembered tab is unknown', () => {
    const storage = memStorage()
    storage.setItem('regex_tester_rail', JSON.stringify({ open: true, tab: 'gone' }))
    const p = show({}, storage)
    expect(tab(p, 'Matches 3').getAttribute('aria-selected')).toBe('true')
  })
})

describe('Matches panel', () => {
  it('has a card per match: its number, value, position and length', () => {
    const p = show()
    const cards = p.container.querySelectorAll('.nx-rt-match')
    expect(cards).toHaveLength(3)
    expect(within(cards[1]).getByText('2').className).toContain('nx-rt-badge')
    expect(within(cards[1]).getByText('22')).toBeTruthy()
    expect(within(cards[1]).getByText('4–6 · len 2')).toBeTruthy()
  })

  it('lists a match\'s groups beneath it, named ones as ?<name> and a group that did not take part as undefined', () => {
    const p = show({ matches: [match(0, 'ab', ['a', undefined], { y: 'a' })] })
    const card = p.container.querySelector('.nx-rt-match')
    const rows = [...card.querySelectorAll('.nx-rt-group')].map(r => r.textContent)
    expect(rows).toEqual(['?<y>a', 'Group 2undefined'])
    expect(card.querySelectorAll('.nx-rt-group .nx-rt-swatch-sq')).toHaveLength(2)
  })

  it('says empty match for a match of nothing', () => {
    const p = show({ matches: [match(3, '')] })
    expect(p.getByText('empty match')).toBeTruthy()
  })

  it('marks the selected card and selects on click', () => {
    const p = show({ selIdx: 2 })
    const cards = p.container.querySelectorAll('.nx-rt-match')
    expect(cards[2].getAttribute('data-selected')).toBe('true')
    expect(cards[0].getAttribute('data-selected')).toBeNull()
    fireEvent.click(cards[0])
    expect(p.onSelect).toHaveBeenCalledWith(0)
  })

  it('says what is missing: a pattern, or a match', () => {
    expect(show({ pattern: '', matches: [] }).getByText('Enter a pattern and test text to see matches')).toBeTruthy()
    cleanup()
    expect(show({ pattern: 'zzz', matches: [] }).getByText('No matches found')).toBeTruthy()
  })
})

describe('Code panel', () => {
  const open = p => fireEvent.click(tab(p, 'Code'))

  it('has a language dropdown of the seven languages and a JS snippet to begin with', () => {
    const p = show()
    open(p)
    const options = [...p.getByLabelText('Language').querySelectorAll('option')].map(o => o.textContent)
    expect(options).toEqual(['JS', 'Python', 'PHP', 'Go', 'Java', 'C#', 'Ruby'])
    expect(p.container.querySelector('.nx-rt-code').textContent).toContain('matchAll')
  })

  it('changes the snippet with the language', () => {
    const p = show()
    open(p)
    fireEvent.change(p.getByLabelText('Language'), { target: { value: 'Python' } })
    expect(p.container.querySelector('.nx-rt-code').textContent).toContain('import re')
  })

  it('uses the replacement in the replace line in Replace mode, and the stock one in Match mode', () => {
    const p = show({ mode: 'sub', replacement: '[$2]' })
    open(p)
    expect(p.container.querySelector('.nx-rt-code').textContent).toContain("str.replace(regex, '[$2]')")
    cleanup()
    const q = show({ mode: 'match', replacement: '[$2]' })
    open(q)
    expect(q.container.querySelector('.nx-rt-code').textContent).toContain("str.replace(regex, '$1')")
  })

  it('colours keywords, strings and comments', () => {
    const p = show()
    open(p)
    const code = p.container.querySelector('.nx-rt-code')
    expect(code.querySelector('[data-tok="keyword"]').textContent).toBe('const')
    expect([...code.querySelectorAll('[data-tok="comment"]')].some(e => e.textContent.startsWith('// Test'))).toBe(true)
    expect(code.querySelector('[data-tok="string"]')).toBeTruthy()
  })

  it('copies the code', () => {
    const write = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
    const p = show()
    open(p)
    fireEvent.click(p.getByRole('button', { name: 'Copy' }))
    expect(write.mock.calls[0][0]).toContain('const regex = /\\d+/g;')
  })

  it('asks for a pattern when there is none', () => {
    const p = show({ pattern: '', matches: [] })
    open(p)
    expect(p.container.querySelector('.nx-rt-code').textContent).toBe('// Enter a pattern to generate code')
  })
})

describe('Tests panel', () => {
  const open = p => fireEvent.click(tab(p, /^Tests/))

  it('says how many pass, with a row per test and its expectation', () => {
    const p = show()
    open(p)
    expect(p.getByText('2/3 passing')).toBeTruthy()
    const rows = p.container.querySelectorAll('.nx-rt-test-row')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByText('a1')).toBeTruthy()
    expect(within(rows[0]).getByText('should match')).toBeTruthy()
    expect(within(rows[1]).getByText('no match')).toBeTruthy()
    expect([...rows].map(r => r.querySelector('.nx-rt-dot').getAttribute('data-result'))).toEqual(['pass', 'pass', 'fail'])
  })

  it('says the tests are pending, and that they run again once the pattern compiles', () => {
    const p = show({ pattern: '(', error: 'bad', matches: [], tests: runUnitTests(UNIT, '(', 'g') })
    open(p)
    expect(p.getByText('3 tests pending')).toBeTruthy()
    expect(p.getByText('They run again as soon as the pattern compiles.')).toBeTruthy()
    expect([...p.container.querySelectorAll('.nx-rt-dot')].map(d => d.textContent)).toEqual(['?', '?', '?'])
  })

  it('adds a test on Enter, as should-match by default, and as no match when chosen', () => {
    const p = show()
    open(p)
    const box = p.getByPlaceholderText('Test string…')
    fireEvent.change(box, { target: { value: 'x9' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(p.onAddTest).toHaveBeenLastCalledWith('x9', true)
    expect(box.value).toBe('')
    fireEvent.click(p.getByRole('tab', { name: 'No match' }))
    fireEvent.change(box, { target: { value: 'yy' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(p.onAddTest).toHaveBeenLastCalledWith('yy', false)
  })

  it('adds nothing for a blank string', () => {
    const p = show()
    open(p)
    fireEvent.keyDown(p.getByPlaceholderText('Test string…'), { key: 'Enter' })
    expect(p.onAddTest).not.toHaveBeenCalled()
  })

  it('deletes a test', () => {
    const p = show()
    open(p)
    fireEvent.click(p.getAllByRole('button', { name: 'Delete test' })[1])
    expect(p.onDeleteTest).toHaveBeenCalledWith(1)
  })

  it('says there are none yet', () => {
    const p = show({ tests: [] })
    open(p)
    expect(p.getByText('No tests yet. Add a string below.')).toBeTruthy()
  })
})

describe('Reference panel', () => {
  const open = p => fireEvent.click(tab(p, 'Reference'))

  it('lists the reference with a filter, and narrows to what matches', () => {
    const p = show()
    open(p)
    expect(p.getByText('Anchors')).toBeTruthy()
    fireEvent.change(p.getByPlaceholderText('Filter…'), { target: { value: 'lookbehind' } })
    expect(p.getByText('Lookarounds')).toBeTruthy()
    expect(p.queryByText('Anchors')).toBeNull()
  })

  it('hands a clicked token to onInsert', () => {
    const p = show()
    open(p)
    fireEvent.click(p.getByText('\\d'))
    expect(p.onInsert).toHaveBeenCalledWith('\\d')
  })
})
