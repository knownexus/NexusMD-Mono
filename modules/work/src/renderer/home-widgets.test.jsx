import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'

let profile = { activeProfile: { type: 'manual' } }
const hostCtx = []
vi.mock('@nexusmd/ui', async importOriginal => {
  const ui = await importOriginal()
  return {
    ...ui,
    useProfile: () => profile,
    // The real host, recording the ctx it was given.
    WidgetHost: props => { hostCtx.push(props.ctx); return ui.WidgetHost(props) },
  }
})
vi.mock('@nexusmd/shell-sdk', async importOriginal => ({
  ...(await importOriginal()),
  getProfileKey: k => `nexusmd.p.p1.${k}`,
}))

import { NexusDataProvider } from '@nexusmd/ui'
import { WorkContext } from './work-context.js'
import { HomeWidgets, desktopOffPages } from './home-widgets.jsx'
import { setOffScreens, resetOffScreensCache } from './work-screens.js'

const DATA = {
  WORK_ITEMS: [{ id: 1, title: 'Fix login', assignee: 'me', state: 'Active' }],
  PRS: [], BUILDS: [{ id: 'b1', pipeline: 'CI', status: 'succeeded' }], TESTS: [],
  ME: { id: 'me' },
}
const allInstalled = { isInstalled: () => true, capabilities: { has: () => false } }

// Holds the tweaks like the shell does, so a save shows up on the next render.
function Harness({ host = allInstalled, initial = [], onSet = () => {} }) {
  const [tweaks, setTweaks] = React.useState({ homeWidgets: initial })
  const setTweak = (k, v) => { onSet(k, v); setTweaks(t => ({ ...t, [k]: v })) }
  return <HomeWidgets host={host} tweaks={tweaks} setTweak={setTweak} team={[{ id: 'p1', name: 'Pat' }]} />
}
function mount(ui, data = DATA) {
  const work = { openItem: vi.fn(), openPR: vi.fn() }
  return render(
    <NexusDataProvider value={{ data }}>
      <WorkContext.Provider value={work}>{ui}</WorkContext.Provider>
    </NexusDataProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  resetOffScreensCache()
  profile = { activeProfile: { type: 'manual' } }
  hostCtx.length = 0
})
afterEach(cleanup)

describe('Home widgets on the desktop Dashboard', () => {
  it('Add widget opens the sheet, saving adds a widget, removing deletes it', () => {
    const onSet = vi.fn()
    mount(<Harness onSet={onSet} />)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Add widget/ }))
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByText('Add a widget')).toBeTruthy()
    fireEvent.click(within(sheet).getByText('Assigned to me'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add widget' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    const saved = onSet.mock.calls.at(-1)
    expect(saved[0]).toBe('homeWidgets')
    expect(saved[1]).toHaveLength(1)
    expect(saved[1][0]).toMatchObject({ type: 'mywork', config: { count: 5 } })
    // The widget shows, with the profile's own work in it.
    expect(screen.getByText('Fix login')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Assigned to me widget' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }))
    expect(onSet).toHaveBeenLastCalledWith('homeWidgets', [])
    expect(screen.queryByText('Fix login')).toBeNull()
  })

  it('renders the sheet in a full-window overlay', () => {
    mount(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /Add widget/ }))
    const veil = screen.getByRole('dialog').closest('.m-sheet-veil')
    expect(veil.parentElement.classList.contains('m-sheet-overlay')).toBe(true)
    expect(veil.parentElement.parentElement).toBe(document.body)
  })

  it('a widget for a switched-off app is hidden', () => {
    setOffScreens(['builds'])
    const host = { isInstalled: id => id !== 'time', capabilities: { has: () => false } }
    mount(<Harness host={host} initial={[
      { id: 'w1', type: 'builds', config: { count: 3 } },
      { id: 'w2', type: 'time', config: {} },
      { id: 'w3', type: 'mywork', config: { count: 5 } },
    ]} />)
    expect(screen.queryByText('Builds')).toBeNull()
    expect(screen.queryByText('CI')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit Time widget' })).toBeNull()
    expect(screen.getByText('Fix login')).toBeTruthy()

    // Nor are they offered.
    fireEvent.click(screen.getByRole('button', { name: /Add widget/ }))
    const sheet = within(screen.getByRole('dialog'))
    expect(sheet.queryByText('Builds')).toBeNull()
    expect(sheet.queryByText('Time')).toBeNull()
    expect(sheet.getByText('Assigned to me')).toBeTruthy()
  })

  it('offers no widget it has no desktop data for, and maps the screen names', () => {
    expect(desktopOffPages({ workOff: ['prs'], listsHidden: true, isInstalled: () => true }))
      .toEqual(expect.arrayContaining(['pr', 'lists', 'calendar', 'git']))
    expect(desktopOffPages({ workOff: [], listsHidden: false, isInstalled: () => true })).not.toContain('lists')
    expect(desktopOffPages({ workOff: [], listsHidden: false, isInstalled: id => id !== 'planner' })).toContain('planner')
  })

  it('passes the same timer store across re-renders', () => {
    const { rerender } = mount(<Harness initial={[{ id: 'w1', type: 'time', config: {} }]} />)
    rerender(
      <NexusDataProvider value={{ data: { ...DATA, PRS: [{ id: 9 }] } }}>
        <WorkContext.Provider value={{ openItem: vi.fn(), openPR: vi.fn() }}>
          <Harness initial={[{ id: 'w1', type: 'time', config: {} }]} />
        </WorkContext.Provider>
      </NexusDataProvider>,
    )
    expect(hostCtx.length).toBeGreaterThan(1)
    expect(hostCtx[0].timer).toBeTruthy()
    for (const c of hostCtx) expect(c.timer).toBe(hostCtx[0].timer)
  })

  it('keeps the timer log where the Time screen keeps it, and reads the profile\'s lists', () => {
    localStorage.setItem('nexusmd.p.p1.nexusmd.lists', JSON.stringify({ lists: [{ id: 'l1', name: 'Groceries', items: [{ id: 'i1' }] }] }))
    mount(<Harness initial={[{ id: 'w1', type: 'lists', config: { count: 5 } }]} />)
    expect(screen.getByText('Groceries')).toBeTruthy()
    const { timer } = hostCtx.at(-1)
    timer.save({ entries: [] })
    expect(localStorage.getItem('nexusmd.p.p1.nexusmd.timelog.v1')).toBe('{"entries":[]}')
  })
})
