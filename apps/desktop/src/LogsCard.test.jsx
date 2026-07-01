import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import LogsCard from './logs-card.jsx'

vi.mock('@nexusmd/ui', () => ({
  VsCard: ({ children }) => <div>{children}</div>,
  VsRow: ({ title, children }) => <div><span>{title}</span><div>{children}</div></div>,
  Icon: () => null,
}))

const TWO_ENTRIES = [
  '[2026-07-01 10:00:00.000] [info]  [alpha] hello world',
  '[2026-07-01 10:00:01.000] [warn]  [beta] goodbye moon',
].join('\n')

let mockLogs

beforeEach(() => {
  mockLogs = {
    list: vi.fn(() => Promise.resolve([
      { date: '2026-07-01', size: 1024 },
      { date: '2026-06-30', size: 512 },
    ])),
    read: vi.fn(() => Promise.resolve('Log line 1\nLog line 2')),
    delete: vi.fn(() => Promise.resolve(true)),
  }
  vi.stubGlobal('electronAPI', { logs: mockLogs })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => { cleanup() })

describe('LogsCard', () => {
  it('calls electronAPI.logs.list on mount', async () => {
    render(<LogsCard />)
    await waitFor(() => expect(mockLogs.list).toHaveBeenCalled())
  })

  it('displays available log dates after loading', async () => {
    render(<LogsCard />)
    await waitFor(() => expect(screen.getByText(/2026-07-01/)).toBeTruthy())
  })

  it('calls logs.read with the first date automatically after list loads', async () => {
    render(<LogsCard />)
    await waitFor(() => expect(mockLogs.read).toHaveBeenCalledWith('2026-07-01'))
  })

  it('calls logs.read when a different date is selected', async () => {
    render(<LogsCard />)
    await waitFor(() => screen.getByRole('combobox', { name: /select date/i }))
    fireEvent.change(screen.getByRole('combobox', { name: /select date/i }), { target: { value: '2026-06-30' } })
    await waitFor(() => expect(mockLogs.read).toHaveBeenCalledWith('2026-06-30'))
  })

  it('displays parsed log content as entries', async () => {
    render(<LogsCard />)
    await waitFor(() => expect(screen.getByText(/Log line 1/)).toBeTruthy())
  })

  it('filters visible entries by search text', async () => {
    mockLogs.read = vi.fn(() => Promise.resolve(TWO_ENTRIES))
    render(<LogsCard />)
    await waitFor(() => expect(screen.getByText(/hello world/)).toBeTruthy())
    expect(screen.getByText(/goodbye moon/)).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: /search/i }), { target: { value: 'hello' } })
    await waitFor(() => expect(screen.queryByText(/goodbye moon/)).toBeNull())
    expect(screen.getByText(/hello world/)).toBeTruthy()
  })

  it('hides a level when its chip is toggled off', async () => {
    mockLogs.read = vi.fn(() => Promise.resolve(TWO_ENTRIES))
    render(<LogsCard />)
    await waitFor(() => expect(screen.getByText(/goodbye moon/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^warn$/i }))
    await waitFor(() => expect(screen.queryByText(/goodbye moon/)).toBeNull())
    expect(screen.getByText(/hello world/)).toBeTruthy()
  })

  it('filters visible entries by area', async () => {
    mockLogs.read = vi.fn(() => Promise.resolve(TWO_ENTRIES))
    render(<LogsCard />)
    await waitFor(() => expect(screen.getByText(/goodbye moon/)).toBeTruthy())
    fireEvent.change(screen.getByRole('combobox', { name: /filter by area/i }), { target: { value: 'alpha' } })
    await waitFor(() => expect(screen.queryByText(/goodbye moon/)).toBeNull())
    expect(screen.getByText(/hello world/)).toBeTruthy()
  })

  it('calls logs.delete and refreshes list when Delete log is clicked', async () => {
    render(<LogsCard />)
    await waitFor(() => screen.getByRole('button', { name: /Delete log/ }))
    const before = mockLogs.list.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: /Delete log/ }))
    await waitFor(() => expect(mockLogs.delete).toHaveBeenCalledWith('2026-07-01'))
    await waitFor(() => expect(mockLogs.list.mock.calls.length).toBeGreaterThan(before))
  })

  it('shows "No logs available" message when list is empty', async () => {
    mockLogs.list = vi.fn(() => Promise.resolve([]))
    render(<LogsCard />)
    await waitFor(() => expect(screen.getByText(/No logs available/)).toBeTruthy())
  })

  it('renders a Refresh button that re-fetches the log list', async () => {
    render(<LogsCard />)
    await waitFor(() => screen.getByRole('button', { name: 'Refresh' }))
    const before = mockLogs.list.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(mockLogs.list.mock.calls.length).toBeGreaterThan(before))
  })
})
