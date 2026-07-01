// view-calendar.jsx — desktop Calendar view. Composes the shared calendar UI
// primitives from @nexusmd/ui with desktop-native Outlook/Google clients
// (../ms-graph-calendar.js, ../google-calendar.js) instead of the shared
// OutlookService (MSAL) or web's server-proxied Google fetch.
import React from 'react'
import {
  Icon, toast,
  WeekGrid, MonthView, YearView, AgendaView, EventDetailModal,
  getWeekDays, getMonthGrid, getYearMonths, getAgendaDays,
  nowTopPx, todayStr, isoDate, MONTH_NAMES, MONTH_SHORT,
} from '@nexusmd/ui'
import { createGoogleCalendarEvent, isGoogleConnected } from '../google-calendar.js'

export function MicrosoftCalendarBanner({ connected, syncing, error, onRefresh }) {
  if (!connected) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {syncing && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} /> Outlook
        </span>
      )}
      {error && <span style={{ fontSize: 11, color: 'var(--danger)' }} title={error}>Outlook sync error</span>}
      {!syncing && !error && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
          Outlook Calendar
        </span>
      )}
      <button className="btn sm ghost" onClick={onRefresh} title="Refresh Outlook Calendar" style={{ padding: '0 5px', height: 24 }}>
        <Icon name="refresh" size={11} />
      </button>
    </div>
  )
}

export function GoogleCalendarBanner({ syncing, error, onRefresh }) {
  const connected = isGoogleConnected()
  if (!connected) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {syncing && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} /> Google
        </span>
      )}
      {error && <span style={{ fontSize: 11, color: 'var(--danger)' }} title={error}>Google sync error</span>}
      {!syncing && !error && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
          Google Calendar
        </span>
      )}
      <button className="btn sm ghost" onClick={onRefresh} title="Refresh Google Calendar" style={{ padding: '0 5px', height: 24 }}>
        <Icon name="refresh" size={11} />
      </button>
    </div>
  )
}

