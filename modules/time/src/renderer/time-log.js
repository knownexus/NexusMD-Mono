// The time log: one flat list of entries. An entry with `end: null` is the running one, so a reload or
// restart loses nothing: elapsed time is always `now - start`, never a counter.
//   entry = { id, ref: { id, title, source } | null, label, start, end }

export const emptyLog = () => ({ entries: [] })

let seq = 0
const newId = now => `t${now.toString(36)}${(seq++).toString(36)}`

export const runningEntries = log => log.entries.filter(e => e.end == null)

const stopAt = (e, now) => (e.end == null ? { ...e, end: Math.max(now, e.start) } : e)

export function stopEntry(log, id, now) {
  return { ...log, entries: log.entries.map(e => (e.id === id ? stopAt(e, now) : e)) }
}

export function stopAll(log, now) {
  return { ...log, entries: log.entries.map(e => stopAt(e, now)) }
}

/**
 * Starts a new entry alongside whatever is already running. `note` is written down at the start;
 * a ticket on the same task already running is allowed (two people's worth of context, one ticket).
 */
export function startEntry(log, { ref = null, label = '', note = '' }, now) {
  const entry = {
    id: newId(now), ref, label: label.trim() || ref?.title || 'Untitled', start: now, end: null,
    notes: note.trim() ? [{ id: newId(now), at: now, text: note.trim() }] : [],
  }
  return { ...log, entries: [...log.entries, entry] }
}

/** A note stamped with the time it was written, on a running or a finished entry. */
export function addNote(log, id, text, now) {
  const t = String(text || '').trim()
  if (!t) return log
  return { ...log, entries: log.entries.map(e => (e.id === id ? { ...e, notes: [...(e.notes || []), { id: newId(now), at: now, text: t }] } : e)) }
}

export function removeNote(log, id, noteId) {
  return { ...log, entries: log.entries.map(e => (e.id === id ? { ...e, notes: (e.notes || []).filter(n => n.id !== noteId) } : e)) }
}

/** Puts a finished or running entry against a ticket (or takes it off one with null). */
export function assignRef(log, id, ref) {
  return { ...log, entries: log.entries.map(e => (e.id === id ? { ...e, ref } : e)) }
}

export function updateEntry(log, id, patch) {
  return { ...log, entries: log.entries.map(e => (e.id === id ? { ...e, ...patch } : e)) }
}

export function removeEntry(log, id) {
  return { ...log, entries: log.entries.filter(e => e.id !== id) }
}

/** Time on the entry: its span minus any break taken out of it. */
export const durationMs = (e, now) => Math.max(0, (e.end ?? now) - e.start - (e.breakMs || 0))


const pad = n => String(n).padStart(2, '0')

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const startOfDay = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime() }

/** An entry that crosses midnight is counted on the day it started. */
export function groupByDay(entries, now) {
  const days = new Map()
  for (const e of entries) {
    const k = dayKey(e.start)
    if (!days.has(k)) days.set(k, { key: k, start: startOfDay(e.start), totalMs: 0, entries: [] })
    const g = days.get(k)
    g.entries.push(e)
    g.totalMs += durationMs(e, now)
  }
  const out = [...days.values()].sort((a, b) => b.start - a.start)
  for (const g of out) g.entries.sort((a, b) => b.start - a.start)
  return out
}

