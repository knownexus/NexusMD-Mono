// lists — pure Lists model (custom trackers for manual profiles): field
// definitions, defaults, status-to-board-bucket mapping, id generation, and
// read/write of `{ lists: [...] }` at getProfileKey(`${namespace}.lists`) against
// an injected Web Storage-shaped `storage`. On mobile the namespace is `helm`, so
// the key is the `helm.lists` mobile has always used.

const storageKey = (getProfileKey, namespace) => getProfileKey(`${namespace}.lists`)

export function readLists({ storage, getProfileKey, namespace }) {
  try {
    const s = storage.getItem(storageKey(getProfileKey, namespace))
    const data = s ? JSON.parse(s) : null
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { lists: [] }
    // Sync can land any remote value here verbatim; malformed lists load as no lists.
    return { ...data, lists: Array.isArray(data.lists) ? data.lists.filter(l => l && typeof l === 'object') : [] }
  } catch (_) { return { lists: [] } }
}

export function writeLists({ storage, getProfileKey, namespace }, data) {
  storage.setItem(storageKey(getProfileKey, namespace), JSON.stringify(data))
}

export function newListId() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4)
}

// ── Field types ──────────────────────────────────────────────────────────────
export const FIELD_DEFS = [
  { id: 'owner',    label: 'Owner',     type: 'text'     },
  { id: 'status',   label: 'Status',    type: 'status'   },
  { id: 'due',      label: 'Due date',  type: 'date'     },
  { id: 'priority', label: 'Priority',  type: 'priority' },
  { id: 'notes',    label: 'Notes',     type: 'text'     },
  { id: 'number',   label: 'Number',    type: 'number'   },
  { id: 'url',      label: 'URL',       type: 'url'      },
  { id: 'check',    label: 'Checkbox',  type: 'boolean'  },
]

export const PRIORITY_LABELS = ['P1', 'P2', 'P3', 'P4']
export const DEFAULT_STATUSES = ['Not started', 'In progress', 'Done', 'Blocked']
export const DEFAULT_FIELDS   = ['owner', 'status', 'due', 'priority', 'notes']

// ── Status bucket mapping (for Board view) ───────────────────────────────────
export function toBucket(status) {
  const s = (status || '').toLowerCase()
  if (/done|complet|closed|finish/.test(s)) return 'done'
  if (/block/.test(s)) return 'blocked'
  if (/progress|active|start|doing/.test(s)) return 'inprogress'
  return 'notstarted'
}

export const BUCKET_ORDER  = ['notstarted', 'inprogress', 'done', 'blocked']
export const BUCKET_LABELS = { notstarted: 'Not started', inprogress: 'In progress', done: 'Done', blocked: 'Blocked' }

// ── URL safety ───────────────────────────────────────────────────────────────
// Synced list data is untrusted: only http(s) strings may become an href.
export function safeListUrl(v) {
  if (typeof v !== 'string' || v !== v.trim()) return null
  try {
    const p = new URL(v).protocol
    return p === 'http:' || p === 'https:' ? v : null
  } catch (_) { return null }
}
