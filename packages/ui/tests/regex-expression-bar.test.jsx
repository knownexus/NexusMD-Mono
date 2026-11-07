import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { ExpressionBar } from '../src/views/regex-tester/expression-bar.jsx'

afterEach(cleanup)

const FLAGS = { g: true, i: false, m: false, s: false, u: false }
const match = (index, value) => ({ index, value, groups: [], indices: null, named: {} })
const props = (over = {}) => ({
  state: { pattern: '\\d+', flags: FLAGS, mode: 'match', subReplacement: '' }, patch: vi.fn(), matches: [match(0, '1'), match(2, '2'), match(4, '3')],
  selIdx: -1, onStep: vi.fn(), error: null, ...over,
})
const show = over => { const p = props(over); const r = render(<ExpressionBar {...p} />); return { ...p, ...r } }
const invalid = pattern => { try { new RegExp(pattern); return null } catch (e) { return e.message } }

describe('ExpressionBar', () => {
  it('has the pattern between slashes with the flags inline after the second slash', () => {
    const p = show()
    const field = p.getByDisplayValue('\\d+').closest('.nx-rt-pattern-field')
    const slashes = [...field.querySelectorAll('.nx-rt-slash')]
    expect(slashes).toHaveLength(2)
    const flags = [...field.querySelectorAll('.nx-rt-flag')].map(f => f.textContent)
    expect(flags).toEqual(['g', 'i', 'm', 's', 'u'])
    expect(slashes[1].compareDocumentPosition(field.querySelector('.nx-rt-flag')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('toggles a flag through patch, with its description as the title, and shows which are on', () => {
    const p = show()
    const g = p.getByTitle('Global — find all matches')
    expect(g.getAttribute('aria-pressed')).toBe('true')
    expect(p.getByTitle('Case insensitive').getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(p.getByTitle('Case insensitive'))
    expect(p.patch).toHaveBeenCalledWith({ flags: { ...FLAGS, i: true } })
  })

  it('types into the pattern through patch', () => {
    const p = show()
    fireEvent.change(p.getByDisplayValue('\\d+'), { target: { value: '\\w+' } })
    expect(p.patch).toHaveBeenCalledWith({ pattern: '\\w+' })
  })

  it('colours the pattern by what each part is', () => {
    const p = show({ state: { pattern: '(\\w+)@[a-z]{2,}', flags: FLAGS, mode: 'match', subReplacement: '' } })
    const kinds = sel => [...p.container.querySelectorAll(`.nx-rt-overlay [data-kind="${sel}"]`)].map(e => e.textContent)
    expect(kinds('escape')).toEqual(['\\w'])
    expect(kinds('class')).toEqual(['[a-z]'])
    expect(kinds('quant')).toEqual(['+', '{2,}'])
    expect(kinds('group-open')).toEqual(['('])
  })

  it('gives each capture group\'s parentheses its own colour', () => {
    const p = show({ state: { pattern: '(a)(b)', flags: FLAGS, mode: 'match', subReplacement: '' } })
    const open = [...p.container.querySelectorAll('.nx-rt-overlay [data-kind="group-open"]')]
    expect(open.map(e => e.getAttribute('data-group'))).toEqual(['1', '2'])
    expect(open[0].style.color).not.toBe(open[1].style.color)
  })

  it('marks the ( of an unclosed group in the danger colour', () => {
    const p = show({ state: { pattern: '(abc', flags: FLAGS, mode: 'match', subReplacement: '' }, error: invalid('(abc') })
    const bad = p.container.querySelector('.nx-rt-overlay [data-kind="unclosed"]')
    expect(bad.textContent).toBe('(')
    expect(bad.style.background).toContain('--danger-soft')
  })

  describe('status chip', () => {
    const chip = p => p.container.querySelector('.nx-rt-chip')
    it('says N matches in the success tone, no matches in the warning tone', () => {
      const p = show()
      expect(chip(p).textContent).toBe('3 matches')
      expect(chip(p).getAttribute('data-tone')).toBe('success')
      cleanup()
      const q = show({ matches: [] })
      expect(chip(q).textContent).toBe('no matches')
      expect(chip(q).getAttribute('data-tone')).toBe('warning')
    })

    it('says 1 match, enter a pattern, invalid pattern and N replaced', () => {
      expect(chip(show({ matches: [match(0, '1')] })).textContent).toBe('1 match')
      cleanup()
      expect(chip(show({ state: { pattern: '', flags: FLAGS, mode: 'match', subReplacement: '' }, matches: [] })).textContent).toBe('enter a pattern')
      cleanup()
      const bad = show({ state: { pattern: '(', flags: FLAGS, mode: 'match', subReplacement: '' }, matches: [], error: invalid('(') })
      expect(chip(bad).textContent).toBe('invalid pattern')
      expect(chip(bad).getAttribute('data-tone')).toBe('danger')
      cleanup()
      const sub = show({ state: { pattern: '\\d+', flags: FLAGS, mode: 'sub', subReplacement: 'x' } })
      expect(chip(sub).textContent).toBe('3 replaced')
    })
  })

  describe('match stepper', () => {
    it('steps with ‹ and › and shows where it is', () => {
      const p = show({ selIdx: 1 })
      expect(p.getByText('2 / 3')).toBeTruthy()
      fireEvent.click(p.getByTitle('Previous'))
      fireEvent.click(p.getByTitle('Next'))
      expect(p.onStep.mock.calls).toEqual([[-1], [1]])
    })

    it('shows the count before one is chosen, and disables the arrows for fewer than two matches', () => {
      const p = show()
      expect(p.getByText('3')).toBeTruthy()
      cleanup()
      const one = show({ matches: [match(0, '1')] })
      expect(one.getByTitle('Next').disabled).toBe(true)
      expect(one.getByTitle('Previous').disabled).toBe(true)
    })

    it('is not there in Replace mode', () => {
      const p = show({ state: { pattern: '\\d+', flags: FLAGS, mode: 'sub', subReplacement: '' } })
      expect(p.queryByTitle('Next')).toBeNull()
    })
  })

  describe('mode', () => {
    it('is Match | Replace, never Substitution, and Replace stores mode: sub', () => {
      const p = show()
      expect(p.queryByText('Substitution')).toBeNull()
      expect(p.getByRole('tab', { name: 'Match' }).getAttribute('aria-selected')).toBe('true')
      fireEvent.click(p.getByRole('tab', { name: 'Replace' }))
      expect(p.patch).toHaveBeenCalledWith({ mode: 'sub' })
    })
  })

  describe('error line', () => {
    it('gives the reason, the column and a hint under the field, and the field is marked invalid', () => {
      const p = show({ state: { pattern: 'a(b', flags: FLAGS, mode: 'match', subReplacement: '' }, matches: [], error: invalid('a(b') })
      const alert = p.getByRole('alert')
      expect(alert.textContent).toBe('Unterminated group · column 2 · Add a closing ) or remove the (.')
      expect(p.container.querySelector('.nx-rt-pattern-field').getAttribute('data-invalid')).toBe('true')
    })

    it('gives just the reason when it cannot place the fault', () => {
      const p = show({ state: { pattern: '\\k<x>', flags: { ...FLAGS, u: true }, mode: 'match', subReplacement: '' }, matches: [], error: invalid('\\k<x>') || 'Invalid named reference' })
      expect(p.getByRole('alert').textContent).not.toMatch(/column/)
    })

    it('is not there for a valid pattern', () => {
      expect(show().queryByRole('alert')).toBeNull()
    })
  })

  describe('replace row', () => {
    const sub = (subReplacement = '') => ({ pattern: '(\\w)(\\d)', flags: FLAGS, mode: 'sub', subReplacement })

    it('has the With eyebrow, the replacement field and a hint about $&, groups and names', () => {
      const p = show({ state: sub() })
      expect(p.getByText('With', { selector: '.nx-rt-eyebrow' })).toBeTruthy()
      expect(p.getByPlaceholderText('$1, $2, $& …')).toBeTruthy()
      expect(p.getByText('$& whole match · $1 $2 groups · $<name>')).toBeTruthy()
    })

    it('types into the replacement through patch', () => {
      const p = show({ state: sub() })
      fireEvent.change(p.getByPlaceholderText('$1, $2, $& …'), { target: { value: '$2-$1' } })
      expect(p.patch).toHaveBeenCalledWith({ subReplacement: '$2-$1' })
    })

    it('tints $1 and $2 in their group colours', () => {
      const p = show({ state: sub('$2-$1-$&') })
      const refs = [...p.container.querySelectorAll('.nx-rt-replace [data-group]')]
      expect(refs.map(r => [r.textContent, r.getAttribute('data-group')])).toEqual([['$2', '2'], ['$1', '1']])
    })

    it('is not there in Match mode', () => {
      expect(show().queryByPlaceholderText('$1, $2, $& …')).toBeNull()
    })
  })
})
