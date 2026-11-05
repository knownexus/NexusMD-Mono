// Device-level switch for the old Google Drive / OneDrive "Cloud sync" backup.
// Outside any profile (nexusmd.feature.*). Absent => on only if a provider was already configured.
import { rendererLog, ignore } from '@nexusmd/core'

const log = rendererLog('sync', 'legacy')

export const LEGACY_CLOUD_SYNC_KEY = 'nexusmd.feature.legacyCloudSync'
const PROVIDER_KEY = 'nexusmd.sync.provider'

export function isLegacyCloudSyncOn() {
  try {
    const v = localStorage.getItem(LEGACY_CLOUD_SYNC_KEY)
    if (v === '1') return true
    if (v === '0') return false
    return !!localStorage.getItem(PROVIDER_KEY)
  } catch { return false }
}

export function setLegacyCloudSyncOn(on) {
  try { localStorage.setItem(LEGACY_CLOUD_SYNC_KEY, on ? '1' : '0') } catch (err) { ignore(log, 'the legacy cloud sync setting could not be saved (storage full or blocked)', err, 'warn') }
}
