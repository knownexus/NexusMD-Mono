import React from 'react'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@nexusmd/ui', () => ({
  Icon: () => null,
  VsCard: ({ children }) => <div>{children}</div>,
  VsRow: ({ title, desc, children }) => <div><span>{title}</span><span>{desc}</span><div>{children}</div></div>,
  toast: vi.fn(),
}))

import { AppUpdatesBanner, AppUpdatesCard, busyQuestion, readyText } from './app-updates.jsx'
import { toast } from '@nexusmd/ui'

const DEVENV = { id: 'devenv', label: 'Dev Environment', from: '1.0.1', to: '1.0.2' }
const GIT = { id: 'git', label: 'Git Workspace', from: '1.0.1', to: '1.0.2' }
const none = { applied: [], busy: [], failed: [] }

function fakeApi({ pending = [], apply = async () => ({ ...none, applied: pending }), check } = {}) {
  let ready
  return {
    pending: vi.fn(async () => pending),
    apply: vi.fn(apply),
    check: vi.fn(check ?? (async () => ({ enabled: true, error: null, pending }))),
    onReady: vi.fn(cb => { ready = cb; return () => { ready = null } }),
    fireReady: list => act(() => ready?.(list)),
  }
}

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('readyText and busyQuestion', () => {
  it('names one update with its version, several by name', () => {
    expect(readyText([DEVENV])).toBe('Dev Environment 1.0.2 is ready.')
    expect(readyText([DEVENV, GIT])).toBe('Updates are ready for Dev Environment and Git Workspace.')
  })
  it('says what updating would interrupt', () => {
    expect(busyQuestion([{ label: 'Dev Environment', running: true, windows: 0 }, { label: 'Git Workspace', running: false, windows: 2 }]))
      .toBe('Dev Environment is running something; Git Workspace has 2 windows open. Updating stops it and closes its windows. Update now?')
  })
})

describe('AppUpdatesBanner', () => {
  it('shows nothing until an update is waiting, then offers to update', async () => {
    const api = fakeApi()
    render(<AppUpdatesBanner api={api} />)
    await waitFor(() => expect(api.pending).toHaveBeenCalled())
    expect(screen.queryByRole('status')).toBeNull()
    api.fireReady([DEVENV])
    expect(screen.getByRole('status').textContent).toMatch('Dev Environment 1.0.2 is ready.')
  })

  it('updates now, then offers a reload in case unsaved changes held the window', async () => {
    const api = fakeApi({ pending: [DEVENV] })
    render(<AppUpdatesBanner api={api} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Update now' }))
    expect(api.apply).toHaveBeenCalledWith({ force: false })
    expect(await screen.findByRole('button', { name: 'Reload now' })).toBeTruthy()
  })

  it('asks before interrupting a busy app, and only then forces it', async () => {
    const api = fakeApi({
      pending: [DEVENV],
      apply: async ({ force }) => (force ? { ...none, applied: [DEVENV] } : { ...none, busy: [{ ...DEVENV, running: true, windows: 0 }] }),
    })
    const confirm = vi.fn(() => false)
    render(<AppUpdatesBanner api={api} confirm={confirm} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Update now' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.stringMatching('Dev Environment is running something')))
    expect(api.apply).toHaveBeenCalledTimes(1)
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }))
    await waitFor(() => expect(api.apply).toHaveBeenLastCalledWith({ force: true }))
  })

  it('says when an app could not start its new version', async () => {
    const api = fakeApi({ pending: [DEVENV], apply: async () => ({ ...none, failed: [{ ...DEVENV, error: 'boom' }] }) })
    render(<AppUpdatesBanner api={api} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Update now' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Couldn't update Dev Environment: boom", 'error'))
  })

  it('hides on Later until a different update arrives', async () => {
    const api = fakeApi({ pending: [DEVENV] })
    render(<AppUpdatesBanner api={api} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Later' }))
    expect(screen.queryByRole('status')).toBeNull()
    api.fireReady([DEVENV])
    expect(screen.queryByRole('status')).toBeNull()
    api.fireReady([DEVENV, GIT])
    expect(screen.getByRole('status')).toBeTruthy()
  })
})

describe('AppUpdatesCard', () => {
  it('checks now and says the apps are up to date', async () => {
    const api = fakeApi()
    render(<AppUpdatesCard api={api} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }))
    expect(await screen.findByText('All apps are up to date.')).toBeTruthy()
  })

  it('offers to update what a check found', async () => {
    const api = fakeApi({ check: async () => ({ enabled: true, error: null, pending: [DEVENV] }) })
    render(<AppUpdatesCard api={api} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Update now' }))
    expect(api.apply).toHaveBeenCalledWith({ force: false })
  })

  it("says why it couldn't check", async () => {
    const api = fakeApi({ check: async () => ({ enabled: true, error: 'offline', pending: [] }) })
    render(<AppUpdatesCard api={api} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }))
    expect(await screen.findByText("Couldn't check: offline")).toBeTruthy()
  })
})
