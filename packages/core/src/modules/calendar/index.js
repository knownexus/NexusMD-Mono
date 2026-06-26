import { registerModule } from '../../features/module-registry.js'

/**
 * True if an event is all-day (date-only start string, length 10).
 * @param {{ start: string }} event
 */
export function isAllDayEvent(event) {
  return typeof event?.start === 'string' && event.start.length === 10
}

/**
 * Return events whose start falls within the given day (local time).
 * @param {object[]} events  Events with a `start` ISO string.
 * @param {Date}     date    The target day.
 * @returns {object[]}
 */
export function getEventsForDay(events, date) {
  const y = date.getFullYear(), m = date.getMonth(), d = date.getDate()
  return (events || []).filter(ev => {
    const s = new Date(ev.start)
    return s.getFullYear() === y && s.getMonth() === m && s.getDate() === d
  })
}

/**
 * Sort events by start time ascending (all-day events first, then chronological).
 * @param {object[]} events
 * @returns {object[]}
 */
export function sortEventsByTime(events) {
  return [...(events || [])].sort((a, b) => {
    const aAll = isAllDayEvent(a), bAll = isAllDayEvent(b)
    if (aAll && !bAll) return -1
    if (!aAll && bAll) return 1
    return new Date(a.start) - new Date(b.start)
  })
}

/**
 * Build a stable dedup key for an alert so it fires at most once per session.
 * @param {string} eventId
 * @param {'remind'|'start'} type
 * @param {number} [reminderMins]
 * @returns {string}
 */
export function buildAlertKey(eventId, type, reminderMins) {
  return type === 'remind'
    ? `${eventId}:remind:${reminderMins ?? 10}`
    : `${eventId}:start`
}

/**
 * Determine which alerts should fire now for a list of events.
 * This function is pure — it never mutates `alerted`.
 *
 * @param {object[]}   events        Calendar events with `id` and `start` strings.
 * @param {Date}       now           Current time.
 * @param {number}     [reminderMins=10]  Minutes-before-start to fire the reminder alert.
 * @param {Set<string>} [alerted]    Keys already fired this session.
 * @param {number}     [windowMs=90000]  Allowable jitter window around the target time (ms).
 * @returns {{ key: string, type: 'remind'|'start', event: object }[]}
 */
export function pendingAlerts(events, now, reminderMins = 10, alerted = new Set(), windowMs = 90_000) {
  const results = []
  for (const ev of events || []) {
    if (isAllDayEvent(ev) || !ev.start || !ev.id) continue
    const start   = new Date(ev.start)
    const msUntil = start - now

    const remKey    = buildAlertKey(ev.id, 'remind', reminderMins)
    const remTarget = reminderMins * 60_000
    if (msUntil > 0 && msUntil <= remTarget + windowMs && !alerted.has(remKey)) {
      results.push({ key: remKey, type: 'remind', event: ev })
    }

    const startKey = buildAlertKey(ev.id, 'start')
    if (msUntil > -windowMs && msUntil <= windowMs && !alerted.has(startKey)) {
      results.push({ key: startKey, type: 'start', event: ev })
    }
  }
  return results
}

registerModule({
  id:               'calendar',
  name:             'Calendar',
  requiredAdapters: [],
  defaultEnabled:   true,

  init(_adapters, _config) {},
  async load(_adapters) { return {} },
  dispose() {},
})
