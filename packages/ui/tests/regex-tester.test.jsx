import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
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
    expect(getByText('1/3')).toBeTruthy()
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

describe('RegexTesterView — substitution mode', () => {
  it('shows a live substitution preview', () => {
    const { getByText, getByPlaceholderText } = renderRegexTester()
    fireEvent.click(getByText('Substitution'))
    fireEvent.change(getByPlaceholderText('$1, $2, $& …'), { target: { value: '[EMAIL]' } })
    expect(getByText(/\[EMAIL\]/)).toBeTruthy()
  })
})

describe('RegexTesterView — bottom tabs', () => {
  it('Code gen tab shows a JS snippet containing the current pattern', () => {
    const { getByText } = renderRegexTester()
    expect(getByText(/matchAll/)).toBeTruthy()
  })

  it('switches to the Reference tab and inserts a token into the pattern on click', () => {
    const { getByText, getByDisplayValue } = renderRegexTester()
    fireEvent.click(getByText('Reference'))
    fireEvent.click(getByText('\\d'))
    expect(getByDisplayValue('(\\w+)@([\\w.-]+\\.[a-z]{2,})\\d')).toBeTruthy()
  })

  it('adds a unit test and shows it in the list', () => {
    const { getByText, getByPlaceholderText } = renderRegexTester()
    fireEvent.click(getByText('Unit tests'))
    fireEvent.change(getByPlaceholderText('Test string…'), { target: { value: 'x@y.com' } })
    fireEvent.click(getByText('Add'))
    expect(getByText('x@y.com')).toBeTruthy()
  })
})

describe('RegexTesterView — persistence', () => {
  it('persists the pattern (debounced) and restores it on remount', () => {
    vi.useFakeTimers()
    const storage = memStorage()
    const { getByDisplayValue, unmount } = renderRegexTester(storage)
    fireEvent.change(getByDisplayValue('(\\w+)@([\\w.-]+\\.[a-z]{2,})'), { target: { value: '\\d+' } })
    act(() => { vi.advanceTimersByTime(500) })
    unmount()
    vi.useRealTimers()

    const { getByDisplayValue: getByDisplayValue2 } = renderRegexTester(storage)
    expect(getByDisplayValue2('\\d+')).toBeTruthy()
  })
})
