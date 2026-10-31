import React from 'react'
import { render, act, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { validateAdoForm, validateJiraForm, hasErrors, savedLabel, useFormAutosave } from './autosave-form.js'

afterEach(cleanup)

const ado = { org: 'acme', pat: '', interval: 30, uatPipelineId: '' }

describe('Azure DevOps form checks', () => {
  it('accepts a good form', () => { expect(hasErrors(validateAdoForm(ado))).toBe(false) })
  it('needs an organisation, and only its name', () => {
    expect(validateAdoForm({ ...ado, org: ' ' }).org).toMatch(/Enter/)
    expect(validateAdoForm({ ...ado, org: 'https://dev.azure.com/acme' }).org).toMatch(/follows dev.azure.com/)
    expect(validateAdoForm({ ...ado, org: 'my org' }).org).toBeTruthy()
  })
  it('checks the token length only when one is typed, the interval and the pipeline id', () => {
    expect(validateAdoForm({ ...ado, pat: '' }).pat).toBeUndefined()
    expect(validateAdoForm({ ...ado, pat: 'short' }).pat).toMatch(/too short/)
    expect(validateAdoForm({ ...ado, interval: 5 }).interval).toBeTruthy()
    expect(validateAdoForm({ ...ado, interval: 'abc' }).interval).toBeTruthy()
    expect(validateAdoForm({ ...ado, uatPipelineId: '12x' }).uatPipelineId).toBeTruthy()
    expect(validateAdoForm({ ...ado, uatPipelineId: '12' }).uatPipelineId).toBeUndefined()
  })
})

describe('Jira form checks', () => {
  const jira = { site: 'acme', email: 'me@acme.com', token: '', keys: 'ABC, DEF' }
  it('accepts a good form', () => { expect(hasErrors(validateJiraForm(jira))).toBe(false) })
  it('checks the site, email and project keys', () => {
    expect(validateJiraForm({ ...jira, site: '' }).site).toBeTruthy()
    for (const bad of ['a b', 'evil.com', 'a@evil.com', 'acme.atlassian.net/x?y', 'acme#x', 'a\\b']) expect(validateJiraForm({ ...jira, site: bad }).site).toBeTruthy()
    for (const ok of ['acme', 'acme.atlassian.net', 'https://acme.atlassian.net/']) expect(validateJiraForm({ ...jira, site: ok }).site).toBeUndefined()
    expect(validateJiraForm({ ...jira, email: 'nope' }).email).toMatch(/email/)
    expect(validateJiraForm({ ...jira, keys: 'ABC, 1x, a-b' }).keys).toMatch(/1x, a-b/)
    expect(validateJiraForm({ ...jira, keys: '' }).keys).toBeUndefined()
    expect(validateJiraForm({ ...jira, token: 'tiny' }).token).toBeTruthy()
  })
})

describe('what the footer says', () => {
  it('reports errors first, then progress', () => {
    expect(savedLabel({ errors: { org: 'x' }, status: 'saved' })).toMatch(/Fix/)
    expect(savedLabel({ errors: {}, status: 'saving' })).toBe('Saving…')
    expect(savedLabel({ errors: {}, status: 'saved' })).toBe('Saved')
    expect(savedLabel({ errors: {}, status: 'idle' })).toMatch(/save as you type/)
  })
})

describe('saving as you type', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const mount = (props) => {
    const out = { current: null }
    const Probe = (p) => { out.current = useFormAutosave(p); return null }
    const r = render(<Probe {...props}/>)
    return { out, rerender: (p) => r.rerender(<Probe {...p}/>) }
  }
  const base = { enabled: true, initial: { org: 'acme' }, validate: validateAdoForm }

  it('saves nothing just for opening the form', () => {
    const save = vi.fn()
    mount({ ...base, values: { org: 'acme', interval: 30 }, initial: { org: 'acme', interval: 30 }, save })
    act(() => { vi.advanceTimersByTime(2000) })
    expect(save).not.toHaveBeenCalled()
  })

  it('saves a valid change after the last keystroke, once', () => {
    const save = vi.fn()
    const init = { org: 'acme', interval: 30 }
    const { out, rerender } = mount({ ...base, initial: init, values: init, save })
    rerender({ ...base, initial: init, values: { ...init, org: 'acme2' }, save })
    rerender({ ...base, initial: init, values: { ...init, org: 'acme3' }, save })
    act(() => { vi.advanceTimersByTime(300) })
    expect(save).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(600) })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].org).toBe('acme3')
    expect(out.current.status).toBe('saved')
    expect(out.current.dirty).toBe(true)
  })

  it('does not save while a field is wrong, and says so', () => {
    const save = vi.fn()
    const init = { org: 'acme', interval: 30 }
    const { out, rerender } = mount({ ...base, initial: init, values: init, save })
    rerender({ ...base, initial: init, values: { ...init, org: 'not valid/' }, save })
    act(() => { vi.advanceTimersByTime(2000) })
    expect(save).not.toHaveBeenCalled()
    expect(out.current.errors.org).toBeTruthy()
    expect(out.current.label).toMatch(/Fix/)
  })

  it('holds back a changed server address until it is flushed', () => {
    const save = vi.fn()
    const init = { org: 'acme', interval: 30 }
    const { out, rerender } = mount({ ...base, hold: ['org'], initial: init, values: init, save })
    rerender({ ...base, hold: ['org'], initial: init, values: { ...init, org: 'acm' }, save })
    act(() => { vi.advanceTimersByTime(3000) })
    expect(save).not.toHaveBeenCalled()
    expect(out.current.label).toMatch(/server address/)
    act(() => { out.current.flush() })
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('still autosaves other fields while the address is unchanged', () => {
    const save = vi.fn()
    const init = { org: 'acme', interval: 30 }
    const { rerender } = mount({ ...base, hold: ['org'], initial: init, values: init, save })
    rerender({ ...base, hold: ['org'], initial: init, values: { ...init, interval: 60 }, save })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('does nothing when disabled', () => {
    const save = vi.fn()
    const init = { org: 'acme', interval: 30 }
    const { rerender } = mount({ ...base, enabled: false, initial: init, values: init, save })
    rerender({ ...base, enabled: false, initial: init, values: { ...init, org: 'x' }, save })
    act(() => { vi.advanceTimersByTime(2000) })
    expect(save).not.toHaveBeenCalled()
  })
})