export function NewGoogleEventModal({ open, defaultDate, defaultTime, onClose, onCreated }) {
  const pad = (n) => String(n).padStart(2, '0')
  const nowH = new Date().getHours()
  const [title, setTitle] = React.useState('')
  const [date, setDate] = React.useState(defaultDate || '')
  const [startTime, setStartTime] = React.useState(defaultTime || `${pad(nowH < 23 ? nowH + 1 : nowH)}:00`)
  const [dur, setDur] = React.useState(60)
  const [desc, setDesc] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    const nowH2 = new Date().getHours()
    setTitle(''); setDesc(''); setSaving(false)
    setDate(defaultDate || '')
    setStartTime(defaultTime || `${pad(nowH2 < 23 ? nowH2 + 1 : nowH2)}:00`)
    setDur(60)
  }, [open, defaultDate, defaultTime]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const submit = async () => {
    if (!title.trim()) return
    const startDt = new Date(`${date}T${startTime}`)
    const endDt = new Date(startDt.getTime() + Number(dur) * 60000)
    const fmtUTC = (d) => d.toISOString().slice(0, 19) + 'Z'
    setSaving(true)
    try {
      await createGoogleCalendarEvent({ title: title.trim(), start: fmtUTC(startDt), end: fmtUTC(endDt), description: desc.trim() || undefined })
      toast?.('Google Calendar event created.', 'success')
      onCreated?.()
      onClose()
    } catch {
      toast?.('Failed to create event.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const inp = { width: '100%', boxSizing: 'border-box', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 13, outline: 'none' }
  const lbl = { fontSize: 10.5, fontWeight: 700, color: 'var(--text-subtle)', marginBottom: 4, display: 'block', textTransform: 'uppercase', letterSpacing: '.05em' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 210, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, boxShadow: '0 24px 64px rgba(0,0,0,.18)', width: 420, maxWidth: '92vw', overflow: 'hidden' }}>
        <div style={{ height: 4, background: 'var(--success)' }} />
        <div style={{ padding: '22px 24px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <div style={{ fontSize: 16, fontWeight: 650, color: 'var(--text)', flex: 1 }}>New Google Calendar event</div>
            <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              <Icon name="x" size={13} />
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={lbl}>Title</label>
              <input autoFocus style={inp} value={title} onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose() }}
                placeholder="Event title" />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1.4 }}>
                <label style={lbl}>Date</label>
                <input type="date" style={inp} value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Start</label>
                <input type="time" style={inp} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
              <div style={{ flex: 0.8 }}>
                <label style={lbl}>Mins</label>
                <input type="number" min={15} step={15} style={inp} value={dur} onChange={(e) => setDur(e.target.value)} />
              </div>
            </div>
            <div>
              <label style={lbl}>Description</label>
              <textarea rows={2} style={{ ...inp, resize: 'vertical' }} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <button className="btn sm ghost" onClick={onClose}>Cancel</button>
            <button className="btn sm primary" onClick={submit} disabled={!title.trim() || saving}>
              {saving ? 'Creating…' : 'Create event'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const VIEWS = [
  { id: 'year', label: 'Year' },
  { id: 'month', label: 'Month' },
  { id: 'week', label: 'Week' },
  { id: 'workweek', label: 'Work Week' },
  { id: 'agenda', label: 'Agenda' },
]

export function CalendarView({ calendarEvents, setCalendarEvents, onNavigatePlanner }) {
  const [calView, setCalView] = React.useState('week')
  const [offset, setOffset] = React.useState(0)
  const [selectedEvent, setSelectedEvent] = React.useState(null)
  const [nowPx, setNowPx] = React.useState(nowTopPx)
  const scrollRef = React.useRef(null)

  const today = todayStr()

  React.useEffect(() => {
    const id = setInterval(() => setNowPx(nowTopPx()), 60000)
    return () => clearInterval(id)
  }, [])

  React.useEffect(() => {
    if ((calView !== 'week' && calView !== 'workweek') || offset !== 0 || !scrollRef.current) return
    const px = nowTopPx()
    if (px !== null) scrollRef.current.scrollTop = Math.max(0, px - 120)
  }, [calView, offset])

  const updateLocalEvent = (id, patch) => {
    const oldEv = (calendarEvents || []).find((e) => String(e.id) === String(id))
    if (!oldEv || oldEv.source !== 'local') return
    setCalendarEvents((prev) => prev.map((e) => (String(e.id) === String(id) ? { ...e, ...patch } : e)))
    toast?.('Calendar entry updated', 'success')
  }

  const deleteLocalEvent = (id) => {
    const oldEv = (calendarEvents || []).find((e) => String(e.id) === String(id))
    if (!oldEv || oldEv.source !== 'local') return
    setCalendarEvents((prev) => prev.filter((e) => String(e.id) !== String(id)))
    toast?.('Calendar entry deleted', 'success')
  }

  const moveLocalEvent = (id, newDateStr) => {
    const ev = (calendarEvents || []).find((e) => String(e.id) === String(id))
    if (!ev || !newDateStr || ev.source !== 'local') return
    if (ev.start && ev.start.slice(0, 10) === newDateStr) return
    const pad = (n) => String(n).padStart(2, '0')
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    const time = ev.start ? ev.start.slice(11) : '09:00'
    const newStart = `${newDateStr}T${time || '09:00'}`
    let newEnd = ev.end
    if (ev.start && ev.end) {
      const durMs = new Date(ev.end) - new Date(ev.start)
      newEnd = fmt(new Date(new Date(newStart).getTime() + durMs))
    }
    updateLocalEvent(id, { start: newStart, end: newEnd })
  }

  const allEvents = React.useMemo(() => (calendarEvents || []).map((ev) => ({ source: 'local', ...ev })), [calendarEvents])

  const viewDays = React.useMemo(() => {
    if (calView === 'week') return getWeekDays(offset, false)
    if (calView === 'workweek') return getWeekDays(offset, true)
    if (calView === 'month') return getMonthGrid(offset).days
    if (calView === 'agenda') return getAgendaDays(offset)
    return []
  }, [calView, offset])

  const eventsByDay = React.useMemo(() => {
    const map = {}
    viewDays.forEach((d) => { map[isoDate(d)] = [] })
    allEvents.forEach((ev) => {
      if (!ev.start) return
      const k = ev.start.length === 10 ? ev.start : isoDate(new Date(ev.start))
      if (map[k]) map[k].push(ev)
    })
    return map
  }, [allEvents, viewDays])

  const headerTitle = React.useMemo(() => {
    if (calView === 'week') {
      const days = getWeekDays(offset, false)
      const opts = { month: 'short', day: 'numeric' }
      return `${days[0].toLocaleDateString([], opts)} – ${days[6].toLocaleDateString([], { ...opts, year: 'numeric' })}`
    }
    if (calView === 'workweek') {
      const days = getWeekDays(offset, true)
      const opts = { month: 'short', day: 'numeric' }
      return `${days[0].toLocaleDateString([], opts)} – ${days[4].toLocaleDateString([], { ...opts, year: 'numeric' })}`
    }
    if (calView === 'month') {
      const { year, month } = getMonthGrid(offset)
      return `${MONTH_NAMES[month]} ${year}`
    }
    if (calView === 'year') return `${new Date().getFullYear() + offset}`
    if (calView === 'agenda') {
      const ds = getAgendaDays(offset)
      return `${MONTH_SHORT[ds[0].getMonth()]} – ${MONTH_SHORT[ds[ds.length - 1].getMonth()]} ${ds[ds.length - 1].getFullYear()}`
    }
    return ''
  }, [calView, offset])

  const isCurrentPeriod = offset === 0
  const monthGrid = React.useMemo(() => (calView === 'month' ? getMonthGrid(offset) : null), [calView, offset])
  const yearMonths = React.useMemo(() => (calView === 'year' ? getYearMonths(offset) : null), [calView, offset])
  const agendaDays = React.useMemo(() => (calView === 'agenda' ? getAgendaDays(offset) : null), [calView, offset])
  const weekDays = React.useMemo(() => ((calView === 'week' || calView === 'workweek') ? getWeekDays(offset, calView === 'workweek') : null), [calView, offset])

  const handleViewChange = (v) => { setCalView(v); setOffset(0) }

  return (
    <div>
      {selectedEvent && (
        <EventDetailModal event={selectedEvent} onClose={() => setSelectedEvent(null)} onOpenPlanner={(ev) => onNavigatePlanner?.(ev)}
          onUpdate={updateLocalEvent} onDelete={(id) => { deleteLocalEvent(id); setSelectedEvent(null) }} />
      )}

      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <div className="sub">{headerTitle}</div>
        </div>
        <div className="page-head-actions" style={{ gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)', padding: '3px 4px', gap: 2 }}>
            {VIEWS.map((v) => (
              <button key={v.id} className={`cal-view-btn${calView === v.id ? ' active' : ''}`} onClick={() => handleViewChange(v.id)}>
                {v.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '3px 4px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)' }}>
            <button className="cal-nav-btn" onClick={() => setOffset((v) => v - 1)} title="Previous">
              <Icon name="chevron-left" size={14} />
            </button>
            <button onClick={() => setOffset(0)}
              style={{ height: 28, padding: '0 12px', borderRadius: 7, border: 'none', cursor: 'pointer', background: isCurrentPeriod ? 'var(--accent)' : 'transparent', color: isCurrentPeriod ? 'var(--accent-fg)' : 'var(--text-muted)', fontSize: 12.5, fontWeight: 600 }}>
              Today
            </button>
            <button className="cal-nav-btn" onClick={() => setOffset((v) => v + 1)} title="Next">
              <Icon name="chevron-right" size={14} />
            </button>
          </div>
        </div>
      </div>

      {(calView === 'week' || calView === 'workweek') && weekDays && (
        <WeekGrid days={weekDays} eventsByDay={eventsByDay} today={today} isCurrentPeriod={isCurrentPeriod} nowPx={nowPx}
          onEventClick={setSelectedEvent} scrollRef={scrollRef} onMoveEvent={moveLocalEvent} onUpdateEvent={updateLocalEvent} onNewGoogleEvent={null} />
      )}
      {calView === 'month' && monthGrid && (
        <MonthView eventsByDay={eventsByDay} monthGrid={monthGrid} today={today} onEventClick={setSelectedEvent} onMoveEvent={moveLocalEvent} />
      )}
      {calView === 'year' && (
        <YearView year={new Date().getFullYear() + offset} allEvents={allEvents} today={today}
          onDayClick={(key) => {
            const d = new Date(key)
            const now = new Date()
            const diffMonths = (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth())
            handleViewChange('month'); setOffset(diffMonths)
          }} />
      )}
      {calView === 'agenda' && agendaDays && (
        <AgendaView agendaDays={agendaDays} eventsByDay={eventsByDay} today={today} onEventClick={setSelectedEvent} />
      )}
    </div>
  )
}
