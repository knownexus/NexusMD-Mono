import React from 'react'
import { PlannerView, plannerExportDocx, toast } from '@nexusmd/ui'
import { getProfileKey } from '@nexusmd/shell-sdk'
import { usePlannerStore } from './planner-store.js'

// The Planner screen: PlannerView bound to the Planner's own store, with the user's Planner
// preferences (set in Settings) read when the screen opens.
export function PlannerApp({ host }) {
  const [data, setData, themes, setThemes] = usePlannerStore()

  const pk = k => { try { return getProfileKey(k) } catch { return k } }
  const readPref = (key, def) => { try { return localStorage.getItem(pk(key)) || def } catch { return def } }
  const prefs = {
    landing:     readPref('nexusmd.planner.landing', 'glance'),
    nav:         readPref('nexusmd.planner.nav', 'rail'),
    entry:       readPref('nexusmd.planner.entry', 'inline'),
    carryPrompt: readPref('nexusmd.planner.carryPrompt', '1') === '1',
  }

  const cloudSync = async () => {
    try {
      const r = await host.sync.syncOnce()
      if (r.skipped === 'no-key') toast?.('Set a sync passphrase in Settings first.', 'info')
      else if (r.skipped === 'no-provider') toast?.('Select a cloud provider in Settings first.', 'info')
      else if (r.skipped === 'not-connected') toast?.('Connect your cloud provider in Settings first.', 'info')
      else if (r.skipped === 'bad-passphrase') toast?.('Wrong passphrase — fix it in Settings.', 'error')
      else if (!r.skipped) toast?.(`Backed up — pushed ${r.pushed}, pulled ${r.pulled}, merged ${r.merged}.`, 'success')
    } catch (err) { toast?.('Cloud sync failed: ' + (err?.message || 'unknown error'), 'error') }
  }

  return (
    <PlannerView
      data={data}
      setData={setData}
      themes={themes}
      setThemes={setThemes}
      onExportDocx={plannerExportDocx}
      landing={prefs.landing}
      navStyle={prefs.nav}
      entryStyle={prefs.entry}
      carryPrompt={prefs.carryPrompt}
      showGlobalNotesTab={false}
      onCloudSync={cloudSync}
    />
  )
}
