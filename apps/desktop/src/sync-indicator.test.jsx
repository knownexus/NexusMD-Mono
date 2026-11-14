import React from 'react'
import { render, screen, cleanup, act } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { SyncIndicator, SidebarSyncStatus, lastLoadedAt, AccountSyncBadge, accountSyncLabel } from './sync-indicator.jsx'
import { OPEN_SETTINGS_EVENT, takePendingSettingsTab } from '@nexusmd/ui'

const NOW = new Date('2026-11-02T12:00:00Z').getTime()

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('SyncIndicator', () => {
  it('SyncIndicator shows "Updated 5m ago" and the offline text with the pending count', () => {
    render(<SyncIndicator loadedAt={NOW - 5 * 60000} online={false} pending={2} />)
    expect(screen.getByText('Work data updated 5m ago')).toBeTruthy()
    expect(screen.getByText("Offline. 2 changes saved, and will be sent when you're back online.")).toBeTruthy()
  })

  it('says nothing about being offline while online', () => {
    render(<SyncIndicator loadedAt={NOW - 5 * 60000} online pending={2} />)
    expect(screen.getByText('Work data updated 5m ago')).toBeTruthy()
    expect(screen.queryByText(/Offline/)).toBeNull()
  })

  it('renders nothing with no load yet and a connection', () => {
    const { container } = render(<SyncIndicator loadedAt={null} online pending={0} />)
    expect(container.textContent).toBe('')
  })

  it('ticks every 30s and stops its timer on unmount', () => {
    const { unmount } = render(<SyncIndicator loadedAt={NOW - 5 * 60000} online />)
    act(() => { vi.advanceTimersByTime(60000) })
    expect(screen.getByText('Work data updated 6m ago')).toBeTruthy()
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('in the icon rail keeps the text as its accessible name', () => {
    render(<SyncIndicator loadedAt={NOW - 5 * 60000} online={false} pending={1} iconsOnly />)
    const el = screen.getByLabelText(/Work data updated 5m ago/)
    expect(el.getAttribute('aria-label')).toContain('Offline. 1 change saved')
    expect(screen.queryByText('Work data updated 5m ago')).toBeNull()
  })
})

describe('lastLoadedAt', () => {
  it('is the newest successful provider load', () => {
    expect(lastLoadedAt({ ado: { status: 'ok', at: 10 }, jira: { status: 'error', at: 30 }, github: { status: 'ok', at: 20 } })).toBe(20)
  })
  it('is null with nothing loaded', () => {
    expect(lastLoadedAt({})).toBeNull()
    expect(lastLoadedAt({ ado: { status: 'error', at: 5 } })).toBeNull()
    expect(lastLoadedAt(null)).toBeNull()
  })
})

describe('SidebarSyncStatus', () => {
  it('follows the offline queue count and the connection', () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    render(<SidebarSyncStatus readLoadedAt={() => NOW - 5 * 60000} readPending={() => 1} subscribeData={() => () => {}} />)
    expect(screen.getByText("Offline. 1 change saved, and will be sent when you're back online.")).toBeTruthy()
    act(() => { window.dispatchEvent(new CustomEvent('nexusmd:queue', { detail: { count: 3 } })) })
    expect(screen.getByText(/Offline\. 3 changes saved/)).toBeTruthy()
    online.mockReturnValue(true)
    act(() => { window.dispatchEvent(new Event('online')) })
    expect(screen.queryByText(/Offline/)).toBeNull()
    expect(screen.getByText('Work data updated 5m ago')).toBeTruthy()
    online.mockRestore()
  })

  it('re-reads the load time when the data refreshes', () => {
    let at = NOW - 10 * 60000
    let fire = null
    render(<SidebarSyncStatus readLoadedAt={() => at} readPending={() => 0} subscribeData={fn => { fire = fn; return () => { fire = null } }} />)
    expect(screen.getByText('Work data updated 10m ago')).toBeTruthy()
    at = NOW
    act(() => { fire() })
    expect(screen.getByText('Work data updated just now')).toBeTruthy()
  })
})

describe('the account sync badge', () => {
  const sum = (over = {}) => ({ known: true, unsaved: { profiles: {}, unattributed: 0, total: 0 }, conflicts: 0, error: null, ...over })

  it('says the most pressing thing first: error, then conflicts, then unsaved changes, then Saved', () => {
    expect(accountSyncLabel(sum())).toEqual({ text: 'Saved', tone: 'ok' })
    expect(accountSyncLabel(sum({ unsaved: { profiles: { W: 2 }, unattributed: 1, total: 3 } }))).toEqual({ text: '3 unsaved', tone: 'warn' })
    expect(accountSyncLabel(sum({ conflicts: 1, unsaved: { total: 3 } }))).toEqual({ text: '1 conflict', tone: 'warn' })
    expect(accountSyncLabel(sum({ conflicts: 2 }))).toEqual({ text: '2 conflicts', tone: 'warn' })
    expect(accountSyncLabel(sum({ error: 'offline', conflicts: 2 }))).toEqual({ text: 'Sync error', tone: 'bad' })
  })

  it('shows nothing when there is no account or the count is not known', () => {
    expect(accountSyncLabel({ known: false })).toBeNull()
    expect(accountSyncLabel()).toBeNull()
    render(<AccountSyncBadge summary={{ known: false }} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('is a button that opens Settings on Data & sync', () => {
    const heard = vi.fn()
    window.addEventListener(OPEN_SETTINGS_EVENT, heard)
    render(<AccountSyncBadge summary={sum({ conflicts: 2 })} />)
    const btn = screen.getByRole('button', { name: /2 conflicts/ })
    expect(btn.textContent).toBe('2 conflicts')
    btn.click()
    window.removeEventListener(OPEN_SETTINGS_EVENT, heard)
    expect(heard.mock.calls[0][0].detail).toEqual({ tab: 'data' })
    expect(takePendingSettingsTab()).toBe('data')
  })

  it('in the icon rail is an icon whose name carries the text', () => {
    render(<AccountSyncBadge iconsOnly summary={sum({ unsaved: { total: 4 } })} />)
    const btn = screen.getByRole('button', { name: /4 unsaved/ })
    expect(btn.textContent).toBe('')
  })
})
