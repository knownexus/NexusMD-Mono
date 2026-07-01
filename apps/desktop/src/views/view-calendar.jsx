// view-calendar.jsx — desktop Calendar view. Composes the shared calendar UI
// primitives from @nexusmd/ui with desktop-native Outlook/Google clients
// (../ms-graph-calendar.js, ../google-calendar.js) instead of the shared
// OutlookService (MSAL) or web's server-proxied Google fetch.
import React from 'react'
import { Icon, toast } from '@nexusmd/ui'
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
