import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { WorkContext } from './work-context.js'
import { WorkTopbar, WorkBanner } from './work-slots.jsx'
import { createBadgeStore, useWorkNavBadges } from './work-store.js'

afterEach(() => { cleanup(); delete window.electronAPI })

const withWork = (ui, work) => render(<WorkContext.Provider value={work}>{ui}</WorkContext.Provider>)

describe('WorkTopbar', () => {
  it('shows the seconds to the next refresh, and pauses and resumes', () => {
    const setRefreshPaused = vi.fn()
    withWork(<WorkTopbar />, { refreshLeft: 42, refreshPaused: false, setRefreshPaused })
    expect(screen.getByText('42s')).toBeTruthy()
    fireEvent.click(screen.getByTitle('Pause auto-refresh'))
    expect(setRefreshPaused).toHaveBeenCalledTimes(1)
    const toggle = setRefreshPaused.mock.calls[0][0]
    expect(toggle(false)).toBe(true)
    expect(toggle(true)).toBe(false)
  })
  it('says paused, and offers to resume', () => {
    withWork(<WorkTopbar />, { refreshLeft: 42, refreshPaused: true, setRefreshPaused: vi.fn() })
    expect(screen.getByText('paused')).toBeTruthy()
    expect(screen.getByTitle('Resume auto-refresh')).toBeTruthy()
  })
})

describe('WorkBanner', () => {
  it('shows nothing while the GitHub token is fine', () => {
    const { container } = withWork(<WorkBanner />, { githubExpired: false, dismissGithubExpired: vi.fn() })
    expect(container.textContent).toBe('')
  })
  it('says the token expired, and Re-connect opens the sign-in and dismisses the notice', () => {
    window.electronAPI = { openExternal: vi.fn() }
    const dismiss = vi.fn()
    withWork(<WorkBanner />, { githubExpired: true, dismissGithubExpired: dismiss })
    expect(screen.getByText(/GitHub token expired/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Re-connect' }))
    expect(window.electronAPI.openExternal).toHaveBeenCalledWith('nexusmd://github-oauth')
    expect(dismiss).toHaveBeenCalledTimes(1)
  })
  it('can be dismissed without signing in again', () => {
    window.electronAPI = { openExternal: vi.fn() }
    const dismiss = vi.fn()
    withWork(<WorkBanner />, { githubExpired: true, dismissGithubExpired: dismiss })
    fireEvent.click(screen.getAllByRole('button').find(b => b.textContent === ''))
    expect(dismiss).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.openExternal).not.toHaveBeenCalled()
  })
})

describe('badge store', () => {
  let store
  beforeEach(() => { store = createBadgeStore() })

  it('holds the counts it was given', () => {
    store.set({ work: 2, prs: 1 })
    expect(store.get()).toEqual({ work: 2, prs: 1 })
  })
  it('tells listeners about a change, but not about the same counts again', () => {
    const fn = vi.fn()
    store.subscribe(fn)
    store.set({ work: 2 })
    store.set({ work: 2 })
    store.set({ work: 2, prs: 0 })   // a zero is the same as nothing
    expect(fn).toHaveBeenCalledTimes(1)
    store.set({ work: 3 })
    expect(fn).toHaveBeenCalledTimes(2)
  })
  it('stops telling listeners that unsubscribed', () => {
    const fn = vi.fn()
    const off = store.subscribe(fn)
    off()
    store.set({ work: 1 })
    expect(fn).not.toHaveBeenCalled()
  })
  it('re-renders a component using the hook when the counts change', () => {
    function Probe() { return <div>{JSON.stringify(useWorkNavBadges(store))}</div> }
    render(<Probe />)
    expect(screen.getByText('{}')).toBeTruthy()
    act(() => store.set({ tests: 4 }))
    expect(screen.getByText('{"tests":4}')).toBeTruthy()
  })
})
