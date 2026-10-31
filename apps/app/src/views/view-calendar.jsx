// view-calendar.jsx — app (mobile) calendar. The shared layer (OutlookService,
// date math, day/week/month/year/agenda rendering, event/setup modals) lives in
// @nexusmd/ui; this file keeps the mobile CalendarView orchestrator (m-appbar/
// m-screen chrome). Outlook uses the app's redirect URI and omits interactive
// MSAL sign-in (a Capacitor webview can't do popups).
import React from 'react';
import { Icon } from '../icons.jsx';
import { NewEventSheet } from './calendar-new-event.jsx';
import { DayTimeline } from './day-timeline.jsx';
import { EventSheet } from './event-sheet.jsx';
import { shiftEvent, eventBadge } from '../calendar-phone.js';
import { fetchGoogleEvents } from '../google-calendar.js';
import { isOAuthConnected } from '../cloud-auth.js';
import {
  OutlookService, getWeekDays, getMonthGrid, getYearMonths, getAgendaDays,
  nowTopPx, todayStr, isoDate, MONTH_NAMES, MONTH_SHORT,
  EventDetailModal, OutlookBanner, WeekGrid, MonthView, YearView, AgendaView,
} from '@nexusmd/ui';

const { useState: useStateCal, useMemo: useMemoCal, useEffect: useEffectCal, useRef: useRefCal } = React;

// app.jsx's quick-add reads window.OutlookService to push an event to Outlook.
window.OutlookService = OutlookService;

