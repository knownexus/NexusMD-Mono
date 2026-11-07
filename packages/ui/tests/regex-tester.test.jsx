import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, act, within } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, RegexTesterView } from '../src/index.js'

function memStorage() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

function renderRegexTester(storage = memStorage()) {
  return render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {} }}>
      <RegexTesterView/>
    </NexusDataProvider>
  )
}

afterEach(cleanup)

describe('RegexTesterView — matching', () => {
  it('renders the demo pattern and its matches against the default Email test case', () => {
    const { getByDisplayValue, getAllByText } = renderRegexTester()
    expect(getByDisplayValue('(\\w+)@([\\w.-]+\\.[a-z]{2,})')).toBeTruthy()
    expect(getAllByText('3 matches').length).toBeGreaterThan(0)
  })

  it('shows the invalid-pattern state for a broken regex', () => {
    const { getByDisplayValue, getByText } = renderRegexTester()
    fireEvent.change(getByDisplayValue('(\\w+)@([\\w.-]+\\.[a-z]{2,})'), { target: { value: '(unterminated' } })
    expect(getByText('invalid pattern')).toBeTruthy()
  })

  it('toggling the g flag off drops to a single match', () => {
    const { getByDisplayValue, getByTitle, getAllByText } = renderRegexTester()
    fireEvent.change(getByDisplayValue('(\\w+)@([\\w.-]+\\.[a-z]{2,})'), { target: { value: '\\w+' } })
    fireEvent.click(getByTitle('Global — find all matches'))
    expect(getAllByText('1 match').length).toBeGreaterThan(0)
  })

  it('clicking Next from no selection lands on the first match, not the second', () => {
    const { getByTitle, getByText } = renderRegexTester()
    fireEvent.click(getByTitle('Next'))
    expect(getByText('1 / 3')).toBeTruthy()
  })
})

describe('RegexTesterView — test cases', () => {
  it('switches test-string content when a different preset is selected', () => {
    const { getByText, container } = renderRegexTester()
    fireEvent.click(getByText('URL'))
    const textarea = container.querySelector('textarea')
    expect(textarea.value).toContain('https://www.example.com')
  })
})

describe('RegexTesterView — replace mode', () => {
  it('shows a live replace preview', () => {
    const { container, getByRole, getByPlaceholderText } = renderRegexTester()
    fireEvent.click(getByRole('tab', { name: 'Replace' }))
    fireEvent.change(getByPlaceholderText('$1, $2, $& …'), { target: { value: '[EMAIL]' } })
    const result = container.querySelector('.nx-rt-result-text').textContent
    expect(result).toContain('[EMAIL]')
    expect(result).not.toContain('support@example.com')
  })
})

