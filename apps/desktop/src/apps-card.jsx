import React from 'react'
import { VsCard, VsRow, PlToggle, toast } from '@nexusmd/ui'
import { registry } from './shell/registry.js'

const api = () => (typeof window !== 'undefined' ? window.electronAPI?.registry : undefined)

// Switch installed apps on and off. A switched-off app is left out as if it weren't installed: no
// sidebar entry, screens, settings or background work. Apps wire themselves up at startup, so a
// change is saved at once and applies when the app restarts. Shown only with two or more apps.
export function AppsCard({ reg = registry }) {
  const installed = reg.installedApps
  const running = React.useMemo(() => new Set(reg.apps.map(a => a.id)), [reg])
  const [off, setOff] = React.useState(() => installed.filter(a => !running.has(a.id)).map(a => a.id))
  const [busy, setBusy] = React.useState(false)

  if (installed.length < 2 || !api()?.setDisabled) return null

  const changed = installed.some(a => off.includes(a.id) === running.has(a.id))

  const toggle = (id, on) => {
    const next = on ? off.filter(x => x !== id) : [...off, id]
    if (next.length >= installed.length) { toast?.('At least one app has to stay on.', 'error'); return }
    setOff(next)
    Promise.resolve(api().setDisabled(next)).catch(() => toast?.('Could not save the change.', 'error'))
  }

  const restart = async () => {
    setBusy(true)
    try { await api().setDisabled(off, { restart: true }) }
    catch { toast?.('Could not restart.', 'error'); setBusy(false) }
  }

  return (
    <VsCard title="Apps" icon="dashboard">
      {installed.map(a => (
        <VsRow key={a.id} title={a.label} desc={off.includes(a.id) ? 'Off' : 'On'}>
          <PlToggle checked={!off.includes(a.id)} onChange={v => toggle(a.id, v)} />
        </VsRow>
      ))}
      {changed && (
        <VsRow title="Restart to apply" desc="Apps are switched on and off when NexusMD starts">
          <button className="btn sm" disabled={busy} onClick={restart}>Restart now</button>
        </VsRow>
      )}
    </VsCard>
  )
}
