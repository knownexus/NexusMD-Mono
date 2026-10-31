import { describe, it, expect } from 'vitest'
import {
  emptyLog, startEntry, stopAll, stopEntry, runningEntries, addNote, removeNote, assignRef, assignRefMany, addMark, updateMark, removeMark, splitPoints, splitAtMarks, unionMs, assignLanes, timelineEvents, timelineMarkdown, updateEntry, removeEntry, setTimes, toHHMM, withClock, timesError, durationMs,
  groupByDay, weekTotals, totalsByTask, colorSlot, tapeLayout, formatHm, matchTickets, dayLabel,
} from './time-log.js'

const at = (h, m = 0, day = 15) => new Date(2026, 9, day, h, m).getTime() // Thu 15 Oct 2026
const ref = { id: 'PAY-12', title: 'Fix refund rounding', source: 'jira' }

describe('starting and stopping', () => {
  it('starting a second entry leaves the first running', () => {
    let log = startEntry(emptyLog(), { ref }, at(9))
    log = startEntry(log, { label: 'Standup' }, at(9, 30))
    expect(runningEntries(log)).toHaveLength(2)
    log = stopEntry(log, log.entries[0].id, at(10))
    expect(log.entries[0].end).toBe(at(10))
    expect(runningEntries(log).map(e => e.label)).toEqual(['Standup'])
  })

  it('labels a ticket entry with its title and falls back to Untitled', () => {
    expect(startEntry(emptyLog(), { ref }, at(9)).entries[0].label).toBe('Fix refund rounding')
    expect(startEntry(emptyLog(), { label: '  ' }, at(9)).entries[0].label).toBe('Untitled')
  })

  it('elapsed time comes from timestamps, so a reload loses nothing', () => {
    const log = startEntry(emptyLog(), { label: 'x' }, at(9))
    expect(durationMs(log.entries[0], at(9, 42))).toBe(42 * 60000)
    expect(stopAll(log, at(10)).entries[0].end).toBe(at(10))
    expect(runningEntries(stopAll(log, at(10)))).toHaveLength(0)
  })

  it('renames and removes entries', () => {
    let log = stopAll(startEntry(emptyLog(), { label: 'x' }, at(9)), at(10))
    const id = log.entries[0].id
    expect(updateEntry(log, id, { label: 'y' }).entries[0].label).toBe('y')
    expect(removeEntry(log, id).entries).toHaveLength(0)
  })
})

describe('correcting times after the fact', () => {
  const finished = () => {
    const log = stopAll(startEntry(emptyLog(), { ref }, at(9)), at(10))
    return { log, id: log.entries[0].id }
  }

  it('forgot to start: moving the start earlier lengthens a running entry', () => {
    const log = startEntry(emptyLog(), { label: 'x' }, at(9, 30))
    const id = log.entries[0].id
    const fixed = setTimes(log, id, { start: at(9), end: null })
    expect(runningEntries(fixed)[0].id).toBe(id)
    expect(durationMs(fixed.entries[0], at(10))).toBe(60 * 60000)
  })

  it('forgot to stop: moving the end earlier shortens a finished entry', () => {
    const { log, id } = finished()
    const fixed = setTimes(log, id, { start: at(9), end: at(9, 20) })
    expect(durationMs(fixed.entries[0], at(18))).toBe(20 * 60000)
  })

  it('a break comes off the time without moving the entry', () => {
    const { log, id } = finished()
    const fixed = setTimes(log, id, { start: at(9), end: at(10), breakMs: 15 * 60000 })
    expect(durationMs(fixed.entries[0], at(18))).toBe(45 * 60000)
    expect(fixed.entries[0].start).toBe(at(9))
    expect(groupByDay(fixed.entries, at(18))[0].totalMs).toBe(45 * 60000)
  })

  it('reads and writes HH:MM on the entry\'s own day', () => {
    expect(toHHMM(at(9, 5))).toBe('09:05')
    expect(withClock(at(23, 0), '08:30')).toBe(at(8, 30))
    expect(withClock(at(9), '25:00')).toBeNull()
    expect(withClock(at(9), 'soon')).toBeNull()
  })

  it('explains why times cannot be saved', () => {
    const now = at(12)
    expect(timesError({ start: at(9), end: at(10) }, now)).toBeNull()
    expect(timesError({ start: at(9), end: null }, now)).toBeNull()
    expect(timesError({ start: at(10), end: at(10) }, now)).toMatch(/after the start/)
    expect(timesError({ start: at(13), end: null }, now)).toMatch(/future/)
    expect(timesError({ start: at(9), end: at(13) }, now)).toMatch(/future/)
    expect(timesError({ start: at(9), end: at(10), breakMs: 61 * 60000 }, now)).toMatch(/break/)
    expect(timesError({ start: at(9), end: at(10), breakMs: -1 }, now)).toMatch(/break/)
  })
})

