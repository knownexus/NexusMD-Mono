import React from 'react'
import { Icon, VsCard, VsRow, toast } from '@nexusmd/ui'

const bridge = () => (typeof window !== 'undefined' ? window.electronAPI?.appUpdates : undefined)

const names = list => {
  const labels = list.map(u => u.label)
  return labels.length < 2 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
}

export function readyText(pending) {
  if (pending.length === 1) return `${pending[0].label} ${pending[0].to} is ready.`
  return `Updates are ready for ${names(pending)}.`
}

// What applying would interrupt, as one question for the user.
export function busyQuestion(busy) {
  const parts = busy.map(b => {
    const windows = b.windows === 1 ? '1 window open' : `${b.windows} windows open`
    if (b.running && b.windows) return `${b.label} is running something and has ${windows}`
    return b.running ? `${b.label} is running something` : `${b.label} has ${windows}`
  })
  return `${parts.join('; ')}. Updating stops it and closes its windows. Update now?`
}

// Downloaded app updates and applying them without restarting NexusMD: the updated apps restart
// in the background and the window reloads. `confirm` asks before interrupting a busy app.
export function useAppUpdates({ api = bridge(), confirm = q => window.confirm(q) } = {}) {
  const [pending, setPending] = React.useState([])
  const [applying, setApplying] = React.useState(false)
  const [applied, setApplied] = React.useState(false)

  React.useEffect(() => {
    if (!api) return undefined
    let live = true
    Promise.resolve(api.pending()).then(p => { if (live) setPending(p || []) }).catch(() => {})
    const off = api.onReady(ready => setPending(ready || []))
    return () => { live = false; off?.() }
  }, [api])

  const apply = React.useCallback(async () => {
    setApplying(true)
    try {
      let result = await api.apply({ force: false })
      if (result.busy?.length) {
        if (!confirm(busyQuestion(result.busy))) return
        result = await api.apply({ force: true })
      }
      if (result.failed?.length) toast?.(`Couldn't update ${names(result.failed)}: ${result.failed[0].error}`, 'error')
      if (result.applied?.length) setApplied(true)
    } catch (e) {
      toast?.(`Couldn't update: ${e?.message || e}`, 'error')
    } finally {
      setApplying(false)
    }
  }, [api, confirm])

  return { enabled: !!api, pending, setPending, applying, applied, apply }
}

// Under the top bar when an app update has been downloaded.
export function AppUpdatesBanner({ api, confirm }) {
  const { enabled, pending, applying, applied, apply } = useAppUpdates({ api, confirm })
  const [dismissed, setDismissed] = React.useState(null)
  const key = pending.map(u => `${u.id}@${u.to}`).join(',')
  if (!enabled || !pending.length || dismissed === key) return null
  return (
    <div role="status" style={{
      background: 'var(--accent-soft)', borderBottom: '1px solid var(--accent-border)',
      padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, flexShrink: 0,
    }}>
      <Icon name="download" size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
      <span style={{ flex: 1 }}>
        {applied ? 'Updating… the window reloads in a moment.' : `${readyText(pending)} The window reloads to update; NexusMD keeps running.`}
      </span>
      {applied
        ? <button className="btn sm ghost" onClick={() => window.location.reload()}>Reload now</button>
        : <button className="btn sm primary" disabled={applying} onClick={apply}>Update now</button>}
      {!applied && (
        <button className="btn sm ghost" aria-label="Later" title="Later" onClick={() => setDismissed(key)}>
          <Icon name="x" size={12} />
        </button>
      )}
    </div>
  )
}

// Settings → Desktop: check now instead of waiting for the next check (at launch, then every 6 hours).
export function AppUpdatesCard({ api, confirm }) {
  const { enabled, pending, setPending, applying, apply } = useAppUpdates({ api, confirm })
  const [checking, setChecking] = React.useState(false)
  const [status, setStatus] = React.useState(null)
  if (!enabled) return null

  const check = async () => {
    setChecking(true)
    try {
      const r = await (api ?? bridge()).check()
      setPending(r.pending || [])
      setStatus(!r.enabled ? 'App updates are only checked in the installed app.'
        : r.error ? `Couldn't check: ${r.error}`
          : r.pending?.length ? null : 'All apps are up to date.')
    } catch (e) {
      setStatus(`Couldn't check: ${e?.message || e}`)
    } finally {
      setChecking(false)
    }
  }

  return (
    <VsCard title="App updates" icon="download">
      <VsRow title="Check for app updates" desc={status || 'Checked when NexusMD starts, then every 6 hours'}>
        <button className="btn sm" disabled={checking} onClick={check}>{checking ? 'Checking…' : 'Check now'}</button>
      </VsRow>
      {pending.length > 0 && (
        <VsRow title={readyText(pending)} desc="The window reloads to update; NexusMD keeps running">
          <button className="btn sm primary" disabled={applying} onClick={apply}>Update now</button>
        </VsRow>
      )}
    </VsCard>
  )
}
