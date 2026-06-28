// view-calendar.jsx — web calendar. The shared layer (OutlookService, date math,
// day/week/month/year/agenda rendering, event/setup modals) lives in @nexusmd/ui;
// this file keeps web-only Google Calendar integration + the desktop CalendarView
// orchestrator (page-head chrome, Outlook + Google wiring).
import React from 'react';
import { usePersisted } from './components.jsx';
import { Icon } from './icons.jsx';
import { GoogleAuth } from './google-auth.js';
import { toast } from './toast.jsx';
import {
  OutlookService, getWeekDays, getMonthGrid, getYearMonths, getAgendaDays,
  nowTopPx, todayStr, isoDate, MONTH_NAMES, MONTH_SHORT,
  EventDetailModal, OutlookBanner, WeekGrid, MonthView, YearView, AgendaView,
} from '@nexusmd/ui';
// app.jsx imports OutlookService from here (quick-add → createEvent); keep it
// re-exported so that import path is unchanged.
export { OutlookService };

const { useState: useStateCal, useMemo: useMemoCal, useEffect: useEffectCal, useRef: useRefCal } = React;

// ── GoogleCalendarBanner ──────────────────────────────────────────
function GoogleCalendarBanner({ syncing, error, onRefresh }) {
  const connected = GoogleAuth?.isConnected();
  if (!connected) return null;
  return (
    <div style={{ display:'flex',alignItems:'center',gap:6 }}>
      {syncing && <span style={{ fontSize:11,color:'var(--text-muted)',display:'flex',alignItems:'center',gap:4 }}><span style={{ width:6,height:6,borderRadius:'50%',background:'var(--success)',display:'inline-block' }}/> Google</span>}
      {error   && <span style={{ fontSize:11,color:'var(--danger)' }} title={error}>Google sync error</span>}
      {!syncing && !error && (
        <span style={{ display:'flex',alignItems:'center',gap:5,fontSize:12,color:'var(--text-muted)' }}>
          <span style={{ width:7,height:7,borderRadius:'50%',background:'var(--success)',display:'inline-block' }}/>
          Google Calendar
        </span>
      )}
      <button className="btn sm ghost" onClick={onRefresh} title="Refresh Google Calendar" style={{ padding:'0 5px',height:24 }}>
        <Icon name="refresh" size={11}/>
      </button>
    </div>
  );
}

