import React from 'react'
import { readLists, writeLists } from '@nexusmd/core'
import { ListsView, useNexusData, useProfile, toast } from '@nexusmd/ui'
import { getProfileKey } from '@nexusmd/shell-sdk'
import { useTeamRoster } from './work-views.jsx'

// Lists: the custom trackers of a manual profile (the shared Lists view, as on mobile). They live at
// getProfileKey('nexusmd.lists') as the core Lists model, which is also the key the `lists` sync
// collection reads and writes, so a pull lands here and a change here goes out with the next sync.

const store = () => ({ storage: localStorage, getProfileKey, namespace: 'nexusmd' })
const readDisplayName = () => {
  try { return localStorage.getItem(getProfileKey('nexusmd.profile.displayName')) || '' } catch { return '' }
}

// Lists are only for manual profiles; for the others the sidebar entry stays off (see index.js).
export function useListsHidden() {
  const { activeProfile } = useProfile() || {}
  return activeProfile?.type !== 'manual'
}

export function ListsApp() {
  const { data: nexus } = useNexusData() || {}
  const { effectiveTeam } = useTeamRoster(nexus || {})
  const { activeProfile } = useProfile() || {}
  const [data, setData] = React.useState(() => readLists(store()))

  // Another profile's lists, or a sync pull that changed this one's: read them again.
  React.useEffect(() => { setData(readLists(store())) }, [activeProfile?.id])
  React.useEffect(() => {
    const onApplied = e => { if (e?.detail?.collId === 'lists') setData(readLists(store())) }
    document.addEventListener('nexusmd:sync-applied', onApplied)
    return () => document.removeEventListener('nexusmd:sync-applied', onApplied)
  }, [])

  const onChange = next => {
    setData(next)
    try { writeLists(store(), next) } catch { toast?.('Could not save the list.', 'error') }
  }

  return (
    <ListsView data={data} onChange={onChange} toast={toast} device="desktop"
      team={effectiveTeam} displayName={readDisplayName()} />
  )
}
