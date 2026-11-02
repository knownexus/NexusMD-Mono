import React from 'react'
import { render, screen, cleanup, act } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { SyncIndicator, SidebarSyncStatus, lastLoadedAt } from './sync-indicator.jsx'

const NOW = new Date('2026-11-02T12:00:00Z').getTime()

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('SyncIndicator', () => {
  it('SyncIndicator shows "Updated 5m ago" and the offline text with the pending count', () => {
    render(<SyncIndicator loadedAt={NOW - 5 * 60000} online={false} pending={2} />)
    expect(screen.getByText('Updated 5m ago')).toBeTruthy()
    expect(screen.getByText("Offline. 2 changes saved, and will sync when you're back.")).toBeTruthy()
  })

  it('says nothing about being offline while online', () => {
    render(<SyncIndicator loadedAt={NOW - 5 * 60000} online pending={2} />)
    expect(screen.getByText('Updated 5m ago')).toBeTruthy()
    expect(screen.queryByText(/Offline/)).toBeNull()
  })

  it('renders nothing with no load yet and a connection', () => {
    const { container } = render(<SyncIndicator loadedAt={null} online pending={0} />)
    expect(container.textContent).toBe('')
  })

  it('ticks every 30s and stops its timer on unmount', () => {
    const { unmount } = render(<SyncIndicator loadedAt={NOW - 5 * 60000} online />)
    act(() => { vi.advanceTimersByTime(60000) })
    expect(screen.getByText('Updated 6m ago')).toBeTruthy()
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('in the icon rail keeps the text as its accessible name', () => {
    render(<SyncIndicator loadedAt={NOW - 5 * 60000} online={false} pending={1} iconsOnly />)
    const el = screen.getByLabelText(/Updated 5m ago/)
    expect(el.getAttribute('aria-label')).toContain('Offline. 1 change saved')
    expect(screen.queryByText('Updated 5m ago')).toBeNull()
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
    expect(screen.getByText("Offline. 1 change saved, and will sync when you're back.")).toBeTruthy()
    act(() => { window.dispatchEvent(new CustomEvent('nexusmd:queue', { detail: { count: 3 } })) })
    expect(screen.getByText(/Offline\. 3 changes saved/)).toBeTruthy()
    online.mockReturnValue(true)
    act(() => { window.dispatchEvent(new Event('online')) })
    expect(screen.queryByText(/Offline/)).toBeNull()
    expect(screen.getByText('Updated 5m ago')).toBeTruthy()
    online.mockRestore()
  })

  it('re-reads the load time when the data refreshes', () => {
    let at = NOW - 10 * 60000
    let fire = null
    render(<SidebarSyncStatus readLoadedAt={() => at} readPending={() => 0} subscribeData={fn => { fire = fn; return () => { fire = null } }} />)
    expect(screen.getByText('Updated 10m ago')).toBeTruthy()
    at = NOW
    act(() => { fire() })
    expect(screen.getByText('Updated just now')).toBeTruthy()
  })
})
