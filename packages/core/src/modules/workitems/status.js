export const WORK_ITEM_STATUS_KEY = 'nexusmd.workitems.status.v1'

export function describeProviderError(err) {
  const s = err?.status
  if (s === 401 || s === 403) {
    const detail = String(err?.message || '').trim()
    return detail ? `auth failed — check settings (${detail.slice(0, 160)})` : 'auth failed — check settings'
  }
  return String(err?.message || err || 'load failed').slice(0, 200)
}

export function readProviderStatus(storage) {
  try {
    const raw = storage.get(WORK_ITEM_STATUS_KEY)
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw
    return v && typeof v === 'object' ? v : {}
  } catch { return {} }
}

export function recordProviderStatus(storage, id, { ok, error } = {}) {
  const all = readProviderStatus(storage)
  all[id] = ok
    ? { status: 'ok', at: Date.now() }
    : { status: 'error', error: describeProviderError(error), at: Date.now() }
  try { storage.set(WORK_ITEM_STATUS_KEY, all) } catch { /* quota */ }
  return all
}
