import React from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PullRefresh, dampPull, pullLabel, PULL_TRIGGER } from './pull-refresh.jsx'
import { syncLabel, offlineText } from './sync-status.js'

afterEach(cleanup)

const pull = (el, from, to) => {
  fireEvent.touchStart(el, { touches: [{ clientY: from }] })
  fireEvent.touchMove(el, { touches: [{ clientY: to }] })
  fireEvent.touchEnd(el)
}

describe('pull to refresh', () => {
  it('refreshes after a long enough pull from the top', async () => {
    const onRefresh = vi.fn(async () => {})
    render(<PullRefresh onRefresh={onRefresh}><p>content</p></PullRefresh>)
    pull(screen.getByText('content').parentElement, 100, 100 + PULL_TRIGGER * 2 + 4)
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1))
  })

  it('ignores a short pull', () => {
    const onRefresh = vi.fn()
    render(<PullRefresh onRefresh={onRefresh}><p>content</p></PullRefresh>)
    pull(screen.getByText('content').parentElement, 100, 130)
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('does nothing when the screen is not at the top', () => {
    const onRefresh = vi.fn()
    render(<PullRefresh onRefresh={onRefresh}><p>content</p></PullRefresh>)
    const el = screen.getByText('content').parentElement
    Object.defineProperty(el, 'scrollTop', { value: 120, configurable: true })
    pull(el, 100, 400)
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('damps the pull and words the hint', () => {
    expect(dampPull(40)).toBe(20)
    expect(dampPull(-10)).toBe(0)
    expect(dampPull(1000)).toBeLessThanOrEqual(96)
    expect(pullLabel(10, false)).toBe('Pull to refresh')
    expect(pullLabel(PULL_TRIGGER, false)).toBe('Release to refresh')
    expect(pullLabel(0, true)).toBe('Refreshing…')
  })
})

describe('sync status', () => {
  const now = new Date('2026-11-02T12:00:00').getTime()
  it('says when the data was last updated', () => {
    expect(syncLabel(undefined, now)).toBe('')
    expect(syncLabel(now - 20000, now)).toBe('Updated just now')
    expect(syncLabel(now - 5 * 60000, now)).toBe('Updated 5m ago')
    expect(syncLabel(now - 3 * 3600000, now)).toBe('Updated 3h ago')
    expect(syncLabel(now - 50 * 3600000, now)).toBe('Updated 2d ago')
  })
  it('says how many changes wait while offline', () => {
    expect(offlineText(0)).toMatch(/saved and sync later/)
    expect(offlineText(1)).toBe("Offline. 1 change saved, and will sync when you're back.")
    expect(offlineText(3)).toMatch(/3 changes/)
  })
})
