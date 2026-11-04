import React from 'react'
import { core, syncLabel, offlineText, readProviderStatus, profileCacheStorage } from '@nexusmd/core'
import { Icon } from '@nexusmd/ui'
import { localStorageAdapter } from '@nexusmd/web-adapters'
import { getProfileKey } from './profile-keys.js'
import { appQueue } from './offline-queue-app.js'

// How often the "Updated 5m ago" line is worked out again.
export const SYNC_TICK_MS = 30000

// When the work data last loaded: the newest successful provider refresh that core records
// (readProviderStatus: { ado: { status: 'ok', at }, ... }), as mobile's HelmData.loadedAt is. A failed
// refresh keeps its cached data, so it does not count. Null before anything has loaded.
export function lastLoadedAt(status) {
  const times = Object.values(status && typeof status === 'object' ? status : {})
    .filter(s => s?.status === 'ok' && Number.isFinite(s.at))
    .map(s => s.at)
  return times.length ? Math.max(...times) : null
}

// The status is kept per profile.
const statusStorage = profileCacheStorage(localStorageAdapter, getProfileKey)
const readLoadedAtFromStorage = () => lastLoadedAt(readProviderStatus(statusStorage))
const readQueueCount = () => appQueue.count()
const subscribeCoreData = (fn) => { core.on('data:updated', fn); return () => core.off('data:updated', fn) }
const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false)

// The sidebar's sync line: "Updated 5m ago", and when offline what is waiting to be sent. Re-renders every
// `tickMs` so the age stays right; the timer goes with the component. In the icon rail it is an icon whose
// accessible name and tooltip carry the text.
export function SyncIndicator({ loadedAt, online = true, pending = 0, iconsOnly = false, tickMs = SYNC_TICK_MS }) {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), tickMs)
    return () => clearInterval(t)
  }, [tickMs])
  // A load newer than the last tick is "just now", not in the future.
  const updated = syncLabel(loadedAt, Math.max(now, loadedAt || 0))
  const offline = online ? '' : offlineText(pending)
  if (!updated && !offline) return null

  if (iconsOnly) {
    const text = [updated, offline].filter(Boolean).join('. ')
    return (
      <div role="img" aria-label={text} title={text} className="sidebar-sync"
        style={{ display: 'flex', justifyContent: 'center', padding: '6px 0', color: offline ? 'var(--warning, var(--accent))' : 'var(--text-subtle)' }}>
        <Icon name="refresh" size={14} />
      </div>
    )
  }
  return (
    <div className="sidebar-sync" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 10px', fontSize: 11, color: 'var(--text-subtle)' }}>
      {updated && <span>{updated}</span>}
      {offline && <span role="status" style={{ color: 'var(--warning, var(--text-muted))' }}>{offline}</span>}
    </div>
  )
}

// The live status: the load time (re-read on every data refresh), the connection, and the offline
// queue's count (offline-queue-app.js says when it changes with `nexusmd:queue`). The sources are
// injectable for tests.
export function useSyncStatus({ readLoadedAt = readLoadedAtFromStorage, readPending = readQueueCount, subscribeData = subscribeCoreData } = {}) {
  const [loadedAt, setLoadedAt] = React.useState(() => readLoadedAt())
  const [pending, setPending] = React.useState(() => readPending())
  const [online, setOnline] = React.useState(isOnline)
  React.useEffect(() => subscribeData(() => setLoadedAt(readLoadedAt())), [subscribeData, readLoadedAt])
  React.useEffect(() => {
    const onQueue = e => setPending(Number.isFinite(e.detail?.count) ? e.detail.count : readPending())
    const onFlushed = () => setPending(readPending())
    const onNet = () => setOnline(isOnline())
    window.addEventListener('nexusmd:queue', onQueue)
    window.addEventListener('nexusmd:queue-flushed', onFlushed)
    window.addEventListener('online', onNet)
    window.addEventListener('offline', onNet)
    return () => {
      window.removeEventListener('nexusmd:queue', onQueue)
      window.removeEventListener('nexusmd:queue-flushed', onFlushed)
      window.removeEventListener('online', onNet)
      window.removeEventListener('offline', onNet)
    }
  }, [readPending])
  return { loadedAt, pending, online }
}

export function SidebarSyncStatus({ iconsOnly = false, readLoadedAt, readPending, subscribeData }) {
  const status = useSyncStatus({ readLoadedAt, readPending, subscribeData })
  return <SyncIndicator {...status} iconsOnly={iconsOnly} />
}
