import React from 'react'
import { VsCard, VsRow, VsSeg, PlToggle, VsPasswordModal, loadConfidentialConfig } from '@nexusmd/ui'
import { getProfileKey } from '@nexusmd/shell-sdk'

export function DesktopPlannerPrefsCard() {
  const pk = k => { try { return getProfileKey(k) } catch { return k } }
  const readPref = (key, def) => { try { return localStorage.getItem(pk(key)) || def } catch { return def } }
  const savePref = (key, val) => { try { localStorage.setItem(pk(key), val) } catch {} }

  const [landing, setLanding] = React.useState(() => readPref('nexusmd.planner.landing', 'glance'))
  const [nav,     setNav]     = React.useState(() => readPref('nexusmd.planner.nav', 'rail'))
  const [entry,   setEntry]   = React.useState(() => readPref('nexusmd.planner.entry', 'inline'))
  const [carry,   setCarry]   = React.useState(() => readPref('nexusmd.planner.carryPrompt', '1'))

  return (
    <VsCard title="Planner" icon="planner">
      <VsRow title="Landing view" desc="First view when opening the Planner">
        <VsSeg value={landing}
          options={[['glance','Glance'],['week','Week'],['month','Month']]}
          onChange={v => { setLanding(v); savePref('nexusmd.planner.landing', v) }} />
      </VsRow>
      <VsRow title="Navigation style" desc="How the planner nav is displayed">
        <VsSeg value={nav}
          options={[['rail','Rail'],['tabs','Tabs']]}
          onChange={v => { setNav(v); savePref('nexusmd.planner.nav', v) }} />
      </VsRow>
      <VsRow title="Entry style" desc="How new planner entries are created">
        <VsSeg value={entry}
          options={[['inline','Inline'],['modal','Modal']]}
          onChange={v => { setEntry(v); savePref('nexusmd.planner.entry', v) }} />
      </VsRow>
      <VsRow title="Carry-over prompt" desc="Prompt to carry unfinished tasks forward each week">
        <PlToggle checked={carry === '1'}
          onChange={v => { const s = v ? '1' : '0'; setCarry(s); savePref('nexusmd.planner.carryPrompt', s) }} />
      </VsRow>
    </VsCard>
  )
}

export function DesktopConfidentialCard() {
  const [pwOpen, setPwOpen] = React.useState(false)
  const [autoRelock, setAutoRelock] = React.useState(() => {
    try { return localStorage.getItem('nexusmd.confidential.autoRelock') || '0' } catch { return '0' }
  })
  const cfg = loadConfidentialConfig() || { sections: [], hash: null }
  const lockedCount = (cfg.sections || []).filter(s => s.locked).length

  return (
    <VsCard title="Confidential" icon="lock">
      <VsRow title="Password" desc={cfg.hash ? 'A password is set for confidential sections' : 'No password set — anyone can view confidential rows'}>
        <button className="btn sm ghost" onClick={() => setPwOpen(true)}>
          {cfg.hash ? 'Change password' : 'Set password'}
        </button>
      </VsRow>
      <VsRow title="Auto re-lock" desc="Re-lock confidential sections when the app loses focus">
        <PlToggle checked={autoRelock === '1'} onChange={v => {
          const s = v ? '1' : '0'; setAutoRelock(s)
          try { localStorage.setItem('nexusmd.confidential.autoRelock', s) } catch {}
        }} />
      </VsRow>
      {lockedCount > 0 && (
        <VsRow title="Locked sections" desc={`${lockedCount} section${lockedCount !== 1 ? 's' : ''} currently locked in the planner`}>
          <span className="pill">{lockedCount}</span>
        </VsRow>
      )}
      <VsPasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </VsCard>
  )
}