describe('grouping and totals', () => {
  const e = (id, r, label, start, end) => ({ id, ref: r, label, start, end })
  const build = () => ({
    entries: [
      e('a', ref, 'Fix refund rounding', at(9, 0, 14), at(10, 0, 14)),
      e('b', null, 'Review', at(10, 0, 14), at(10, 30, 14)),
      e('c', ref, 'Fix refund rounding', at(9), at(10, 30)),
    ],
  })

  it('groups by day, newest day first, with day totals', () => {
    const days = groupByDay(build().entries, at(11))
    expect(days.map(d => d.key)).toEqual(['2026-10-15', '2026-10-14'])
    expect(days[0].totalMs).toBe(90 * 60000)
    expect(days[1].totalMs).toBe(90 * 60000)
  })

  it('totals a week Monday to Sunday', () => {
    const w = weekTotals(build().entries, at(11))
    expect(w.map(d => d.label)).toHaveLength(7)
    expect(w[3].key).toBe('2026-10-15')
    expect(w[3].totalMs).toBe(90 * 60000)
    expect(w[2].key).toBe('2026-10-14')
  })

  it('totals per ticket, merging entries on the same ticket', () => {
    const t = totalsByTask(build().entries, at(11))
    expect(t[0].ref.id).toBe('PAY-12')
    expect(t[0].totalMs).toBe(3600000 + 90 * 60000)
  })

  it('labels recent days', () => {
    expect(dayLabel('2026-10-15', at(11))).toBe('Today')
    expect(dayLabel('2026-10-14', at(11))).toBe('Yesterday')
  })
})

describe('colorSlot', () => {
  it('is stable per ticket and -1 for none', () => {
    expect(colorSlot(ref)).toBe(colorSlot({ id: 'PAY-12' }))
    expect(colorSlot(ref)).toBeGreaterThanOrEqual(0)
    expect(colorSlot(ref)).toBeLessThan(6)
    expect(colorSlot(null)).toBe(-1)
  })
})

describe('tapeLayout', () => {
  it('places segments proportionally on whole hours', () => {
    let log = startEntry(emptyLog(), { label: 'a' }, at(9))
    log = stopAll(log, at(10))
    const t = tapeLayout(log.entries, '2026-10-15', at(10, 30))
    expect(t.from).toBe(8)
    expect(t.to).toBeGreaterThanOrEqual(14)
    const span = t.to - t.from
    expect(t.segments[0].left).toBeCloseTo((1 / span) * 100)
    expect(t.segments[0].width).toBeCloseTo((1 / span) * 100)
    expect(t.nowLeft).toBeCloseTo((2.5 / span) * 100)
  })

  it('has no now marker for another day and starts earlier for early work', () => {
    let log = startEntry(emptyLog(), { label: 'a' }, at(6, 15, 14))
    log = stopAll(log, at(7, 0, 14))
    const t = tapeLayout(log.entries, '2026-10-14', at(11))
    expect(t.from).toBe(6)
    expect(t.nowLeft).toBeNull()
  })
})

