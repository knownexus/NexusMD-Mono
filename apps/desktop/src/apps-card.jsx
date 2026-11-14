import React from 'react'
import { VsCard, VsRow, PlToggle, toast } from '@nexusmd/ui'
import { registry } from './shell/registry.js'
import { getDisabledApps, setDisabledApps } from './shell/apps-disabled.js'

const api = () => (typeof window !== 'undefined' ? window.electronAPI?.registry : undefined)

// Switch installed apps on and off. A switched-off app is left out as if it weren't installed: no
// sidebar entry, screens or settings, and it shows or goes at once, with no restart. Its background part stops
// when NexusMD next starts. The one case that still needs a restart is switching on an app that was already
// off when NexusMD started: its code was never loaded. Shown only with two or more apps.
export function AppsCard({ reg = registry }) {
  const installed = reg.installedApps
  const running = React.useMemo(() => new Set(reg.apps.map(a => a.id)), [reg])
  // What the window follows (it survives a reload), else what was off at start.
  const [off, setOff] = React.useState(() => getDisabledApps() ?? installed.filter(a => !running.has(a.id)).map(a => a.id))
  const [busy, setBusy] = React.useState(false)

  if (installed.length < 2 || !api()?.setDisabled) return null

  // An app that is on but not running: it was off when NexusMD started, so it needs a restart to come on.
  const waiting = installed.filter(a => !off.includes(a.id) && !running.has(a.id))

  const toggle = (id, on) => {
    const next = on ? off.filter(x => x !== id) : [...off, id]
    if (next.length >= installed.length) { toast?.('At least one app has to stay on.', 'error'); return }
    setOff(next)
    setDisabledApps(next) // shown or hidden at once
    Promise.resolve(api().setDisabled(next)).catch(() => toast?.('Could not save the change.', 'error'))
  }

  const restart = async () => {
    setBusy(true)
    try { await api().setDisabled(off, { restart: true }) }
    catch { toast?.('Could not restart.', 'error'); setBusy(false) }
  }

  const describe = (a) => {
    if (off.includes(a.id)) return 'Off'
    return running.has(a.id) ? 'On' : 'On after a restart'
  }

  return (
    <VsCard title="Apps" icon="dashboard">
      {installed.map(a => (
        <VsRow key={a.id} title={a.label} desc={describe(a)}>
          <PlToggle checked={!off.includes(a.id)} onChange={v => toggle(a.id, v)} />
        </VsRow>
      ))}
      {waiting.length > 0 && (
        <VsRow title="Restart to turn on" desc={`${waiting.map(a => a.label).join(', ')} ${waiting.length === 1 ? 'was' : 'were'} off when NexusMD started, so ${waiting.length === 1 ? 'it' : 'they'} come${waiting.length === 1 ? 's' : ''} on after a restart`}>
          <button className="btn sm" disabled={busy} onClick={restart}>Restart now</button>
        </VsRow>
      )}
    </VsCard>
  )
}
