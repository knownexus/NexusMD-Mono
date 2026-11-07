import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, within } from '@testing-library/react'
import React from 'react'
import { TestText } from '../src/views/regex-tester/test-text.jsx'
import { findMatches } from '../src/views/regex-tester-helpers.js'
import { replaceSegments } from '../src/views/regex-syntax.js'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const FLAGS = { g: true, i: false, m: false, s: false, u: false }
const CASES = [{ name: 'Email', content: 'a1 b22\nc333' }, { name: 'URL', content: 'x' }]
const state = (over = {}) => ({ pattern: '\\d+', flags: FLAGS, mode: 'match', subReplacement: '', testCases: CASES, tcIndex: 0, ...over })
const show = (over = {}, stateOver = {}) => {
  const st = state(stateOver)
  const flags = Object.keys(st.flags).filter(f => st.flags[f]).join('')
  const matches = over.matches ?? (st.pattern ? findMatches(st.pattern, flags, st.testCases[st.tcIndex].content) ?? [] : [])
  const p = {
    state: st, matches, selIdx: -1, onSelectMatch: vi.fn(), error: null, resultSegments: null,
    onCase: vi.fn(), onAddCase: vi.fn(), onText: vi.fn(), ...over,
  }
  const r = render(<TestText {...p} />)
  return { ...p, ...r, area: r.container.querySelector('textarea') }
}
const marks = r => [...r.container.querySelectorAll('.nx-rt-overlay mark')]

describe('TestText case tabs', () => {
  it('is an underline tab per case, the current one selected, and a + that adds one', () => {
    const p = show()
    expect(p.getByRole('tab', { name: 'Email' }).getAttribute('aria-selected')).toBe('true')
    expect(p.getByRole('tab', { name: 'URL' }).getAttribute('aria-selected')).toBe('false')
    fireEvent.click(p.getByRole('tab', { name: 'URL' }))
    expect(p.onCase).toHaveBeenCalledWith(1)
    fireEvent.click(p.getByTitle('New test case'))
    expect(p.onAddCase).toHaveBeenCalledTimes(1)
  })

  it('names the capture groups of the pattern in a legend on the right', () => {
    const p = show({}, { pattern: '(a)(\\d)' })
    expect(p.container.querySelectorAll('.nx-rt-legend-item')).toHaveLength(2)
    expect(p.getByText('Group 1')).toBeTruthy()
    expect(p.getByText('Group 2')).toBeTruthy()
  })

  it('has no legend for a pattern without groups', () => {
    expect(show().container.querySelector('.nx-rt-legend-item')).toBeNull()
  })
})

describe('TestText editor', () => {
  it('numbers each line in a gutter', () => {
    const p = show()
    expect([...p.container.querySelectorAll('.nx-rt-gutter span')].map(s => s.textContent)).toEqual(['1', '2'])
  })

  it('types into the case through onText', () => {
    const p = show()
    fireEvent.change(p.area, { target: { value: 'new text' } })
    expect(p.onText).toHaveBeenCalledWith('new text')
  })

  it('highlights each match, and the selected one more strongly', () => {
    const p = show({ selIdx: 1 })
    expect(marks(p).map(m => m.textContent)).toEqual(['1', '22', '333'])
    expect(marks(p).map(m => m.classList.contains('sel'))).toEqual([false, true, false])
  })

  it('underlines a match outside any group in the warning colour, and a group in its own colour', () => {
    const p = show({}, { pattern: '(\\d)' })
    const inner = marks(p)[0].querySelector('span')
    expect(inner.style.borderBottom).toContain('2px solid')
    const plain = show()
    expect(marks(plain)[0].querySelector('span')).toBeNull()
  })

  it('shows plain text, no highlights, for an invalid pattern', () => {
    const p = show({ error: 'Invalid regular expression: /(/: Unterminated group' }, { pattern: '(' })
    expect(marks(p)).toHaveLength(0)
    expect(p.container.querySelector('.nx-rt-overlay').textContent).toBe('a1 b22\nc333')
  })

  it('draws no empty highlight for a pattern that matches the empty string, and does not hang', () => {
    const p = show({}, { pattern: 'a*' }, )
    expect(marks(p).every(m => m.textContent !== '')).toBe(true)
    expect(p.container.querySelector('.nx-rt-overlay').textContent).toBe('a1 b22\nc333')
  })

  it('selects the match under the caret when a highlight is clicked, and nothing when the click is outside every match', () => {
    const p = show()
    p.area.setSelectionRange(5, 5)
    fireEvent.click(p.area)
    expect(p.onSelectMatch).toHaveBeenLastCalledWith(1)
    p.area.setSelectionRange(2, 2)
    fireEvent.click(p.area)
    expect(p.onSelectMatch).toHaveBeenCalledTimes(1)
  })

  it('keeps the overlay and the gutter scrolled with the text', () => {
    const p = show()
    fireEvent.scroll(p.area, { target: { scrollTop: 42, scrollLeft: 7 } })
    expect(p.area.previousElementSibling.scrollTop).toBe(42)
    expect(p.area.previousElementSibling.scrollLeft).toBe(7)
    expect(p.container.querySelector('.nx-rt-gutter').scrollTop).toBe(42)
  })
})

describe('TestText footer', () => {
  it('counts the characters and says where the caret is', () => {
    const p = show()
    expect(p.getByText(/^11 chars/)).toBeTruthy()
    p.area.setSelectionRange(9, 9)
    fireEvent.select(p.area)
    expect(p.getByText('11 chars · Ln 2, Col 3')).toBeTruthy()
  })

  it('has the click and Ctrl hint on the right', () => {
    expect(show().getByText('Click a match to select it · Ctrl ↑/↓ to step')).toBeTruthy()
  })
})

describe('TestText replace mode', () => {
  const rep = (replacement = '#') => {
    const re = /\d+/g
    return { resultSegments: replaceSegments('a1 b22\nc333', re, replacement) }
  }

  it('splits into the text and a RESULT with the replaced spans marked', () => {
    const p = show(rep(), { mode: 'sub', subReplacement: '#' })
    const result = p.container.querySelector('.nx-rt-result')
    expect(within(result).getByText('Result').className).toContain('nx-rt-eyebrow')
    expect(result.querySelector('.nx-rt-result-text').textContent).toBe('a# b#\nc#')
    expect([...result.querySelectorAll('.nx-rt-replaced')].map(e => e.textContent)).toEqual(['#', '#', '#'])
  })

  it('copies the result', () => {
    const write = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
    const p = show(rep(), { mode: 'sub', subReplacement: '#' })
    fireEvent.click(p.getByRole('button', { name: 'Copy' }))
    expect(write).toHaveBeenCalledWith('a# b#\nc#')
  })

  it('shows how the text changes in the footer', () => {
    const p = show(rep('<<<>>>'), { mode: 'sub', subReplacement: '<<<>>>' })
    expect(p.getByText('11 chars → 23 chars')).toBeTruthy()
  })

  it('asks for a valid pattern when there is no result, and has no highlights in the input', () => {
    const p = show({ resultSegments: null, error: 'bad', matches: [] }, { mode: 'sub', pattern: '(' })
    expect(p.getByText('Fix the pattern to see the result.')).toBeTruthy()
  })

  it('is not there in Match mode', () => {
    expect(show().container.querySelector('.nx-rt-result')).toBeNull()
  })
})