describe('formatHm', () => {
  it('formats', () => {
    expect(formatHm(0)).toBe('0m')
    expect(formatHm(42 * 60000)).toBe('42m')
    expect(formatHm(65 * 60000)).toBe('1h 05m')
  })
})

describe('matchTickets', () => {
  const tickets = [
    { id: 'PAY-12', title: 'Fix refund rounding' },
    { id: 'PAY-120', title: 'Refund email copy' },
    { id: '4411', title: 'Login timeout' },
  ]
  it('matches every word against id or title, id matches first', () => {
    expect(matchTickets(tickets, 'refund').map(t => t.id)).toEqual(['PAY-12', 'PAY-120'])
    expect(matchTickets(tickets, 'pay-12').map(t => t.id)[0]).toBe('PAY-12')
    expect(matchTickets(tickets, 'login time').map(t => t.id)).toEqual(['4411'])
    expect(matchTickets(tickets, '  ')).toEqual([])
  })
})

describe('notes and tickets', () => {
  it('writes a note before the timer starts, stamped at the start', () => {
    const log = startEntry(emptyLog(), { label: 'x', note: '  Plan: reproduce first ' }, at(9))
    expect(log.entries[0].notes).toEqual([expect.objectContaining({ at: at(9), text: 'Plan: reproduce first' })])
  })

  it('adds notes during and after, each stamped with when it was written', () => {
    let log = startEntry(emptyLog(), { label: 'x' }, at(9))
    const id = log.entries[0].id
    log = addNote(log, id, 'Found the cause', at(9, 20))
    log = stopEntry(log, id, at(10))
    log = addNote(log, id, 'Follow up with Sam', at(11))
    expect(log.entries[0].notes.map(n => [n.at, n.text])).toEqual([[at(9, 20), 'Found the cause'], [at(11), 'Follow up with Sam']])
    expect(addNote(log, id, '   ', at(12))).toBe(log)
  })

  it('removes a note', () => {
    const log = startEntry(emptyLog(), { label: 'x', note: 'n' }, at(9))
    expect(removeNote(log, log.entries[0].id, log.entries[0].notes[0].id).entries[0].notes).toHaveLength(0)
  })

  it('assigns a finished timer to a ticket, or takes it off one', () => {
    const log = stopAll(startEntry(emptyLog(), { label: 'Debugging' }, at(9)), at(10))
    const id = log.entries[0].id
    const assigned = assignRef(log, id, ref)
    expect(assigned.entries[0].ref).toEqual(ref)
    expect(totalsByTask(assigned.entries, at(11))[0].ref.id).toBe('PAY-12')
    expect(assignRef(assigned, id, null).entries[0].ref).toBeNull()
  })
})

describe('timers that overlap', () => {
  const e = (id, start, end) => ({ id, ref: null, label: id, start, end })

  it('counts overlapping time once on the clock but fully per timer', () => {
    const entries = [e('a', at(9), at(11)), e('b', at(10), at(12)), e('c', at(13), at(14))]
    expect(unionMs(entries, at(15))).toBe(4 * 3600000)
    expect(groupByDay(entries, at(15))[0].totalMs).toBe(5 * 3600000)
  })

  it('puts overlapping timers in separate lanes and reuses a free one', () => {
    const { lanes, byId } = assignLanes([e('a', at(9), at(11)), e('b', at(10), at(12)), e('c', at(11, 30), at(13))], at(15))
    expect(lanes).toBe(2)
    expect(byId.get('a')).toBe(0)
    expect(byId.get('b')).toBe(1)
    expect(byId.get('c')).toBe(0)
  })

  it('gives the tape one lane per concurrent timer', () => {
    const entries = [e('a', at(9), at(11)), e('b', at(10), null)]
    expect(tapeLayout(entries, '2026-10-15', at(10, 30)).lanes).toBe(2)
  })
})

