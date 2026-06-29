// Decide the sync action for a single item from its base/local/remote payloads.
// Pure: the caller supplies the collection's merge fn. null = absent (deleted or
// never existed).
import { contentHash } from './hash.js'

export function reconcileItem({ base, local, remote, merge }) {
  const hb = contentHash(base)
  const hl = contentHash(local)
  const hr = contentHash(remote)
  const localPresent = local !== null && local !== undefined
  const remotePresent = remote !== null && remote !== undefined
  const basePresent = base !== null && base !== undefined
  const localChanged = hl !== hb
  const remoteChanged = hr !== hb

  if (localPresent && remotePresent) {
    if (!localChanged && !remoteChanged) return { action: 'noop', value: null, conflicts: [] }
    if (localChanged && !remoteChanged) return { action: 'push', value: local, conflicts: [] }
    if (!localChanged && remoteChanged) return { action: 'pull', value: remote, conflicts: [] }
    const { merged, conflicts } = merge(base, local, remote)
    return { action: 'merge', value: merged, conflicts }
  }

  if (localPresent && !remotePresent) {
    // remote absent: a remote tombstone (base existed) or a brand-new local add.
    if (basePresent && !localChanged) return { action: 'delete-local', value: null, conflicts: [] }
    return { action: 'push', value: local, conflicts: [] }   // local add, or remote-deleted-but-local-edited (keep local)
  }

  if (!localPresent && remotePresent) {
    // local absent: a local tombstone (base existed) or a brand-new remote add.
    if (basePresent && !remoteChanged) return { action: 'tombstone', value: null, conflicts: [] }
    return { action: 'pull', value: remote, conflicts: [] }   // remote add, or local-deleted-but-remote-edited (keep remote)
  }

  return { action: 'noop', value: null, conflicts: [] }       // both absent
}
