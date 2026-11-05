import React from 'react'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RecordingsPanel } from './recordings-panel.jsx'

vi.mock('./recording-tree.jsx', () => ({ RecordingTree: ({ recording }) => <div data-testid="tree">{recording.header.label}</div> }))

let api, stateCb
const info = (over = {}) => ({ id: 'rec-20261105-101500-ab12', label: 'merge test', startedAt: Date.UTC(2026, 10, 5, 10, 15), endedAt: Date.UTC(2026, 10, 5, 10, 16), events: 120, bytes: 2048, status: 'finished', version: 1, ...over })
const make = (over = {}) => ({
  start: vi.fn(async () => ({ id: 'rec-20261105-111500-cd34' })),
  stop: vi.fn(async () => info({ id: 'rec-20261105-111500-cd34', label: 'new one', events: 12 })),
  status: vi.fn(async () => ({ recording: false })),
  list: vi.fn(async () => [info()]),
  read: vi.fn(async (id) => ({ header: { id, label: 'merge test' }, events: [] })),
  remove: vi.fn(async () => {}),
  exportTo: vi.fn(async () => ({ saved: true, file: 'C:/x.nxrec' })),
  importFile: vi.fn(async () => null),
  onState: vi.fn((cb) => { stateCb = cb; return () => { stateCb = null } }),
  ...over,
})
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const mount = async () => { render(<RecordingsPanel />); await flush() }

beforeEach(() => { api = make(); window.electronAPI = { recording: api } })
afterEach(() => { cleanup(); delete window.electronAPI; vi.useRealTimers() })

describe('RecordingsPanel', () => {
  it('shows nothing outside the desktop app', async () => {
    delete window.electronAPI
    const { container } = render(<RecordingsPanel />)
    await flush()
    expect(container.textContent).toBe('')
  })

  it('Record starts a recording with the label the person gave, and shows how long it has run and how much it holds', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(Date.UTC(2026, 10, 5, 11, 15, 0))
    await mount()
    fireEvent.change(screen.getByRole('textbox', { name: 'Recording label' }), { target: { value: 'new one' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Record' })) })
    expect(api.start).toHaveBeenCalledWith('new one')
    api.status.mockResolvedValue({ recording: true, id: 'rec-20261105-111500-cd34', startedAt: Date.now(), events: 12, capped: false })
    await act(async () => { stateCb({ recording: true, id: 'rec-20261105-111500-cd34', startedAt: Date.now(), events: 0 }) })
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull()
    await act(async () => { vi.advanceTimersByTime(3000) })
    expect(screen.getByText('00:03')).toBeTruthy()
    expect(screen.getByText('12 events')).toBeTruthy()
  })

  it('Stop ends the recording and opens it as a tree', async () => {
    await mount()
    await act(async () => { stateCb({ recording: true, id: 'rec-20261105-111500-cd34', startedAt: Date.now(), events: 3 }) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop' })) })
    await flush()
    expect(api.stop).toHaveBeenCalled()
    expect(api.read).toHaveBeenCalledWith('rec-20261105-111500-cd34')
    expect(screen.getByTestId('tree')).toBeTruthy()
  })

  it('a start that fails says why, in words', async () => {
    api.start.mockRejectedValue(new Error("Error invoking remote method 'recording:start': Error: A recording is already running"))
    await mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Record' })) })
    expect(screen.getByRole('alert').textContent).toBe('A recording is already running')
  })

  it('a recording started or stopped somewhere else changes the button', async () => {
    await mount()
    expect(screen.getByRole('button', { name: 'Record' })).toBeTruthy()
    await act(async () => { stateCb({ recording: true, id: 'rec-x', startedAt: Date.now(), events: 0 }) })
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
    await act(async () => { stateCb({ recording: false }) })
    expect(screen.getByRole('button', { name: 'Record' })).toBeTruthy()
  })

  it('lists the saved recordings with what happened to each, and offers no Open for one it cannot read', async () => {
    api.list.mockResolvedValue([
      info({ id: 'rec-20261105-120000-aaaa', label: 'one' }),
      info({ id: 'rec-20261105-110000-bbbb', label: 'two', status: 'unfinished' }),
      info({ id: 'rec-20261105-100000-cccc', label: 'three', status: 'capped' }),
      info({ id: 'rec-20261105-090000-dddd', label: 'four', status: 'unreadable', version: 99 }),
    ])
    await mount()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByText(/the app closed before it finished/i)).toBeTruthy()
    expect(screen.getByText(/stopped at its size limit/i)).toBeTruthy()
    expect(screen.getByText(/made by another version/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open one' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open four' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Delete four' })).toBeTruthy()
  })

  it('Open reads the recording and shows it as a tree; Close puts it away', async () => {
    await mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open merge test' })) })
    expect(api.read).toHaveBeenCalledWith('rec-20261105-101500-ab12')
    expect(screen.getByTestId('tree').textContent).toBe('merge test')
    fireEvent.click(screen.getByRole('button', { name: 'Close recording' }))
    expect(screen.queryByTestId('tree')).toBeNull()
  })

  it('a recording that cannot be opened says so', async () => {
    api.read.mockRejectedValue(new Error('This recording is in format version 99'))
    await mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open merge test' })) })
    expect(screen.getByRole('alert').textContent).toMatch(/format version 99/)
  })

  it('Delete asks first, and only then removes it and refreshes the list', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Delete merge test' }))
    expect(api.remove).not.toHaveBeenCalled()
    api.list.mockResolvedValue([])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete for good' })) })
    expect(api.remove).toHaveBeenCalledWith('rec-20261105-101500-ab12')
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('Export asks the main process to save it; a cancelled export shows nothing', async () => {
    await mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Export merge test' })) })
    expect(api.exportTo).toHaveBeenCalledWith('rec-20261105-101500-ab12')
    expect(screen.getByRole('status').textContent).toMatch(/saved/i)
    api.exportTo.mockResolvedValue({ saved: false })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Export merge test' })) })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('Import adds the recording to the list; a file that is not a recording says so', async () => {
    await mount()
    api.importFile.mockResolvedValueOnce(info({ id: 'rec-20261105-130000-eeee', label: 'imported' }))
    api.list.mockResolvedValue([info(), info({ id: 'rec-20261105-130000-eeee', label: 'imported' })])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Import' })) })
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    api.importFile.mockRejectedValueOnce(new Error("Error invoking remote method 'recording:import': Error: That file is not a NexusMD recording"))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Import' })) })
    expect(screen.getByRole('alert').textContent).toBe('That file is not a NexusMD recording')
  })

  it('a cancelled import does nothing', async () => {
    await mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Import' })) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says when there are no recordings yet', async () => {
    api.list.mockResolvedValue([])
    await mount()
    expect(screen.getByText(/no recordings yet/i)).toBeTruthy()
  })
})