describe('the day timeline', () => {
  const build = () => {
    let log = startEntry(emptyLog(), { ref, note: 'Reproduce the rounding bug' }, at(9))
    log = startEntry(log, { label: 'Standup' }, at(9, 15))
    log = stopEntry(log, log.entries[1].id, at(9, 30))
    log = addNote(log, log.entries[0].id, 'Cause: banker\'s rounding', at(9, 45))
    return stopEntry(log, log.entries[0].id, at(10, 30))
  }

  it('lists starts, notes and stops in the order they happened', () => {
    const ev = timelineEvents(build().entries, '2026-10-15', at(11))
    expect(ev.map(x => `${x.kind}@${new Date(x.at).getHours()}:${String(new Date(x.at).getMinutes()).padStart(2, '0')}`))
      .toEqual(['start@9:00', 'note@9:00', 'start@9:15', 'stop@9:30', 'note@9:45', 'stop@10:30'])
  })

  it('writes the day as markdown with notes and per-task time', () => {
    const md = timelineMarkdown(build().entries, '2026-10-15', at(11))
    expect(md).toContain('- 09:00 Started PAY-12 Fix refund rounding')
    expect(md).toContain('  - 09:00 Reproduce the rounding bug')
    expect(md).toContain('- 09:30 Stopped Standup (15m)')
    expect(md).toContain('- 10:30 Stopped PAY-12 Fix refund rounding (1h 30m)')
    expect(md).toContain('1h 45m logged across 1h 30m on the clock')
    expect(md).toContain('## Time per task')
    expect(md).toContain('- PAY-12 Fix refund rounding: 1h 30m')
  })
})

describe('marks', () => {
  const running = () => startEntry(emptyLog(), { ref, label: 'Payments work' }, at(9))

  it('drops a mark inside the entry, sorted by time, with an optional note', () => {
    let log = running()
    const id = log.entries[0].id
    log = addMark(log, id, at(9, 40), ' switched to the email copy ', at(10))
    log = addMark(log, id, at(9, 20), '', at(10))
    expect(log.entries[0].marks.map(m => [m.at, m.note])).toEqual([[at(9, 20), ''], [at(9, 40), 'switched to the email copy']])
  })

  it('ignores a mark outside the entry', () => {
    const log = running()
    const id = log.entries[0].id
    expect(addMark(log, id, at(8, 59), 'x', at(10)).entries[0].marks).toBeUndefined()
    expect(addMark(log, id, at(10, 1), 'x', at(10)).entries[0].marks).toBeUndefined()
  })

  it('edits and removes a mark', () => {
    let log = addMark(running(), 'nope', at(9, 10), 'a', at(10))
    log = addMark(running(), running().entries[0].id, at(9, 10), 'a', at(10))
    const e = log.entries[0]
    const withMark = { entries: [{ ...e, marks: [{ id: 'm1', at: at(9, 10), note: 'a' }] }] }
    expect(updateMark(withMark, e.id, 'm1', 'b').entries[0].marks[0].note).toBe('b')
    expect(removeMark(withMark, e.id, 'm1').entries[0].marks).toEqual([])
  })

  it('shows marks on the timeline and the markdown', () => {
    const entry = { id: 'a', ref, label: 'Payments work', start: at(9), end: at(10), marks: [{ id: 'm', at: at(9, 30), note: 'moved to email copy' }] }
    expect(timelineEvents([entry], '2026-10-15', at(11)).map(x => x.kind)).toEqual(['start', 'mark', 'stop'])
    expect(timelineMarkdown([entry], '2026-10-15', at(11))).toContain('  - 09:30 Mark: moved to email copy')
    expect(tapeLayout([entry], '2026-10-15', at(11)).marks).toHaveLength(1)
  })
})