export function dayLabel(key, now) {
  const today = dayKey(now)
  if (key === today) return 'Today'
  if (key === dayKey(now - 86400000)) return 'Yesterday'
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

/** Monday to Sunday of the week containing `now`, each with the time logged that day. */
export function weekTotals(entries, now) {
  const d = new Date(now)
  const monday = startOfDay(now) - ((d.getDay() + 6) % 7) * 86400000
  const days = Array.from({ length: 7 }, (_, i) => {
    const t = new Date(monday); t.setDate(t.getDate() + i)
    return { key: dayKey(t.getTime()), label: t.toLocaleDateString(undefined, { weekday: 'short' }), totalMs: 0 }
  })
  const byKey = new Map(days.map(x => [x.key, x]))
  for (const e of entries) byKey.get(dayKey(e.start)) && (byKey.get(dayKey(e.start)).totalMs += durationMs(e, now))
  return days
}

/** Time per ticket (or per free-text label) over a set of entries, biggest first. */
export function totalsByTask(entries, now) {
  const m = new Map()
  for (const e of entries) {
    const k = e.ref ? `ref:${e.ref.id}` : `label:${e.label}`
    const cur = m.get(k) || { key: k, ref: e.ref, label: e.ref ? e.ref.title : e.label, totalMs: 0 }
    cur.totalMs += durationMs(e, now)
    m.set(k, cur)
  }
  return [...m.values()].sort((a, b) => b.totalMs - a.totalMs)
}

/** Stable color slot (0-5) for a ticket, so the tape, the list and the totals agree. -1 = no ticket. */
export function colorSlot(ref) {
  if (!ref) return -1
  let h = 0
  for (const ch of String(ref.id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % 6
}

/**
 * The day tape: where each of a day's entries sits on a ruler. The ruler runs from the earlier of
 * 08:00 and the first entry to the later of the last entry and the current hour (plus one), whole hours.
 */
export function tapeLayout(entries, key, now) {
  const dayEntries = entries.filter(e => dayKey(e.start) === key)
  const base = startOfDay(dayEntries[0]?.start ?? now)
  const hourOf = ts => (ts - base) / 3600000
  const ends = dayEntries.map(e => e.end ?? now)
  const first = Math.min(8, ...dayEntries.map(e => Math.floor(hourOf(e.start))))
  const lastHour = Math.max(hourOf(now) * (key === dayKey(now) ? 1 : 0), ...ends.map(hourOf))
  const from = Math.max(0, first)
  const to = Math.min(24, Math.max(from + 6, Math.ceil(lastHour) + 1))
  const span = to - from
  const { lanes, byId } = assignLanes(dayEntries, now)
  const segments = dayEntries.map(e => {
    const s = hourOf(e.start), t = hourOf(Math.min(e.end ?? now, base + 86400000))
    return { entry: e, lane: byId.get(e.id), left: ((s - from) / span) * 100, width: Math.max(((t - s) / span) * 100, 0.35) }
  })
  const marks = dayEntries.flatMap(e => (e.marks || []).map(m => ({ id: m.id, entryId: e.id, lane: byId.get(e.id), left: ((hourOf(m.at) - from) / span) * 100, note: m.note })))
  const ticks = []
  const step = span > 12 ? 3 : span > 8 ? 2 : 1
  for (let h = from; h <= to; h += step) ticks.push({ hour: h, left: ((h - from) / span) * 100 })
  return { from, to, lanes, segments, marks, ticks, nowLeft: key === dayKey(now) ? ((hourOf(now) - from) / span) * 100 : null }
}

/** "1h 05m", "42m", "0m". */
export function formatHm(ms) {
  const min = Math.round(Math.max(0, ms || 0) / 60000)
  const h = Math.floor(min / 60), m = min % 60
  return h > 0 ? `${h}h ${pad(m)}m` : `${m}m`
}

/** Tickets whose id or title contains every word typed, best (id match) first. */
export function matchTickets(tickets, query, limit = 6) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const scored = []
  for (const t of tickets) {
    const id = String(t.id).toLowerCase(), title = String(t.title || '').toLowerCase()
    if (!words.every(w => id.includes(w) || title.includes(w))) continue
    scored.push({ t, score: words.some(w => id === w || id === `#${w}`) ? 0 : id.includes(words[0]) ? 1 : 2 })
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map(x => x.t)
}

/** "HH:MM" for a time input. */
export function toHHMM(ts) {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** `ts` moved to the HH:MM given, on the same calendar day; null when the text isn't a time. */
export function withClock(ts, hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  const d = new Date(ts); d.setHours(Number(m[1]), Number(m[2]), 0, 0)
  return d.getTime()
}

/** Why these times can't be saved, in words for the person editing; null when they are fine. */
export function timesError({ start, end, breakMs = 0 }, now) {
  if (start == null || (end === undefined)) return 'Enter a start and an end time.'
  if (start > now) return 'The start is in the future.'
  if (end != null && end <= start) return 'The end has to be after the start.'
  if (end != null && end > now) return 'The end is in the future.'
  if (breakMs < 0 || (end ?? now) - start - breakMs < 0) return 'The break is longer than the entry.'
  return null
}

/** Moves an entry's start and end (the running entry has end null) and sets the break taken out of it. */
export function setTimes(log, id, { start, end, breakMs = 0 }) {
  return { ...log, entries: log.entries.map(e => (e.id === id ? { ...e, start, end, breakMs } : e)) }
}

/** Wall-clock time covered by a set of entries: overlapping timers count once. */
export function unionMs(entries, now) {
  const spans = entries
    .map(e => [e.start, e.end ?? now])
    .filter(([s, t]) => t > s)
    .sort((a, b) => a[0] - b[0])
  let total = 0, curS = null, curE = null
  for (const [s, t] of spans) {
    if (curE == null || s > curE) { if (curE != null) total += curE - curS; curS = s; curE = t }
    else curE = Math.max(curE, t)
  }
  if (curE != null) total += curE - curS
  return total
}

/** Packs entries into rows so timers that overlap sit one under the other. Returns id -> lane. */
export function assignLanes(entries, now) {
  const lanes = []
  const out = new Map()
  for (const e of [...entries].sort((a, b) => a.start - b.start)) {
    let i = lanes.findIndex(end => end <= e.start)
    if (i < 0) { i = lanes.length; lanes.push(0) }
    lanes[i] = e.end ?? now
    out.set(e.id, i)
  }
  return { lanes: Math.max(1, lanes.length), byId: out }
}

/** Everything that happened on a day, in order: starts, notes and stops. */
export function timelineEvents(entries, key, now) {
  const ev = []
  for (const e of entries) {
    if (dayKey(e.start) !== key) continue
    ev.push({ at: e.start, kind: 'start', entry: e })
    for (const n of e.notes || []) ev.push({ at: n.at, kind: 'note', entry: e, note: n })
    for (const m of e.marks || []) ev.push({ at: m.at, kind: 'mark', entry: e, mark: m })
    if (e.end != null) ev.push({ at: e.end, kind: 'stop', entry: e })
  }
  const rank = { start: 0, note: 1, mark: 1, stop: 2 }
  return ev.sort((a, b) => a.at - b.at || rank[a.kind] - rank[b.kind])
}

const hhmm = ts => toHHMM(ts)
const taskName = e => (e.ref ? `${e.ref.id} ${e.label}` : e.label)

/** The day as markdown, ready to paste into a stand-up, a timesheet or a ticket. */
export function timelineMarkdown(entries, key, now) {
  const day = entries.filter(e => dayKey(e.start) === key)
  const [y, m, d] = key.split('-').map(Number)
  const title = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const sum = day.reduce((a, e) => a + durationMs(e, now), 0)
  const elapsed = unionMs(day, now)
  const lines = [`# ${title}`, '', `${formatHm(sum)} logged${elapsed < sum - 60000 ? ` across ${formatHm(elapsed)} on the clock` : ''}`, '']
  for (const ev of timelineEvents(entries, key, now)) {
    const e = ev.entry
    if (ev.kind === 'start') lines.push(`- ${hhmm(ev.at)} Started ${taskName(e)}`)
    else if (ev.kind === 'note') lines.push(`  - ${hhmm(ev.at)} ${ev.note.text}`)
    else if (ev.kind === 'mark') lines.push(`  - ${hhmm(ev.at)} Mark${ev.mark.note ? `: ${ev.mark.note}` : ''}`)
    else lines.push(`- ${hhmm(ev.at)} Stopped ${taskName(e)} (${formatHm(durationMs(e, now))}${e.breakMs ? `, ${Math.round(e.breakMs / 60000)}m break` : ''})`)
  }
  const tasks = totalsByTask(day, now)
  if (tasks.length) {
    lines.push('', '## Time per task', '')
    for (const t of tasks) lines.push(`- ${t.ref ? `${t.ref.id} ` : ''}${t.label}: ${formatHm(t.totalMs)}`)
  }
  return lines.join('\n')
}

/**
 * Drops a mark at a moment inside an entry (the running entry's moment is "now"), with an optional note.
 * Marks outside the entry's span are ignored.
 */
export function addMark(log, id, at, note, now) {
  return {
    ...log,
    entries: log.entries.map(e => {
      if (e.id !== id || at < e.start || at > (e.end ?? now)) return e
      return { ...e, marks: [...(e.marks || []), { id: newId(at), at, note: String(note || '').trim() }].sort((a, b) => a.at - b.at) }
    }),
  }
}

export function updateMark(log, id, markId, note) {
  return { ...log, entries: log.entries.map(e => (e.id === id ? { ...e, marks: (e.marks || []).map(m => (m.id === markId ? { ...m, note: String(note || '').trim() } : m)) } : e)) }
}

export function removeMark(log, id, markId) {
  return { ...log, entries: log.entries.map(e => (e.id === id ? { ...e, marks: (e.marks || []).filter(m => m.id !== markId) } : e)) }
}

/** Marks that fall strictly inside a finished entry, so each one can cut it. */
export function splitPoints(e) {
  if (e.end == null) return []
  return [...new Set((e.marks || []).map(m => m.at).filter(t => t > e.start && t < e.end))].sort((a, b) => a - b)
}

/**
 * Cuts a finished entry at its marks into one entry per stretch, so each part can go against its own
 * ticket. The first part keeps the entry's id. A mark's note becomes a note at the start of the part
 * after it; notes go to the part they were written during. A break stays with the longest part.
 */
export function splitAtMarks(log, id) {
  const idx = log.entries.findIndex(e => e.id === id)
  const e = log.entries[idx]
  const cuts = e ? splitPoints(e) : []
  if (!cuts.length) return log
  const bounds = [e.start, ...cuts, e.end]
  const lens = bounds.slice(0, -1).map((s, i) => bounds[i + 1] - s)
  const breakAt = lens.indexOf(Math.max(...lens))
  const parts = lens.map((_, i) => {
    const s = bounds[i], t = bounds[i + 1]
    const inPart = at => (i === 0 ? at < t : i === lens.length - 1 ? at >= s : at >= s && at < t)
    const last = lens.length - 1
    const carried = (e.marks || [])
      .filter(m => m.note && ((i > 0 && m.at === s) || (i === 0 && m.at <= e.start) || (i === last && m.at >= e.end)))
      .map(m => ({ id: newId(m.at), at: m.at, text: m.note }))
    return {
      ...e, id: i === 0 ? e.id : newId(s + i), start: s, end: t,
      marks: [], breakMs: i === breakAt ? e.breakMs || 0 : 0,
      notes: [...carried, ...(e.notes || []).filter(n => inPart(n.at))].sort((a, b) => a.at - b.at),
    }
  })
  const entries = [...log.entries]
  entries.splice(idx, 1, ...parts)
  return { ...log, entries }
}

/** Puts every listed entry against one ticket (null clears it). */
export function assignRefMany(log, ids, ref) {
  const set = new Set(ids)
  return { ...log, entries: log.entries.map(e => (set.has(e.id) ? { ...e, ref } : e)) }
}