// ── CalendarView ──────────────────────────────────────────────────
// Phone: Agenda (week strip + the day's list) or Month (grid + the day's list). Both share
// the selected day, mapped onto the week/month ranges the desktop views already fetch.
const dayOffset = (d, unit) => {
  const now = new Date();
  if (unit === 'month') return (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth();
  const mon = n => { const x = new Date(n); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() || 7) - 1)); return x; };
  return Math.round((mon(d) - mon(now)) / (7 * 86400000));
};
const fmtTime = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function CalendarView({ calendarEvents, onNavigatePlanner, onUpdateEvent, onDeleteEvent, onMoveEvent, onAddEvent, onAddToPlanner, canAddToPlanner, onFlash, device }) {
  const phone = device === 'phone';
  const [tView, setCalView]               = useStateCal('week');
  const [tOffset, setOffset]              = useStateCal(0);
  const [phoneMode, setPhoneMode]         = useStateCal('agenda');
  const [selDay, setSelDay]               = useStateCal(() => new Date());
  const [newEventOpen, setNewEventOpen]   = useStateCal(false);
  const [newEventTime, setNewEventTime]   = useStateCal(null);
  const [actionEvent, setActionEvent]     = useStateCal(null);
  const calView = phone ? (phoneMode === 'agenda' ? 'week' : 'month') : tView;
  const offset  = phone ? dayOffset(selDay, phoneMode === 'agenda' ? 'week' : 'month') : tOffset;
  const [selectedEvent, setSelectedEvent] = useStateCal(null);
  const [nowPx, setNowPx]                 = useStateCal(nowTopPx);
  const scrollRef                         = useRefCal(null);

  const [outlookConfig, setOutlookConfig]           = usePersisted('helm.outlook.config', { clientId:'', tenantId:'common' });
  const [outlookConnected, setOutlookConnected]     = useStateCal(false);
  const [outlookDisplayName, setOutlookDisplayName] = useStateCal(null);
  const [outlookEvents, setOutlookEvents]           = useStateCal([]);
  const [outlookSyncing, setOutlookSyncing]         = useStateCal(false);
  const [outlookError, setOutlookError]             = useStateCal(null);

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
    OutlookService.init(outlookConfig.clientId, outlookConfig.tenantId||'common', 'https://nexus.app').then(() => {
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

  // Google Calendar (read-only): events for the same window the Outlook fetch uses.
  const [googleEvents, setGoogleEvents] = useStateCal([]);
  const [googleError, setGoogleError]   = useStateCal(null);
  const [googleTick, setGoogleTick]     = useStateCal(0);
  useEffectCal(() => {
    const bump = () => setGoogleTick(t => t + 1);
    window.addEventListener('nexusmd:cloud-auth-changed', bump);
    return () => window.removeEventListener('nexusmd:cloud-auth-changed', bump);
  }, []);
  useEffectCal(() => {
    if (!isOAuthConnected('google')) { setGoogleEvents([]); setGoogleError(null); return; }
    let startD, endD;
    if (calView==='month') {
      const { days } = getMonthGrid(offset);
      startD = days[0]; endD = new Date(days[days.length-1].getTime()+86400000);
    } else {
      const days = getWeekDays(offset, calView==='workweek');
      startD = days[0]; endD = new Date(days[days.length-1].getTime()+86400000);
    }
    let live = true;
    fetchGoogleEvents(startD, endD)
      .then(evs => { if (live) { setGoogleEvents(evs); setGoogleError(null); } })
      .catch(e => { if (live) setGoogleError(e.message); });
    return () => { live = false; };
  }, [calView, offset, googleTick]);

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
    allEvents.forEach(ev => { const k=ev.start?.slice(0,10); if (map[k]) map[k].push(ev); });
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

  // Arrows move by week in Agenda and by month in Month; Today returns to now.
  const stepSel = dir => setSelDay(d => {
    const n = new Date(d);
    if (phoneMode === 'agenda') n.setDate(n.getDate() + 7 * dir); else n.setMonth(n.getMonth() + dir, 1);
    return n;
  });
  const selKey = isoDate(selDay);
  const dayEvents = (eventsByDay[selKey] || []).slice().sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const stripDays = getWeekDays(dayOffset(selDay, 'week'), false);
  const monthDays = phoneMode === 'month' ? getMonthGrid(offset) : null;

  const dayList = (
    <div className="m-card flush" style={{ marginTop: 12 }}>
      {dayEvents.length === 0 && (
        <div className="m-empty" style={{ padding: 24 }}>
          <div className="et">Nothing scheduled</div>
          {onAddEvent && <button type="button" className="btn m-btn-lg" style={{ marginTop: 12 }} onClick={() => setNewEventOpen(true)}>Add an event</button>}
        </div>
      )}
      {dayEvents.map(ev => (
        <div key={ev.id} className="m-row" onClick={() => setActionEvent(ev)}>
          <div className="m-row-main">
            <div className="m-row-title">{ev.title} {eventBadge(ev) && <span className={`pill ${eventBadge(ev) === 'now' ? 'success' : 'warning'}`}>{eventBadge(ev) === 'now' ? 'Now' : 'Soon'}</span>}</div>
            <div className="m-row-sub">{ev.start ? fmtTime(ev.start) : ''}{ev.end ? ' – ' + fmtTime(ev.end) : ''}</div>
            <div className="m-row-meta">{ev.source === 'local' && <span className="pill accent">In Planner</span>}</div>
          </div>
          <Icon name="chevron-right" size={16} className="chev"/>
        </div>
      ))}
    </div>
  );

  const handleViewChange = (v) => { setCalView(v); setOffset(0); };

  const VIEWS = [
    { id:'year',     label:'Year'      },
    { id:'month',    label:'Month'     },
    { id:'week',     label:'Week'      },
    { id:'workweek', label:'Work Week' },
    { id:'agenda',   label:'Agenda'    },
  ];

  if (phone) return (
    <React.Fragment>
      {selectedEvent && (
        <EventDetailModal event={selectedEvent} onClose={()=>setSelectedEvent(null)} onOpenPlanner={ev=>onNavigatePlanner?.(ev)}
          onUpdate={onUpdateEvent} onDelete={onDeleteEvent}/>
      )}
      <div className="m-appbar">
        <div className="m-ab-lead"><div><h1>Calendar</h1><div className="m-ab-sub">{headerTitle}</div></div></div>
        <div className="m-ab-actions">
          <button type="button" className="m-iconbtn" title="Previous" onClick={() => stepSel(-1)}><Icon name="chevron-left" size={18}/></button>
          <button type="button" className="m-linkbtn" onClick={() => setSelDay(new Date())}>Today</button>
          <button type="button" className="m-iconbtn" title="Next" onClick={() => stepSel(1)}><Icon name="chevron-right" size={18}/></button>
        </div>
      </div>
      <div className="m-screen">
        {googleError && <div className="m-hint" role="alert" style={{ marginTop: 0, marginBottom: 10, color: 'var(--danger)' }}>Google Calendar couldn’t load: {googleError}</div>}
        <div className="m-seg" style={{ marginBottom: 12 }}>
          <button type="button" className={phoneMode === 'agenda' ? 'active' : ''} onClick={() => setPhoneMode('agenda')}>Agenda</button>
          <button type="button" className={phoneMode === 'month' ? 'active' : ''} onClick={() => setPhoneMode('month')}>Month</button>
        </div>
        {phoneMode === 'agenda' ? (
          <div className="m-weekstrip">
            {stripDays.map(d => { const k = isoDate(d); return (
              <button key={k} type="button" className={`m-day${k === selKey ? ' sel' : ''}${k === today ? ' today' : ''}`} onClick={() => setSelDay(d)}>
                <span className="dow">{d.toLocaleDateString([], { weekday: 'narrow' })}</span>
                <span className="num">{d.getDate()}</span>
                <span className={`dot${(eventsByDay[k] || []).length ? ' on' : ''}`}/>
              </button>
            ); })}
          </div>
        ) : (
          <div className="m-monthgrid">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => <span key={i} className="dow">{w}</span>)}
            {monthDays.days.map(d => { const k = isoDate(d); return (
              <button key={k} type="button" className={`m-day${k === selKey ? ' sel' : ''}${k === today ? ' today' : ''}${d.getMonth() !== monthDays.month ? ' out' : ''}`} onClick={() => setSelDay(d)}>
                <span className="num">{d.getDate()}</span>
                <span className={`dot${(eventsByDay[k] || []).length ? ' on' : ''}`}/>
              </button>
            ); })}
          </div>
        )}
        {phoneMode === 'month'
          ? <div style={{ marginTop: 12 }}><DayTimeline events={dayEvents} isToday={selKey === today} onPick={setActionEvent}
              onAddAt={onAddEvent ? (t) => { setNewEventTime(t); setNewEventOpen(true); } : undefined}/></div>
          : dayList}
      </div>
      {onAddEvent && (
        <button type="button" className="m-fab" aria-label="New event" onClick={() => setNewEventOpen(true)}><Icon name="plus" size={24}/></button>
      )}
      <EventSheet ev={actionEvent} onClose={() => setActionEvent(null)} canAddToPlanner={canAddToPlanner}
        onAddToPlanner={onAddToPlanner} onDetails={setSelectedEvent} onDelete={onDeleteEvent}
        onMoveLater={(ev) => {
          const before = { start: ev.start, end: ev.end };
          onUpdateEvent?.(ev.id, shiftEvent(ev, 30));
          onFlash?.('Moved 30 minutes later', 'clock', () => onUpdateEvent?.(ev.id, before));
        }}/>
      <NewEventSheet open={newEventOpen} onClose={() => { setNewEventOpen(false); setNewEventTime(null); }} dayKey={selKey} startTime={newEventTime}
        onAdd={(ev, opts) => { onAddEvent(ev, opts); setSelDay(new Date(ev.start)); }}
        canAddToPlanner={canAddToPlanner} outlookConnected={outlookConnected}/>
    </React.Fragment>
  );

  return (
    <React.Fragment>
      {selectedEvent && (
        <EventDetailModal event={selectedEvent} onClose={()=>setSelectedEvent(null)} onOpenPlanner={ev=>onNavigatePlanner?.(ev)}
          onUpdate={onUpdateEvent} onDelete={onDeleteEvent}/>
      )}

      <div className="m-appbar" style={{ flexWrap:'wrap', rowGap:8 }}>
        <div className="m-ab-lead" style={{ flex:'0 0 auto' }}>
          <div><h1>Calendar</h1><div className="m-ab-sub">{headerTitle}</div></div>
        </div>
        {/* Wraps under the title rather than squeezing it when the screen is only a little wider than a phone. */}
        <div className="m-ab-actions" style={{ gap:8, flexWrap:'wrap', justifyContent:'flex-end', marginLeft:'auto' }}>
          <OutlookBanner config={outlookConfig} onSaveConfig={setOutlookConfig} connected={outlookConnected}
            displayName={outlookDisplayName} syncing={outlookSyncing} error={outlookError}
            onConnect={handleConnect} onDisconnect={handleDisconnect}
            allowSetup={false} allowSignIn={false}/>

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

      <div className="m-screen">
        {googleError && <div className="m-hint" role="alert" style={{ marginTop: 0, marginBottom: 10, color: 'var(--danger)' }}>Google Calendar couldn’t load: {googleError}</div>}
      {/* ── View content ── */}
      {(calView==='week'||calView==='workweek') && weekDays && (
        <WeekGrid days={weekDays} eventsByDay={eventsByDay} today={today}
          isCurrentPeriod={isCurrentPeriod} nowPx={nowPx}
          onEventClick={setSelectedEvent} scrollRef={scrollRef} onMoveEvent={onMoveEvent} onUpdateEvent={onUpdateEvent}/>
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
    </React.Fragment>
  );
}

export { CalendarView };