describe('splitting at marks', () => {
  const mk = (over = {}) => ({
    id: 'a', ref, label: 'Payments work', start: at(9), end: at(11), notes: [], marks: [], breakMs: 0, ...over,
  })

  it('cuts a finished entry into one entry per stretch', () => {
    const entry = mk({ marks: [{ id: 'm1', at: at(9, 30), note: 'email copy' }, { id: 'm2', at: at(10, 15), note: '' }] })
    const log = splitAtMarks({ entries: [entry] }, 'a')
    expect(log.entries.map(e => [e.start, e.end])).toEqual([[at(9), at(9, 30)], [at(9, 30), at(10, 15)], [at(10, 15), at(11)]])
    expect(log.entries[0].id).toBe('a')
    expect(new Set(log.entries.map(e => e.id)).size).toBe(3)
    expect(log.entries.every(e => e.ref.id === 'PAY-12' && e.label === 'Payments work')).toBe(true)
    expect(log.entries.every(e => !e.marks.length)).toBe(true)
  })

  it('keeps the total time the same', () => {
    const entry = mk({ marks: [{ id: 'm1', at: at(9, 30), note: '' }] })
    const log = splitAtMarks({ entries: [entry] }, 'a')
    expect(log.entries.reduce((a, e) => a + durationMs(e, at(12)), 0)).toBe(durationMs(entry, at(12)))
  })

  it('moves each note to the part it was written during and carries a mark\'s note to the part it starts', () => {
    const entry = mk({
      marks: [{ id: 'm1', at: at(9, 30), note: 'email copy' }],
      notes: [{ id: 'n1', at: at(9, 10), text: 'early' }, { id: 'n2', at: at(10, 0), text: 'later' }, { id: 'n3', at: at(12), text: 'after the fact' }],
    })
    const [a, b] = splitAtMarks({ entries: [entry] }, 'a').entries
    expect(a.notes.map(n => n.text)).toEqual(['early'])
    expect(b.notes.map(n => n.text)).toEqual(['email copy', 'later', 'after the fact'])
  })

  it('keeps a break with the longest part', () => {
    const entry = mk({ breakMs: 10 * 60000, marks: [{ id: 'm1', at: at(9, 20), note: '' }] })
    const [a, b] = splitAtMarks({ entries: [entry] }, 'a').entries
    expect(a.breakMs).toBe(0)
    expect(b.breakMs).toBe(10 * 60000)
  })

  it('does nothing for a running entry or a mark at the very edge', () => {
    const running = mk({ end: null, marks: [{ id: 'm1', at: at(9, 30), note: '' }] })
    expect(splitAtMarks({ entries: [running] }, 'a').entries).toHaveLength(1)
    const edge = mk({ marks: [{ id: 'm1', at: at(9), note: 'x' }, { id: 'm2', at: at(11), note: '' }] })
    expect(splitPoints(edge)).toEqual([])
    expect(splitAtMarks({ entries: [edge] }, 'a').entries).toHaveLength(1)
  })

  it('puts the parts where the original was in the list', () => {
    const other = { id: 'z', ref: null, label: 'z', start: at(8), end: at(8, 30) }
    const log = splitAtMarks({ entries: [other, mk({ marks: [{ id: 'm1', at: at(10), note: '' }] })] }, 'a')
    expect(log.entries.map(e => e.id)[0]).toBe('z')
    expect(log.entries).toHaveLength(3)
  })
})

describe('assigning several timers to one ticket', () => {
  it('puts all the listed entries against the ticket and leaves the rest alone', () => {
    const entries = [
      { id: 'a', ref: null, label: 'a', start: at(9), end: at(10) },
      { id: 'b', ref: null, label: 'b', start: at(10), end: at(11) },
      { id: 'c', ref: { id: '4411' }, label: 'c', start: at(11), end: at(12) },
    ]
    const log = assignRefMany({ entries }, ['a', 'b'], ref)
    expect(log.entries.map(e => e.ref?.id)).toEqual(['PAY-12', 'PAY-12', '4411'])
    expect(totalsByTask(log.entries, at(13))[0]).toMatchObject({ totalMs: 2 * 3600000 })
  })
})
