import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { ProfileProvider } from './profile-context.jsx'
import { RecoveredCopiesCard } from './recovered-copies-card.jsx'

afterEach(cleanup)

const P = 'nexusmd.p.W.sync.quarantine.'
const makeStorage = (seed = {}) => {
  const m = new Map(Object.entries(seed))
  return {
    getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, removeItem: k => { m.delete(k) },
    get length() { return m.size }, key: i => [...m.keys()][i] ?? null, has: k => m.has(k),
  }
}
const show = (storage, fileIO = { saveFile: vi.fn(async () => {}) }) => {
  const seeded = Object.assign(storage, {})
  render(
    <ProfileProvider namespace="nexusmd" store={{}} storage={storage}>
      <RecoveredCopiesCard fileIO={fileIO} storage={seeded} namespace="nexusmd" />
    </ProfileProvider>,
  )
  return fileIO
}
const base = { 'nexusmd.profiles': JSON.stringify([{ id: 'W', name: 'Work', updatedAt: 1 }]), 'nexusmd.activeProfileId': 'W' }

describe('RecoveredCopiesCard', () => {
  it('shows nothing when no damaged copy was kept', () => {
    show(makeStorage(base))
    expect(screen.queryByText('Recovered copies')).toBeNull()
  })

  it('lists each kept copy by what it was', () => {
    show(makeStorage({
      ...base,
      [`${P}planner.2026-W26.1000`]: '{"a":', [`${P}notes.data.2000`]: '[{"id"',
      [`${P}timelog.v1.data.3000`]: '{"entries":[', [`${P}offline-queue.data.4000`]: '[{"id":"1',
    }))
    expect(screen.getByText('Recovered copies')).toBeTruthy()
    for (const label of ['Planner week 2026-W26', 'Planner notes', 'Time log', 'Offline queue']) expect(screen.getByText(label)).toBeTruthy()
  })

  it('saves the text of a copy to a file, so it can be looked at', async () => {
    const fileIO = show(makeStorage({ ...base, [`${P}timelog.v1.data.3000`]: '{"entries":[' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Time log as file' }))
    await vi.waitFor(() => expect(fileIO.saveFile).toHaveBeenCalledTimes(1))
    const [name, text] = fileIO.saveFile.mock.calls[0]
    expect(name).toMatch(/^nexusmd-damaged-timelog-v1-data-.*\.txt$/)
    expect(text).toBe('{"entries":[')
  })

  it('removes a copy after it is confirmed, and only that copy', () => {
    const storage = makeStorage({ ...base, [`${P}notes.data.2000`]: 'x', [`${P}timelog.v1.data.3000`]: 'y' })
    show(storage)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Planner notes' }))
    expect(storage.has(`${P}notes.data.2000`)).toBe(true) // asks first
    fireEvent.click(screen.getByRole('button', { name: 'Remove for good' }))
    expect(storage.has(`${P}notes.data.2000`)).toBe(false)
    expect(storage.has(`${P}timelog.v1.data.3000`)).toBe(true)
    expect(screen.queryByText('Planner notes')).toBeNull()
    expect(screen.getByText('Time log')).toBeTruthy()
  })

  it('says so when the file could not be saved', async () => {
    const fileIO = { saveFile: vi.fn(async () => { throw new Error('disk full') }) }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    show(makeStorage({ ...base, [`${P}notes.data.2000`]: 'x' }), fileIO)
    fireEvent.click(screen.getByRole('button', { name: 'Save Planner notes as file' }))
    expect(await screen.findByText(/could not be saved/)).toBeTruthy()
    console.warn.mockRestore()
  })
})
