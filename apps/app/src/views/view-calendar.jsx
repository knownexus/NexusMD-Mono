// view-calendar.jsx — app (mobile) calendar. The shared layer (OutlookService,
// date math, day/week/month/year/agenda rendering, event/setup modals) lives in
// @nexusmd/ui; this file keeps the mobile CalendarView orchestrator (m-appbar/
// m-screen chrome). Outlook uses the app's redirect URI and omits interactive
// MSAL sign-in (a Capacitor webview can't do popups).
import React from 'react';
import { Icon } from '../icons.jsx';
import {
  OutlookService, getWeekDays, getMonthGrid, getYearMonths, getAgendaDays,
  nowTopPx, todayStr, isoDate, MONTH_NAMES, MONTH_SHORT,
  EventDetailModal, OutlookBanner, WeekGrid, MonthView, YearView, AgendaView,
} from '@nexusmd/ui';

const { useState: useStateCal, useMemo: useMemoCal, useEffect: useEffectCal, useRef: useRefCal } = React;

// app.jsx's quick-add reads window.OutlookService to push an event to Outlook.
window.OutlookService = OutlookService;

// ── CalendarView ──────────────────────────────────────────────────
function CalendarView({ calendarEvents, onNavigatePlanner, onUpdateEvent, onDeleteEvent, onMoveEvent }) {
  const [calView, setCalView]             = useStateCal('week');
  const [offset, setOffset]               = useStateCal(0);
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

  const handleConnect    = async () => { try { const a=await OutlookService.signIn(); setOutlookConnected(true); setOutlookDisplayName(a.name||a.username); } catch(e){ setOutlookError(e.message); } };
  const handleDisconnect = async () => { await OutlookService.signOut(); setOutlookConnected(false); setOutlookDisplayName(null); setOutlookEvents([]); };

  const allEvents = useMemoCal(() => {
    const local = (calendarEvents||[]).map(ev=>({source:'local',...ev}));
    return [...local,...outlookEvents];
  }, [calendarEvents, outlookEvents]);

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

  const handleViewChange = (v) => { setCalView(v); setOffset(0); };

  const VIEWS = [
    { id:'year',     label:'Year'      },
    { id:'month',    label:'Month'     },
    { id:'week',     label:'Week'      },
    { id:'workweek', label:'Work Week' },
    { id:'agenda',   label:'Agenda'    },
  ];

  return (
    <React.Fragment>
      {selectedEvent && (
        <EventDetailModal event={selectedEvent} onClose={()=>setSelectedEvent(null)} onOpenPlanner={ev=>onNavigatePlanner?.(ev)}
          onUpdate={onUpdateEvent} onDelete={onDeleteEvent}/>
      )}

      <div className="m-appbar">
        <div className="m-ab-lead">
          <h1>Calendar</h1>
          <div className="m-ab-sub">{headerTitle}</div>
        </div>
        <div className="m-ab-actions" style={{ gap:8 }}>
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


