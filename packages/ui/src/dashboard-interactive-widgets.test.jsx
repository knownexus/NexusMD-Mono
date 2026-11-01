import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TimeWidget, LatestBuild, storageTimerStore } from './dashboard-interactive-widgets.jsx'

afterEach(cleanup)

const memoryStorage = () => {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m }
}

describe('TimeWidget (shared)', () => {
  it('starts, pauses, resumes and stops a timer through the timer store it is given', () => {
    const storage = memoryStorage()
    const timer = storageTimerStore({ storage, logKey: 'tl', pausedKey: 'tp' })
    const log = () => JSON.parse(storage.getItem('tl'))
    render(<TimeWidget timer={timer} navTo={() => {}}/>)
    fireEvent.change(screen.getByPlaceholderText('What are you working on?'), { target: { value: 'Review' } })
    fireEvent.click(screen.getByRole('button', { name: /Start/ }))
    expect(log().entries[0]).toMatchObject({ label: 'Review', end: null })
    fireEvent.click(screen.getByRole('button', { name: /Pause/ }))
    expect(log().entries[0].end).not.toBeNull()
    expect(JSON.parse(storage.getItem('tp'))[0]).toMatchObject({ label: 'Review' })
    fireEvent.click(screen.getByRole('button', { name: /Resume/ }))
    expect(log().entries.filter(e => e.end == null)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }))
    expect(log().entries.filter(e => e.end == null)).toHaveLength(0)
  })
})

describe('LatestBuild (shared)', () => {
  it('offers Artifacts and Bug only when the app supplies them', () => {
    const build = { id: 1, pipeline: 'P', status: 'failed', branch: 'refs/heads/main' }
    render(<LatestBuild build={build} navTo={() => {}}/>)
    expect(screen.queryByText('Artifacts')).toBeNull()
    expect(screen.queryByText(/Bug/)).toBeNull()
    cleanup()
    const onCreateBug = vi.fn()
    const ArtifactsSheet = ({ build: b }) => (b ? <div>sheet for {b.pipeline}</div> : null)
    render(<LatestBuild build={build} navTo={() => {}} onCreateBug={onCreateBug} ArtifactsSheet={ArtifactsSheet}/>)
    fireEvent.click(screen.getByText('Artifacts'))
    expect(screen.getByText('sheet for P')).toBeTruthy()
    fireEvent.click(screen.getByText(/Bug/))
    expect(onCreateBug).toHaveBeenCalledWith(expect.objectContaining({ title: 'Build failed: P', tags: 'build;ci' }))
  })
})