describe('RegexTesterView — right-hand panel', () => {
  const demo = '(\\w+)@([\\w.-]+\\.[a-z]{2,})'

  it('starts on Matches, with a card per match', () => {
    const { getByRole, container } = renderRegexTester()
    expect(getByRole('tab', { name: 'Matches 3' }).getAttribute('aria-selected')).toBe('true')
    expect(container.querySelectorAll('.nx-rt-match')).toHaveLength(3)
  })

  it('Code shows a JS snippet containing the current pattern', () => {
    const { getByRole, container } = renderRegexTester()
    fireEvent.click(getByRole('tab', { name: 'Code' }))
    expect(container.querySelector('.nx-rt-code').textContent).toContain('matchAll')
  })

  it('Code uses the Replace mode\'s replacement in the replace line', () => {
    const { getByRole, getByPlaceholderText, container } = renderRegexTester()
    fireEvent.click(getByRole('tab', { name: 'Replace' }))
    fireEvent.change(getByPlaceholderText('$1, $2, $& …'), { target: { value: '[$2]' } })
    fireEvent.click(getByRole('tab', { name: 'Code' }))
    expect(container.querySelector('.nx-rt-code').textContent).toContain("str.replace(regex, '[$2]')")
  })

  it('Reference puts a token at the end of the pattern when the pattern field has not been used', () => {
    const { getByRole, getByText, getByDisplayValue } = renderRegexTester()
    fireEvent.click(getByRole('tab', { name: 'Reference' }))
    fireEvent.click(getByText('\\d'))
    expect(getByDisplayValue(demo + '\\d')).toBeTruthy()
  })

  it('Reference puts a token where the caret is, not at the end', () => {
    const { getByRole, getByText, getByLabelText } = renderRegexTester()
    const box = getByLabelText('Pattern')
    fireEvent.change(box, { target: { value: 'abcdef' } })
    box.setSelectionRange(3, 3)
    fireEvent.select(box)
    fireEvent.click(getByRole('tab', { name: 'Reference' }))
    fireEvent.click(getByText('\\d'))
    expect(box.value).toBe('abc\\ddef')
  })

  it('Reference replaces a selection with the token', () => {
    const { getByRole, getByText, getByLabelText } = renderRegexTester()
    const box = getByLabelText('Pattern')
    fireEvent.change(box, { target: { value: 'abcdef' } })
    box.setSelectionRange(1, 4)
    fireEvent.select(box)
    fireEvent.click(getByRole('tab', { name: 'Reference' }))
    fireEvent.click(getByText('\\w'))
    expect(box.value).toBe('a\\wef')
  })

  it('adds a test with Enter and shows it in the list', () => {
    const { getByRole, getByText, getByPlaceholderText } = renderRegexTester()
    fireEvent.click(getByRole('tab', { name: /^Tests/ }))
    const box = getByPlaceholderText('Test string…')
    fireEvent.change(box, { target: { value: 'x@y.com' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(getByText('x@y.com')).toBeTruthy()
  })

  it('hides to a strip and back, and remembers it across a remount', () => {
    const storage = memStorage()
    const first = renderRegexTester(storage)
    fireEvent.click(first.getByRole('button', { name: 'Hide panel' }))
    expect(first.queryByRole('tab', { name: 'Code' })).toBeNull()
    first.unmount()
    const second = renderRegexTester(storage)
    expect(second.queryByRole('tab', { name: 'Code' })).toBeNull()
    fireEvent.click(second.getByRole('button', { name: /^Show Matches/ }))
    expect(second.getByRole('tab', { name: 'Code' })).toBeTruthy()
  })
})

describe('RegexTesterView — pattern the browser rejects', () => {
  it('shows the error line, the invalid chip and plain text with no highlights, for an unclosed group', () => {
    const { getByLabelText, getByRole, getByText, container } = renderRegexTester()
    fireEvent.change(getByLabelText('Pattern'), { target: { value: '(abc' } })
    expect(getByRole('alert').textContent).toMatch(/Unterminated group · column 1/)
    expect(getByText('invalid pattern')).toBeTruthy()
    expect(container.querySelectorAll('.nx-rt-editor-body mark')).toHaveLength(0)
  })

  it('copes with an empty pattern, an open class and a pattern that matches the empty string', () => {
    const { getByLabelText, getByText, container } = renderRegexTester()
    const box = getByLabelText('Pattern')
    fireEvent.change(box, { target: { value: '' } })
    expect(getByText('enter a pattern')).toBeTruthy()
    fireEvent.change(box, { target: { value: '[abc' } })
    expect(getByText('invalid pattern')).toBeTruthy()
    fireEvent.change(box, { target: { value: 'x*' } })
    expect(container.querySelector('.nx-rt-editor-body .nx-rt-overlay').textContent).toBe(container.querySelector('textarea').value)
  })

  it('numbers a named group and steps nothing when there are no matches', () => {
    const { getByLabelText, getByText, getByTitle } = renderRegexTester()
    fireEvent.change(getByLabelText('Pattern'), { target: { value: '(?<user>\\w+)@' } })
    expect(getByText('Group 1')).toBeTruthy()
    fireEvent.change(getByLabelText('Pattern'), { target: { value: 'qqqq' } })
    expect(getByTitle('Next').disabled).toBe(true)
  })
})

describe('RegexTesterView — highlight overlay scroll sync', () => {
  it('syncs the overlay scrollTop to the textarea on scroll', () => {
    const { container } = renderRegexTester()
    const textarea = container.querySelector('textarea')
    const overlay = textarea.previousElementSibling
    expect(overlay.scrollTop).toBe(0)
    fireEvent.scroll(textarea, { target: { scrollTop: 42 } })
    expect(overlay.scrollTop).toBe(42)
  })
})

describe('RegexTesterView — persistence', () => {
  it('persists the pattern (debounced) as a document and lists it under saved patterns after remount', () => {
    vi.useFakeTimers()
    const storage = memStorage()
    const { getByDisplayValue, unmount } = renderRegexTester(storage)
    fireEvent.change(getByDisplayValue('(\\w+)@([\\w.-]+\\.[a-z]{2,})'), { target: { value: '\\d+' } })
    act(() => { vi.advanceTimersByTime(1500) })
    unmount()
    vi.useRealTimers()

    const { getByRole } = renderRegexTester(storage)
    expect(within(getByRole('list', { name: 'Saved patterns' })).getAllByRole('listitem')).toHaveLength(1)
  })
})

describe('RegexTesterView — saved patterns', () => {
  const demo = '(\\w+)@([\\w.-]+\\.[a-z]{2,})'
  const list = r => within(r.getByRole('list', { name: 'Saved patterns' }))

  it('has a saved patterns column with a + button, empty to begin with', () => {
    const r = renderRegexTester()
    expect(r.getByText('No saved patterns yet.')).toBeTruthy()
    expect(r.getByRole('button', { name: 'New pattern' })).toBeTruthy()
  })

  it('autosaves a typed pattern into a new saved pattern, open and marked', () => {
    vi.useFakeTimers()
    const r = renderRegexTester()
    fireEvent.change(r.getByDisplayValue(demo), { target: { value: '\\d+' } })
    act(() => { vi.advanceTimersByTime(1500) })
    expect(list(r).getAllByRole('listitem')).toHaveLength(1)
    expect(list(r).getAllByText('/\\d+/g').length).toBeGreaterThan(0)
    expect(list(r).getByRole('button').getAttribute('aria-current')).toBe('true')
    vi.useRealTimers()
  })

  it('opening a saved pattern loads it back into the pattern input', () => {
    vi.useFakeTimers()
    const r = renderRegexTester()
    fireEvent.change(r.getByDisplayValue(demo), { target: { value: '\\d+' } })
    act(() => { vi.advanceTimersByTime(1500) })

    fireEvent.click(r.getByRole('button', { name: 'New pattern' }))
    fireEvent.change(r.getByLabelText('Pattern'), { target: { value: '[a-z]+' } })
    act(() => { vi.advanceTimersByTime(1500) })
    expect(list(r).getAllByRole('listitem')).toHaveLength(2)

    fireEvent.click(list(r).getAllByRole('button')[0])
    expect(r.getByDisplayValue('\\d+')).toBeTruthy()
    vi.useRealTimers()
  })

  it('+ resets the pattern but keeps the canned test cases', () => {
    vi.useFakeTimers()
    const r = renderRegexTester()
    fireEvent.change(r.getByDisplayValue(demo), { target: { value: '\\d+' } })
    act(() => { vi.advanceTimersByTime(1500) })

    fireEvent.click(r.getByRole('button', { name: 'New pattern' }))
    expect(r.getByLabelText('Pattern').value).toBe('')
    expect(r.getByText('URL')).toBeTruthy()
    vi.useRealTimers()
  })

  it('Duplicate adds a copy, Rename… renames, Delete… removes — all from the right-click menu', () => {
    vi.useFakeTimers()
    const r = renderRegexTester()
    fireEvent.change(r.getByDisplayValue(demo), { target: { value: '\\d+' } })
    act(() => { vi.advanceTimersByTime(1500) })
    const menuFor = () => fireEvent.contextMenu(list(r).getAllByRole('button')[0])

    menuFor()
    fireEvent.click(r.getByRole('menuitem', { name: 'Duplicate' }))
    expect(list(r).getAllByRole('listitem')).toHaveLength(2)
    expect(list(r).getAllByText('/\\d+/g copy').length).toBeGreaterThan(0)

    menuFor()
    fireEvent.click(r.getByRole('menuitem', { name: 'Rename…' }))
    const field = r.getByRole('textbox', { name: 'Rename pattern' })
    fireEvent.change(field, { target: { value: 'Digits' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(list(r).getByText('Digits')).toBeTruthy()

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    menuFor()
    fireEvent.click(r.getByRole('menuitem', { name: 'Delete…' }))
    expect(list(r).getAllByRole('listitem')).toHaveLength(1)
    vi.restoreAllMocks()
    vi.useRealTimers()
  })
})

describe('RegexTesterView — Ctrl+↑/↓ steps the matches', () => {
  it('steps forward and back through the matches from anywhere in the tool', () => {
    const { container, getByText } = renderRegexTester()
    const textarea = container.querySelector('textarea')
    fireEvent.keyDown(textarea, { key: 'ArrowDown', ctrlKey: true })
    expect(getByText('1 / 3')).toBeTruthy()
    fireEvent.keyDown(textarea, { key: 'ArrowDown', ctrlKey: true })
    expect(getByText('2 / 3')).toBeTruthy()
    fireEvent.keyDown(textarea, { key: 'ArrowUp', ctrlKey: true })
    expect(getByText('1 / 3')).toBeTruthy()
  })

  it('leaves plain arrow keys alone', () => {
    const { container, queryByText } = renderRegexTester()
    fireEvent.keyDown(container.querySelector('textarea'), { key: 'ArrowDown' })
    expect(queryByText('1 / 3')).toBeNull()
  })
})
