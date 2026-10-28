import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('@nexusmd/ui', () => ({
  VsCard: ({ children }) => <div>{children}</div>,
  VsRow: ({ title, children }) => <div><span>{title}</span><div>{children}</div></div>,
  BoardColumnsCard: () => <div>BoardColumnsCard</div>,
  CardsAndTablesSettings: () => <div>CardsAndTablesSettings</div>,
  toast: vi.fn(),
  WI_TYPE_STATES_CACHE_KEY: 'nexusmd.wi.wiTypeStates.cache',
}))
vi.mock('./ado-settings.jsx', () => ({ AdoConnectionCard: () => <div>AdoConnectionCard</div> }))
vi.mock('./jira-settings.jsx', () => ({ JiraConnectionCard: () => <div>JiraConnectionCard</div>, WorkItemsDisplayCard: () => <div>WorkItemsDisplayCard</div> }))

import { WorkContext } from './work-context.js'
import { WorkDataRows, WorkIntegrationsPanel, WorkBoardPanel, WorkCardsPanel } from './work-settings.jsx'

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

const withWork = (ui, work = {}) => render(
  <WorkContext.Provider value={{ refreshInterval: 300, setRefreshInterval: vi.fn(), refreshAllData: vi.fn().mockResolvedValue(), ...work }}>{ui}</WorkContext.Provider>,
)

describe('WorkDataRows (the refresh interval and cache rows of Data & sync)', () => {
  it('shows the current interval', () => {
    withWork(<WorkDataRows />)
    expect(screen.getByRole('spinbutton').value).toBe('300')
  })

  it('reports a new interval and keeps it for next time', () => {
    const setRefreshInterval = vi.fn()
    withWork(<WorkDataRows />, { setRefreshInterval })
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '120' } })
    expect(setRefreshInterval).toHaveBeenCalledWith(120)
    expect(localStorage.getItem('nexusmd.refreshInterval')).toBe('120')
  })

  it('keeps the interval between 10 and 3600 seconds', () => {
    const setRefreshInterval = vi.fn()
    withWork(<WorkDataRows />, { setRefreshInterval })
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } })
    expect(setRefreshInterval).toHaveBeenLastCalledWith(10)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '9999' } })
    expect(setRefreshInterval).toHaveBeenLastCalledWith(3600)
  })

  it('clears only the cache keys (ADO, Jira, GitHub, type states) and re-fetches when Clear cache is clicked', () => {
    const refreshAllData = vi.fn().mockResolvedValue()
    localStorage.setItem('nexusmd.ado.cache.v1', '{"WORK_ITEMS":[]}')
    localStorage.setItem('nexusmd.wi.wiTypeStates.cache', '{}')
    localStorage.setItem('nexusmd.jira.cache.v1', '{"WORK_ITEMS":[]}')
    localStorage.setItem('nexusmd.github.cache.v1', '{"WORK_ITEMS":[]}')
    localStorage.setItem('nexusmd.ado.org', 'acme')
    localStorage.setItem('nexusmd.planner.week.2026-W27', 'notes')
    withWork(<WorkDataRows />, { refreshAllData })
    fireEvent.click(screen.getByRole('button', { name: 'Clear cache' }))

    expect(localStorage.getItem('nexusmd.ado.cache.v1')).toBeNull()
    expect(localStorage.getItem('nexusmd.wi.wiTypeStates.cache')).toBeNull()
    expect(localStorage.getItem('nexusmd.jira.cache.v1')).toBeNull()
    expect(localStorage.getItem('nexusmd.github.cache.v1')).toBeNull()
    expect(localStorage.getItem('nexusmd.ado.org')).toBe('acme')
    expect(localStorage.getItem('nexusmd.planner.week.2026-W27')).toBe('notes')
    expect(refreshAllData).toHaveBeenCalledTimes(1)
  })

  it('does not ask for confirmation or reload for Clear cache', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    withWork(<WorkDataRows />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear cache' }))
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('shows nothing, rather than failing, outside Work\'s provider', () => {
    const { container } = render(<WorkDataRows />)
    expect(container.textContent).toBe('')
  })
})

describe('the other Work panels', () => {
  it('Integrations holds the Azure DevOps and Jira cards', () => {
    withWork(<WorkIntegrationsPanel />)
    for (const name of ['AdoConnectionCard', 'JiraConnectionCard', 'WorkItemsDisplayCard']) expect(screen.getByText(name)).toBeTruthy()
  })
  it("Integrations shows nothing, rather than failing, outside Work's provider", () => {
    const { container } = render(<WorkIntegrationsPanel />)
    expect(container.textContent).toBe('')
  })
  it('the board and cards panels hold the shared settings cards', () => {
    render(<><WorkBoardPanel /><WorkCardsPanel /></>)
    expect(screen.getByText('BoardColumnsCard')).toBeTruthy()
    expect(screen.getByText('CardsAndTablesSettings')).toBeTruthy()
  })
})
