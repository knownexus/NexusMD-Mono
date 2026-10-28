import React from 'react'
import { VsCard, VsRow, BoardColumnsCard, CardsAndTablesSettings, toast, WI_TYPE_STATES_CACHE_KEY } from '@nexusmd/ui'
import { ADO_CACHE_KEY, JIRA_CACHE_KEY, GITHUB_CACHE_KEY } from '@nexusmd/core'
import { AdoConnectionCard } from './ado-settings.jsx'
import { JiraConnectionCard, WorkItemsDisplayCard } from './jira-settings.jsx'
import { QuickLinksCard } from './quick-links-card.jsx'
import { useOptionalWork } from './work-context.js'

// Settings → Integrations: where Azure DevOps and Jira are connected.
export function WorkIntegrationsPanel() {
  const work = useOptionalWork()
  if (!work) return null
  const { refreshAllData } = work
  return (
    <>
      <AdoConnectionCard onRefreshData={refreshAllData} />
      <JiraConnectionCard onRefreshData={refreshAllData} />
      <WorkItemsDisplayCard />
    </>
  )
}

// Settings → Planner: the board's columns are Work's.
export function WorkBoardPanel() {
  return <BoardColumnsCard />
}

// Settings → Cards & Tables.
export function WorkCardsPanel({ tweaks, setTweak }) {
  return (
    <>
      <CardsAndTablesSettings />
      {setTweak && <QuickLinksCard links={tweaks?.quickLinks || []} onChange={links => setTweak('quickLinks', links)} />}
    </>
  )
}

// Rows for the shell's "Data & sync" card: how often the data refreshes, and dropping its cache.
export function WorkDataRows() {
  const work = useOptionalWork()
  if (!work) return null
  const { refreshInterval, setRefreshInterval, refreshAllData } = work

  const clearCache = () => {
    try {
      localStorage.removeItem(ADO_CACHE_KEY)
      localStorage.removeItem(JIRA_CACHE_KEY)
      localStorage.removeItem(GITHUB_CACHE_KEY)
      localStorage.removeItem(WI_TYPE_STATES_CACHE_KEY)
    } catch {}
    toast?.('Cache cleared — refreshing…', 'success')
    refreshAllData().catch(() => {})
  }

  return (
    <>
      <VsRow title="Auto-refresh interval" desc="Seconds between automatic ADO data refreshes (10–3600)">
        <input type="number" min={10} max={3600} step={10}
          aria-label="Auto-refresh interval"
          value={refreshInterval}
          style={{ width: 80, padding: '5px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', font: 'inherit', fontSize: 13, color: 'var(--text)' }}
          onChange={e => {
            const v = Math.max(10, Math.min(3600, parseInt(e.target.value, 10) || 300))
            setRefreshInterval(v)
            try { localStorage.setItem('nexusmd.refreshInterval', String(v)) } catch {}
          }}
        />
      </VsRow>
      <VsRow title="Clear cache" desc="Drop the cached ADO and Jira data and re-fetch — keeps profiles, settings, and planner notes">
        <button className="btn sm ghost" onClick={clearCache}>Clear cache</button>
      </VsRow>
    </>
  )
}