// ── NewGoogleEventModal ───────────────────────────────────────────
function NewGoogleEventModal({ open, defaultDate, defaultTime, onClose, onCreated }) {
  const pad = n => String(n).padStart(2, '0');
  const nowH = new Date().getHours();
  const [title,     setTitle]     = useStateCal('');
  const [date,      setDate]      = useStateCal(defaultDate || todayStr());
  const [startTime, setStartTime] = useStateCal(defaultTime || `${pad(nowH < 23 ? nowH + 1 : nowH)}:00`);
  const [dur,       setDur]       = useStateCal(60);
  const [desc,      setDesc]      = useStateCal('');
  const [saving,    setSaving]    = useStateCal(false);

  useEffectCal(() => {
    if (!open) return;
    const nowH2 = new Date().getHours();
    setTitle(''); setDesc(''); setSaving(false);
    setDate(defaultDate || todayStr());
    setStartTime(defaultTime || `${pad(nowH2 < 23 ? nowH2 + 1 : nowH2)}:00`);
    setDur(60);
  }, [open, defaultDate, defaultTime]);

  if (!open) return null;

  const submit = async () => {
    if (!title.trim()) return;
    const token = GoogleAuth?.getAuth()?.accessToken;
    if (!token) return;
    const startDt = new Date(`${date}T${startTime}`);
    const endDt   = new Date(startDt.getTime() + Number(dur) * 60000);
    const fmtUTC = d => d.toISOString().slice(0, 19);
    setSaving(true);
    try {
      const res = await fetch('/api/google/calendar/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, title: title.trim(), start: fmtUTC(startDt), end: fmtUTC(endDt), description: desc.trim() || null }),
        signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) { toast?.('Google Calendar event created.', 'success'); onCreated?.(); onClose(); }
      else         { toast?.('Failed to create event.', 'error'); }
    } catch { toast?.('Failed to create event.', 'error'); }
    finally { setSaving(false); }
  };

  const inp = { width:'100%',boxSizing:'border-box',border:'1px solid var(--border)',borderRadius:8,padding:'7px 10px',background:'var(--surface-2)',color:'var(--text)',fontSize:13,outline:'none' };
  const lbl = { fontSize:10.5,fontWeight:700,color:'var(--text-subtle)',marginBottom:4,display:'block',textTransform:'uppercase',letterSpacing:'.05em' };

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.35)',zIndex:210,display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(2px)' }}
      onClick={e => { if (e.target===e.currentTarget) onClose(); }}>
      <div style={{ background:'var(--surface)',border:'1px solid var(--border)',borderRadius:20,boxShadow:'0 24px 64px rgba(0,0,0,.18)',width:420,maxWidth:'92vw',overflow:'hidden' }}>
        <div style={{ height:4,background:'var(--success)' }}/>
        <div style={{ padding:'22px 24px 20px' }}>
          <div style={{ display:'flex',alignItems:'center',gap:12,marginBottom:18 }}>
            <div style={{ fontSize:16,fontWeight:650,color:'var(--text)',flex:1 }}>New Google Calendar event</div>
            <button onClick={onClose} style={{ width:28,height:28,borderRadius:8,border:'1px solid var(--border)',background:'var(--surface-2)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-muted)' }}>
              <Icon name="x" size={13}/>
            </button>
          </div>
          <div style={{ display:'flex',flexDirection:'column',gap:12 }}>
            <div>
              <label style={lbl}>Title</label>
              <input autoFocus style={inp} value={title} onChange={e=>setTitle(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter') submit(); if(e.key==='Escape') onClose(); }}
                placeholder="Event title"/>
            </div>
            <div style={{ display:'flex',gap:10 }}>
              <div style={{ flex:1.4 }}>
                <label style={lbl}>Date</label>
                <input type="date" style={inp} value={date} onChange={e=>setDate(e.target.value)}/>
              </div>
              <div style={{ flex:1 }}>
                <label style={lbl}>Start</label>
                <input type="time" style={inp} value={startTime} onChange={e=>setStartTime(e.target.value)}/>
              </div>
              <div style={{ flex:0.8 }}>
                <label style={lbl}>Mins</label>
                <input type="number" min={15} step={15} style={inp} value={dur} onChange={e=>setDur(e.target.value)}/>
              </div>
            </div>
            <div>
              <label style={lbl}>Description</label>
              <textarea rows={2} style={{ ...inp,resize:'vertical',fontFamily:'var(--sans)' }} value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Optional"/>
            </div>
          </div>
          <div style={{ display:'flex',gap:8,justifyContent:'flex-end',marginTop:20,paddingTop:16,borderTop:'1px solid var(--border)' }}>
            <button className="btn sm ghost" onClick={onClose}>Cancel</button>
            <button className="btn sm primary" onClick={submit} disabled={!title.trim()||saving} style={{ gap:6 }}>
              {saving ? 'Creating…' : <><Icon name="plus" size={11}/>Create event</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── CalendarView ──────────────────────────────────────────────
export function CalendarView({ calendarEvents, onNavigatePlanner, onUpdateEvent, onDeleteEvent, onMoveEvent }) {
  const [calView, setCalView]             = useStateCal('week');
  const [offset, setOffset]               = useStateCal(0);
  const [selectedEvent, setSelectedEvent] = useStateCal(null);
  const [nowPx, setNowPx]                 = useStateCal(nowTopPx);
  const scrollRef                         = useRefCal(null);

  const [outlookConfig, setOutlookConfig]           = usePersisted('nexusmd.outlook.config', { clientId:'', tenantId:'common' });
  const [outlookConnected, setOutlookConnected]     = useStateCal(false);
  const [outlookDisplayName, setOutlookDisplayName] = useStateCal(null);
  const [outlookEvents, setOutlookEvents]           = useStateCal([]);
  const [outlookSyncing, setOutlookSyncing]         = useStateCal(false);
  const [outlookError, setOutlookError]             = useStateCal(null);

  const [googleEvents, setGoogleEvents]   = useStateCal([]);
  const [googleSyncing, setGoogleSyncing] = useStateCal(false);
  const [googleError, setGoogleError]     = useStateCal(null);
  const [googleTick, setGoogleTick]       = useStateCal(0);

  const [newGoogleOpen, setNewGoogleOpen]       = useStateCal(false);
  const [newGoogleDate, setNewGoogleDate]       = useStateCal(null);
  const [newGoogleTime, setNewGoogleTime]       = useStateCal(null);

  const openNewGoogleEvent = (date, time) => {
    setNewGoogleDate(date || todayStr());
    setNewGoogleTime(time || null);
    setNewGoogleOpen(true);
  };

  const today = todayStr();

  // Clock tick
  useEffectCal(() => {
    const id = setInterval(() => setNowPx(nowTopPx()), 60000);
    return () => clearInterval(id);
  }, []);

  // Auto-scroll to current time on week views
  useEffectCal(() => {
    if ((calView!=='week'&&calView!=='workweek') || offset!==0 || !scrollRef.current) return;
    const px = nowTopPx();
    if (px!==null) scrollRef.current.scrollTop = Math.max(0, px-120);
  }, [calView, offset]);

  // MSAL init
  useEffectCal(() => {
    if (!outlookConfig?.clientId) return;
    OutlookService.reset();
    OutlookService.init(outlookConfig.clientId, outlookConfig.tenantId||'common').then(() => {
      if (OutlookService.isConnected()) { setOutlookConnected(true); setOutlookDisplayName(OutlookService.getDisplayName()); }
    }).catch(console.error);
  }, [outlookConfig?.clientId, outlookConfig?.tenantId]);

  // Fetch Outlook events — range depends on view
  useEffectCal(() => {
    if (!outlookConnected) return;
    setOutlookSyncing(true); setOutlookError(null);
    let startD, endD;
    if (calView==='month') {
      const { days } = getMonthGrid(offset);
      startD = days[0]; endD = new Date(days[days.length-1].getTime()+86400000);
    } else if (calView==='year') {
      const y = new Date().getFullYear()+offset;
      startD = new Date(y,0,1); endD = new Date(y+1,0,1);
    } else if (calView==='agenda') {
      const ds = getAgendaDays(offset); startD=ds[0]; endD=new Date(ds[ds.length-1].getTime()+86400000);
    } else {
      const days = getWeekDays(offset, calView==='workweek');
      startD = days[0]; endD = new Date(days[days.length-1].getTime()+86400000);
    }
    OutlookService.fetchWeekEvents(startD.toISOString(), endD.toISOString())
      .then(evs => setOutlookEvents(evs)).catch(e=>setOutlookError(e.message)).finally(()=>setOutlookSyncing(false));
  }, [outlookConnected, calView, offset]);

  // Fetch Google Calendar events when connected
  useEffectCal(() => {
    if (!GoogleAuth?.isConnected()) return;
    setGoogleSyncing(true); setGoogleError(null);
    let startD, endD;
    if (calView==='month') {
      const { days } = getMonthGrid(offset);
      startD = days[0]; endD = new Date(days[days.length-1].getTime()+86400000);
    } else if (calView==='year') {
      const y = new Date().getFullYear()+offset;
      startD = new Date(y,0,1); endD = new Date(y+1,0,1);
    } else if (calView==='agenda') {
      const ds = getAgendaDays(offset); startD=ds[0]; endD=new Date(ds[ds.length-1].getTime()+86400000);
    } else {
      const days = getWeekDays(offset, calView==='workweek');
      startD = days[0]; endD = new Date(days[days.length-1].getTime()+86400000);
    }
    const token = GoogleAuth.getAuth()?.accessToken;
    if (!token) { setGoogleSyncing(false); return; }
    const start = startD.toISOString().slice(0,10);
    const end   = endD.toISOString().slice(0,10);
    fetch(`/api/google/calendar/events?token=${encodeURIComponent(token)}&start=${start}&end=${end}`, { signal: AbortSignal.timeout(12_000) })
      .then(r => r.ok ? r.json() : r.json().then(b => Promise.reject(b?.error || r.status)))
      .then(evs => {
        setGoogleEvents(evs.map(e => ({
          id: `google-${e.id}`, title: e.title, start: e.start, end: e.end,
          type: 'meeting', source: 'google', description: e.location || '',
          personName: null, personId: null, plannerSection: null,
        })));
      })
      .catch(err => setGoogleError(String(err)))
      .finally(() => setGoogleSyncing(false));
  }, [calView, offset, googleTick]);

  // Re-fetch Google events when auth changes
  useEffectCal(() => {
    const handler = () => setGoogleTick(t => t + 1);
    document.addEventListener('google:auth:changed', handler);
    return () => document.removeEventListener('google:auth:changed', handler);
  }, []);

  const handleDeleteEvent = async (id) => {
    const sid = String(id);
    if (sid.startsWith('google-')) {
      const token = GoogleAuth?.getAuth()?.accessToken;
      if (!token) return;
      const eventId = sid.slice(7);
      try {
        const res = await fetch(`/api/google/calendar/events/${encodeURIComponent(eventId)}?token=${encodeURIComponent(token)}`, {
          method: 'DELETE', signal: AbortSignal.timeout(10_000),
        });
        if (res.ok || res.status === 204) {
          setGoogleEvents(evs => evs.filter(e => e.id !== sid));
          toast?.('Event deleted from Google Calendar.', 'success');
        } else {
          toast?.('Failed to delete event.', 'error');
        }
      } catch { toast?.('Failed to delete event.', 'error'); }
    } else {
      onDeleteEvent?.(id);
    }
  };

  const handleConnect    = async () => { try { const a=await OutlookService.signIn(); setOutlookConnected(true); setOutlookDisplayName(a.name||a.username); } catch(e){ setOutlookError(e.message); } };
  const handleDisconnect = async () => { await OutlookService.signOut(); setOutlookConnected(false); setOutlookDisplayName(null); setOutlookEvents([]); };

  const allEvents = useMemoCal(() => {
    const local = (calendarEvents||[]).map(ev=>({source:'local',...ev}));
    return [...local,...outlookEvents,...googleEvents];
  }, [calendarEvents, outlookEvents, googleEvents]);

  // Build event-by-day map for current view window
  const viewDays = useMemoCal(() => {
    if (calView==='week')     return getWeekDays(offset, false);
    if (calView==='workweek') return getWeekDays(offset, true);
    if (calView==='month')    return getMonthGrid(offset).days;
    if (calView==='agenda')   return getAgendaDays(offset);
    return [];
  }, [calView, offset]);

  const eventsByDay = useMemoCal(() => {
    const map = {};
    viewDays.forEach(d => { map[isoDate(d)] = []; });
    allEvents.forEach(ev => {
      if (!ev.start) return;
      const k = ev.start.length === 10 ? ev.start : isoDate(new Date(ev.start));
      if (map[k]) map[k].push(ev);
    });
    return map;
  }, [allEvents, viewDays]);

  // ── Header title ──
  const headerTitle = useMemoCal(() => {
    if (calView==='week') {
      const days = getWeekDays(offset,false);
      const opts = {month:'short',day:'numeric'};
      return `${days[0].toLocaleDateString([],opts)} – ${days[6].toLocaleDateString([],{...opts,year:'numeric'})}`;
    }
    if (calView==='workweek') {
      const days = getWeekDays(offset,true);
      const opts = {month:'short',day:'numeric'};
      return `${days[0].toLocaleDateString([],opts)} – ${days[4].toLocaleDateString([],{...opts,year:'numeric'})}`;
    }
    if (calView==='month') {
      const {year,month} = getMonthGrid(offset);
      return `${MONTH_NAMES[month]} ${year}`;
    }
    if (calView==='year') {
      return `${new Date().getFullYear()+offset}`;
    }
    if (calView==='agenda') {
      const ds = getAgendaDays(offset);
      return `${MONTH_SHORT[ds[0].getMonth()]} – ${MONTH_SHORT[ds[ds.length-1].getMonth()]} ${ds[ds.length-1].getFullYear()}`;
    }
    return '';
  }, [calView, offset]);

  const isCurrentPeriod = offset === 0;

  const monthGrid   = useMemoCal(() => calView==='month'   ? getMonthGrid(offset)  : null, [calView,offset]);
  const yearMonths  = useMemoCal(() => calView==='year'    ? getYearMonths(offset) : null, [calView,offset]);
  const agendaDays  = useMemoCal(() => calView==='agenda'  ? getAgendaDays(offset) : null, [calView,offset]);
  const weekDays    = useMemoCal(() => (calView==='week'||calView==='workweek') ? getWeekDays(offset, calView==='workweek') : null, [calView,offset]);

  const handleViewChange = (v) => { setCalView(v); setOffset(0); };

  const VIEWS = [
    { id:'year',     label:'Year'      },
    { id:'month',    label:'Month'     },
    { id:'week',     label:'Week'      },
    { id:'workweek', label:'Work Week' },
    { id:'agenda',   label:'Agenda'    },
  ];

  return (
    <div>
      {selectedEvent && (
        <EventDetailModal event={selectedEvent} onClose={()=>setSelectedEvent(null)} onOpenPlanner={ev=>onNavigatePlanner?.(ev)}
          onUpdate={onUpdateEvent} onDelete={handleDeleteEvent}/>
      )}
      <NewGoogleEventModal
        open={newGoogleOpen}
        defaultDate={newGoogleDate}
        defaultTime={newGoogleTime}
        onClose={() => setNewGoogleOpen(false)}
        onCreated={() => setGoogleTick(t => t + 1)}
      />

      {/* ── Page header ── */}
      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <div className="sub">{headerTitle}</div>
        </div>
        <div className="page-head-actions" style={{ gap:8 }}>
          <OutlookBanner config={outlookConfig} onSaveConfig={setOutlookConfig} connected={outlookConnected}
            displayName={outlookDisplayName} syncing={outlookSyncing} error={outlookError}
            onConnect={handleConnect} onDisconnect={handleDisconnect}/>
          <GoogleCalendarBanner syncing={googleSyncing} error={googleError} onRefresh={() => setGoogleTick(t => t + 1)}/>
          {GoogleAuth?.isConnected() && (
            <button className="btn sm ghost" onClick={() => openNewGoogleEvent(today, null)}
              style={{ display:'flex',alignItems:'center',gap:5,fontSize:12 }} title="New Google Calendar event">
              <Icon name="plus" size={11}/> New event
            </button>
          )}

          {/* View switcher */}
          <div style={{ display:'flex',alignItems:'center',background:'var(--surface-2)',borderRadius:10,border:'1px solid var(--border)',padding:'3px 4px',gap:2 }}>
            {VIEWS.map(v => (
              <button key={v.id} className={`cal-view-btn${calView===v.id?' active':''}`} onClick={()=>handleViewChange(v.id)}>
                {v.label}
              </button>
            ))}
          </div>

          {/* Navigation cluster */}
          <div style={{ display:'flex',alignItems:'center',gap:2,padding:'3px 4px',background:'var(--surface-2)',borderRadius:10,border:'1px solid var(--border)' }}>
            <button className="cal-nav-btn" onClick={()=>setOffset(v=>v-1)} title="Previous">
              <Icon name="chevron-left" size={14}/>
            </button>
            <button onClick={()=>setOffset(0)}
              style={{ height:28,padding:'0 12px',borderRadius:7,border:'none',cursor:'pointer',
                background:isCurrentPeriod?'var(--accent)':'transparent',
                color:isCurrentPeriod?'var(--accent-fg)':'var(--text-muted)',
                fontSize:12.5,fontWeight:600,transition:'background .15s,color .15s' }}>
              Today
            </button>
            <button className="cal-nav-btn" onClick={()=>setOffset(v=>v+1)} title="Next">
              <Icon name="chevron-right" size={14}/>
            </button>
          </div>
        </div>
      </div>

      {/* ── View content ── */}
      {(calView==='week'||calView==='workweek') && weekDays && (
        <WeekGrid days={weekDays} eventsByDay={eventsByDay} today={today}
          isCurrentPeriod={isCurrentPeriod} nowPx={nowPx}
          onEventClick={setSelectedEvent} scrollRef={scrollRef} onMoveEvent={onMoveEvent} onUpdateEvent={onUpdateEvent}
          onNewGoogleEvent={GoogleAuth?.isConnected() ? openNewGoogleEvent : null}/>
      )}

      {calView==='month' && monthGrid && (
        <MonthView eventsByDay={eventsByDay} monthGrid={monthGrid} today={today} onEventClick={setSelectedEvent} onMoveEvent={onMoveEvent}/>
      )}

      {calView==='year' && (
        <YearView year={new Date().getFullYear()+offset} allEvents={allEvents} today={today}
          onDayClick={key => {
            const d = new Date(key);
            const now = new Date();
            const diffMonths = (d.getFullYear()-now.getFullYear())*12+(d.getMonth()-now.getMonth());
            handleViewChange('month'); setOffset(diffMonths);
          }}/>
      )}

      {calView==='agenda' && agendaDays && (
        <AgendaView agendaDays={agendaDays} eventsByDay={eventsByDay} today={today} onEventClick={setSelectedEvent}/>
      )}
    </div>
  );
}
