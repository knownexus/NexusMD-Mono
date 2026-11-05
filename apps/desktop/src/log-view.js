// Pure helpers for the log viewer (log-viewer.jsx): colours per module, matching, the swimlane layout
// of one call across modules, and keeping a live list tidy. Entries are the hub's JSON lines
// (packages/main-kit/src/logging): { ts, lvl, mod, cid?, via?, scope?, msg, err?, data?, sid, seq }.

export const LEVELS = ['error', 'warn', 'info', 'debug']

// Twelve hues 30 degrees apart. The modules that ship have one each, so no two of them share a colour; a module
// we do not know takes a slot from its name, steady from session to session.
const HUES = [15, 45, 75, 105, 135, 165, 195, 225, 255, 285, 315, 345]
const MODULE_HUE = { work: 255, git: 45, devenv: 165, planner: 315, time: 75, calendar: 195, notes: 345, documents: 135, database: 15, 'api-client': 285, editor: 105 }

/** A stable colour per module, the same in every session; core stays neutral. */
export function moduleColor(mod) {
  if (mod === 'core') return 'var(--text-muted)'
  let hue = MODULE_HUE[mod]
  if (hue === undefined) {
    let h = 0
    for (const ch of String(mod)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    hue = HUES[h % HUES.length]
  }
  return `oklch(0.62 0.14 ${hue})`
}

export const entryKey = e => `${e.sid}:${e.seq}`

const haystack = e => `${e.msg ?? ''}\n${e.scope ?? ''}\n${e.err ? `${e.err.name} ${e.err.message} ${e.err.stack ?? ''}` : ''}\n${e.data !== undefined ? JSON.stringify(e.data) : ''}`.toLowerCase()

/** Same rules as the main-process reader, so a live entry is kept or dropped as a queried one would be. */
export function entryMatches(e, { mods, levels, text } = {}) {
  if (mods?.size && !mods.has(e.mod)) return false
  if (levels?.size && !levels.has(e.lvl)) return false
  const t = text?.trim().toLowerCase()
  return !t || haystack(e).includes(t)
}

/** Adds a live batch to the list: entries already there are skipped, filters applied, the oldest dropped past `limit`. */
export function mergeLive(list, batch, filters, limit = 2000) {
  const seen = new Set(list.map(entryKey))
  const added = batch.filter(e => !seen.has(entryKey(e)) && entryMatches(e, filters))
  if (!added.length) return list
  const next = [...list, ...added]
  return next.length > limit ? next.slice(next.length - limit) : next
}

/** One lane per module, in the order the call reached them: { lanes: [mod], rows: [{ entry, lane }] }. */
export function laneLayout(entries) {
  const lanes = []
  const rows = entries.map(entry => {
    let lane = lanes.indexOf(entry.mod)
    if (lane < 0) lane = lanes.push(entry.mod) - 1
    return { entry, lane }
  })
  return { lanes, rows }
}

/** The route a call took: the modules in order with what each logged, how long it took, and where it first failed. */
export function describeTrail(entries) {
  const hops = []
  for (const e of entries) {
    let hop = hops.find(h => h.mod === e.mod)
    if (!hop) hops.push(hop = { mod: e.mod, count: 0, errors: 0, warns: 0 })
    hop.count++
    if (e.lvl === 'error') hop.errors++
    if (e.lvl === 'warn') hop.warns++
  }
  const first = entries[0]?.ts, last = entries.at(-1)?.ts
  const ms = first && last ? Math.max(0, Date.parse(last) - Date.parse(first)) : 0
  return { hops, ms, failedIn: entries.find(e => e.lvl === 'error')?.mod ?? null }
}

/** Local time of day with milliseconds: 14:03:22.481. */
export function formatTime(ts) {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts ?? '')
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

export const formatDuration = ms => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`)

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Today as the hub names its files (UTC). */
export const todayUtc = (now = Date.now()) => new Date(now).toISOString().slice(0, 10)

/** The first line of a message, and how many more lines it has. A browser console message's %c and style text are dropped. */
export function messageParts(msg) {
  const lines = String(msg ?? '').replace(/%c/g, '').replace(/\s*font-weight:\s*bold;\s*/g, ' ').split('\n').map(l => l.trim()).filter(Boolean)
  return { first: lines[0] ?? '', more: Math.max(0, lines.length - 1) }
}

/** How long after the call began an entry was logged: +0 ms, +520 ms, +1.3 s. */
export function offsetLabel(ts, startTs) {
  const ms = Date.parse(ts) - Date.parse(startTs)
  return Number.isNaN(ms) ? '' : `+${formatDuration(Math.max(0, ms))}`
}

/** The modules a call reached before this entry, in order, then the entry's own. */
export const routeOf = e => [...(e.via ?? []).filter(m => m !== e.mod), e.mod]

/** For each lane, the first and last row it is used in: a lane is drawn only between them. */
export function laneSpans(rows, laneCount) {
  const spans = Array.from({ length: laneCount }, () => ({ first: -1, last: -1 }))
  rows.forEach(({ lane }, i) => { if (spans[lane].first < 0) spans[lane].first = i; spans[lane].last = i })
  return spans
}
