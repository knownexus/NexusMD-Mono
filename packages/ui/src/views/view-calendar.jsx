// view-calendar.jsx — shared calendar layer (web + app). The duplicated ~970
// lines of OutlookService + date math + day/week/month/year/agenda rendering +
// event/setup modals. Each platform keeps its own CalendarView orchestrator
// (desktop page-head vs mobile m-appbar; Google integration is web-only) and
// imports these pieces. Platform divergences flow through props: OutlookService
// .init takes a redirectUri (web origin / app 'https://nexus.app'); OutlookBanner
// takes allowSetup/allowSignIn (the app omits interactive MSAL sign-in, which a
// Capacitor webview can't do); the Google-source branches activate via ev.source
// and an optional onNewGoogleEvent prop (web passes it, app doesn't).
import React from 'react';
import { PublicClientApplication } from '@azure/msal-browser';
import { Avatar } from '../app-components.jsx';
import { Icon } from '../icons.jsx';
import { graphJSON, graphFetch } from '@nexusmd/core';

// ── OutlookService — MSAL + shared Graph client ─────────────────
const OutlookService = (() => {
  const SCOPES = ['Calendars.ReadWrite'];
  let _app = null, _account = null;

  // getToken({force}) — matches the shape graphFetch/graphJSON expect. Tries
  // silent acquisition first; falls back to (or is forced into) an interactive
  // popup, same behavior as before this refactor.
  async function getToken({ force = false } = {}) {
    if (!_app) throw new Error('OutlookService not initialised');
    if (!force) {
      try {
        const r = await _app.acquireTokenSilent({ scopes: SCOPES, account: _account });
        return r.accessToken;
      } catch (_) { /* fall through to popup */ }
    }
    const r = await _app.acquireTokenPopup({ scopes: SCOPES });
    _account = r.account;
    _app.setActiveAccount(_account);
    return r.accessToken;
  }

  return {
    async init(clientId, tenantId = 'common', redirectUri = window.location.origin) {
      if (_app) return; if (!clientId) return;
      const config = {
        auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}`, redirectUri },
        cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: false },
      };
      _app = new PublicClientApplication(config);
      await _app.initialize();
      const accounts = _app.getAllAccounts();
      if (accounts.length > 0) { _account = accounts[0]; _app.setActiveAccount(_account); }
    },
    reset() { _app = null; _account = null; },
    async signIn() {
      if (!_app) throw new Error('OutlookService not initialised');
      const r = await _app.acquireTokenPopup({ scopes: SCOPES });
      _account = r.account; _app.setActiveAccount(_account); return _account;
    },
    async signOut() {
      if (!_app || !_account) return;
      try { await _app.logoutPopup({ account: _account }); } catch (_) {}
      _account = null;
    },
    isConnected() { return _account != null; },
    getDisplayName() { return _account?.name || _account?.username || null; },
    async fetchWeekEvents(startISO, endISO) {
      const path = ['/me/calendarView',
        `?startDateTime=${encodeURIComponent(startISO)}`,`&endDateTime=${encodeURIComponent(endISO)}`,
        '&$select=id,subject,start,end,location,body','&$top=100','&$orderby=start/dateTime'].join('');
      const data = await graphJSON(getToken, path, { headers: { Prefer: 'outlook.timezone="UTC"' } });
      const toISO = s => (s && !s.endsWith('Z') ? s + 'Z' : s);
      return (data.value || []).map(ev => ({
        id: `outlook-${ev.id}`, title: ev.subject || '(No title)',
        start: toISO(ev.start?.dateTime), end: toISO(ev.end?.dateTime),
        type:'meeting', personId:null, personName:null, plannerSection:null,
        description: ev.location?.displayName || '', source:'outlook',
      }));
    },
    async createEvent({ title, start, end, description = '' }) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const body = { subject: title,
        start: { dateTime: start.replace('Z',''), timeZone: tz },
        end:   { dateTime: end.replace('Z',''),   timeZone: tz },
        body:  { contentType:'text', content: description } };
      const res = await graphFetch(getToken, '/me/events', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      return res.json();
    },
  };
})();

// ── Inject calendar styles ────────────────────────────────────────
if (!document.getElementById('nexusmd-ui-cal-styles')) {
  const s = document.createElement('style');
  s.id = 'nexusmd-ui-cal-styles';
  s.textContent = `
    @keyframes cal-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.55;transform:scale(.8)} }
    .cal-now-dot { animation: cal-pulse 2s ease-in-out infinite; }
    .cal-event { transition: box-shadow .13s ease, transform .1s ease; cursor: pointer; }
    .cal-event:hover { box-shadow: 0 4px 14px rgba(0,0,0,.14)!important; transform: translateY(-1px); z-index:10!important; }
    .cal-nav-btn { display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;border:none;background:transparent;cursor:pointer;color:var(--text-muted);transition:background .12s,color .12s; }
    .cal-nav-btn:hover { background:var(--surface-3);color:var(--text); }
    .cal-scroll  { scroll-behavior:smooth; }
    .cal-month-cell:hover { background: color-mix(in srgb,var(--accent) 4%,var(--surface))!important; }
    .cal-chip { cursor:pointer; transition: filter .1s; white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
    .cal-chip:hover { filter: brightness(.9); }
    .cal-view-btn { padding:0 13px;height:30px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:600;transition:background .15s,color .15s; background:transparent;color:var(--text-muted); }
    .cal-view-btn:hover { background:var(--surface-3);color:var(--text); }
    .cal-view-btn.active { background:var(--accent);color:var(--accent-fg); }
    .cal-agenda-row { transition:background .1s; }
    .cal-agenda-row:hover { background:var(--surface-2)!important; }
    .cal-event-dragging { opacity:.25!important; transform:none!important; box-shadow:none!important; }
    .cal-drag-preview { pointer-events:none; border-radius:6px; position:absolute; z-index:20; }
    .cal-drag-label { position:absolute; z-index:21; pointer-events:none; font-size:10px; font-weight:700; font-family:var(--mono); white-space:nowrap; background:var(--surface); border:1px solid var(--border); border-radius:4px; padding:1px 5px; box-shadow:0 1px 4px rgba(0,0,0,.12); }
    .cal-grip { position:absolute; left:0; right:0; height:8px; z-index:6; display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity .1s; }
    .cal-event:hover .cal-grip { opacity:1; }
    .cal-grip-top { top:0; cursor:n-resize; }
    .cal-grip-bottom { bottom:0; cursor:s-resize; }
    .cal-col-dragging { user-select:none; cursor:grabbing!important; }
    .cal-col-dragging .cal-event { cursor:inherit!important; }
  `;
  document.head.appendChild(s);
}

// ────────────────────────────────────────────────────────────────
const { useState: useStateCal, useMemo: useMemoCal, useEffect: useEffectCal, useRef: useRefCal } = React;

const CAL_START_HOUR  = 7;
const CAL_END_HOUR    = 20;
const CAL_PX_PER_HOUR = 62;
const CAL_TIME_W      = 56;

const EVENT_CFG = {
  oneOnOne: { border:'var(--accent)',  bg:'color-mix(in srgb,var(--accent) 14%,var(--surface))',  text:'var(--accent)'  },
  meeting:  { border:'var(--violet)',  bg:'color-mix(in srgb,var(--violet) 12%,var(--surface))',  text:'var(--violet)'  },
  note:     { border:'var(--warning)', bg:'color-mix(in srgb,var(--warning) 13%,var(--surface))', text:'var(--warning)' },
  reminder: { border:'var(--success)', bg:'color-mix(in srgb,var(--success) 12%,var(--surface))', text:'var(--success)' },
};

// ── Date helpers ──────────────────────────────────────────────────
function getWeekDays(offset, workWeek) {
  const now = new Date(); const dow = now.getDay() || 7;
  const mon = new Date(now); mon.setDate(now.getDate() - dow + 1 + offset * 7); mon.setHours(0,0,0,0);
  const count = workWeek ? 5 : 7;
  return Array.from({ length: count }, (_,i) => { const d = new Date(mon); d.setDate(mon.getDate()+i); return d; });
}

function getMonthGrid(offset) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() + offset;
  const first = new Date(y, m, 1);
  const startDow = first.getDay() || 7;
  const start = new Date(first); start.setDate(first.getDate() - (startDow - 1));
  return { year: first.getFullYear(), month: first.getMonth(),
    days: Array.from({ length:42 }, (_,i) => { const d = new Date(start); d.setDate(start.getDate()+i); return d; }) };
}

function getMiniMonth(year, month) {
  const first = new Date(year, month, 1);
  const startDow = first.getDay() || 7;
  const start = new Date(first); start.setDate(first.getDate() - (startDow - 1));
  return Array.from({ length:42 }, (_,i) => { const d = new Date(start); d.setDate(start.getDate()+i); return d; });
}

function getYearMonths(offset) {
  const y = new Date().getFullYear() + offset;
  return Array.from({ length:12 }, (_,i) => ({ year:y, month:i }));
}

function getAgendaDays(offset) {
  const start = new Date(); start.setHours(0,0,0,0);
  start.setDate(start.getDate() + offset * 14);
  return Array.from({ length:42 }, (_,i) => { const d = new Date(start); d.setDate(start.getDate()+i); return d; });
}

function eventTopPx(start) {
  const d = new Date(start);
  return Math.max(0, (d.getHours() + d.getMinutes()/60 - CAL_START_HOUR) * CAL_PX_PER_HOUR);
}
function eventHeightPx(start, end) {
  return Math.max(24, (new Date(end) - new Date(start)) / 3600000 * CAL_PX_PER_HOUR);
}
function nowTopPx() {
  const n = new Date(); const h = n.getHours() + n.getMinutes()/60;
  if (h < CAL_START_HOUR || h > CAL_END_HOUR) return null;
  return (h - CAL_START_HOUR) * CAL_PX_PER_HOUR;
}
function fmt12(iso) {
  if (!iso) return ''; const d = new Date(iso);
  let h = d.getHours(), m = d.getMinutes(), ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}${m ? ':'+String(m).padStart(2,'0') : ''}${ampm}`;
}
function fmtDuration(start, end) {
  const mins = Math.round((new Date(end)-new Date(start))/60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins/60), m = mins%60; return m ? `${h}h ${m}m` : `${h}h`;
}
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function todayStr() { return isoDate(new Date()); }
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_SHORT   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function snapTime(date, shiftKey) {
  const interval = shiftKey ? 30 : 15;
  const d = new Date(date);
  const totalMins = d.getHours() * 60 + d.getMinutes();
  const snapped = Math.round(totalMins / interval) * interval;
  const h = Math.floor(snapped / 60);
  const m = snapped % 60;
  const out = new Date(d);
  out.setHours(Math.min(h, 23), m, 0, 0);
  return out;
}

function formatLocalISO(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function layoutDayEvents(events) {
  if (!events.length) return [];
  const sorted = [...events].sort((a,b) => new Date(a.start)-new Date(b.start));
  const colEnds = [];
  const cols = sorted.map(ev => {
    const s = new Date(ev.start).getTime(), e = new Date(ev.end).getTime();
    let col = colEnds.findIndex(t => t <= s);
    if (col === -1) col = colEnds.length;
    colEnds[col] = e; return col;
  });
  return sorted.map((ev,i) => {
    const s = new Date(ev.start).getTime(), e = new Date(ev.end).getTime();
    const overlapping = sorted.filter((_,j) => {
      const os = new Date(sorted[j].start).getTime(), oe = new Date(sorted[j].end).getTime();
      return os < e && oe > s;
    });
    const maxCol = Math.max(...overlapping.map((_,j) => cols[sorted.indexOf(overlapping[j])]));
    return { ev, col:cols[i], totalCols:maxCol+1 };
  });
}

// ── EventDetailModal ──────────────────────────────────────────────
function EventDetailModal({ event, onClose, onOpenPlanner, onUpdate, onDelete }) {
  const isLocal = event && event.source !== 'outlook' && event.source !== 'google';
  const pad = n => String(n).padStart(2, '0');
  const initDate = event?.start ? event.start.slice(0, 10) : todayStr();
  const initTime = event?.start ? event.start.slice(11, 16) : '09:00';
  const initDur  = (event?.start && event?.end)
    ? Math.max(15, Math.round((new Date(event.end) - new Date(event.start)) / 60000)) : 30;

  const [editing, setEditing] = useStateCal(false);
  const [title, setTitle] = useStateCal(event?.title || '');
  const [date,  setDate]  = useStateCal(initDate);
  const [time,  setTime]  = useStateCal(initTime);
  const [dur,   setDur]   = useStateCal(initDur);
  const [desc,  setDesc]  = useStateCal(event?.description || '');
  const [confirmDel, setConfirmDel] = useStateCal(false);

  // Reset the form whenever a different event is opened.
  useEffectCal(() => {
    setEditing(false); setConfirmDel(false);
    setTitle(event?.title || ''); setDate(initDate); setTime(initTime);
    setDur(initDur); setDesc(event?.description || '');
  }, [event?.id]);

  if (!event) return null;
  const cfg = EVENT_CFG[event.type] || EVENT_CFG.meeting;
  const dur0 = event.start && event.end ? fmtDuration(event.start, event.end) : null;

  const save = () => {
    const start = `${date}T${time}`;
    const endD = new Date(`${date}T${time}`);
    endD.setMinutes(endD.getMinutes() + Number(dur || 30));
    const end = `${endD.getFullYear()}-${pad(endD.getMonth()+1)}-${pad(endD.getDate())}T${pad(endD.getHours())}:${pad(endD.getMinutes())}`;
    onUpdate?.(event.id, { title: (title.trim() || event.title), start, end, description: desc });
    setEditing(false); onClose();
  };

  const inputStyle = { width:'100%',boxSizing:'border-box',border:'1px solid var(--border)',borderRadius:8,padding:'7px 10px',background:'var(--surface-2)',color:'var(--text)',fontSize:13,fontFamily:'var(--sans)',outline:'none' };
  const labelStyle = { fontSize:10.5,fontWeight:700,color:'var(--text-subtle)',marginBottom:4,display:'block',textTransform:'uppercase',letterSpacing:'.05em' };

  return (
    <div id="modal-event-detail" style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.35)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(2px)' }}
      onClick={e => { if (e.target===e.currentTarget) onClose(); }}>
      <div style={{ background:'var(--surface)',border:'1px solid var(--border)',borderRadius:20,boxShadow:'0 24px 64px rgba(0,0,0,.18),0 4px 16px rgba(0,0,0,.08)',width:440,maxWidth:'92vw',overflow:'hidden' }}>
        <div style={{ height:5,background:cfg.border }}/>
        <div style={{ padding:'22px 24px 20px' }}>
          {!editing ? (
            <React.Fragment>
              <div style={{ display:'flex',alignItems:'flex-start',gap:12,marginBottom:16 }}>
                <div style={{ flex:1,minWidth:0 }}>
                  <div style={{ fontSize:17,fontWeight:650,color:'var(--text)',lineHeight:1.3,marginBottom:5 }}>{event.title}</div>
                  <div style={{ display:'flex',alignItems:'center',gap:8,flexWrap:'wrap' }}>
                    <span style={{ fontSize:13,color:'var(--text-muted)' }}>{new Date(event.start).toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'})}</span>
                    {event.start && <span style={{ fontSize:12,color:'var(--text-subtle)',fontFamily:'var(--mono)' }}>{fmt12(event.start)}{event.end?` – ${fmt12(event.end)}`:''}{dur0?` · ${dur0}`:''}</span>}
                  </div>
                </div>
                <button onClick={onClose} style={{ flexShrink:0,width:28,height:28,borderRadius:8,border:'1px solid var(--border)',background:'var(--surface-2)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-muted)' }}>
                  <Icon name="x" size={13}/>
                </button>
              </div>
              <div style={{ display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:(event.personName||event.description)?14:0 }}>
                <span style={{ display:'inline-flex',alignItems:'center',gap:4,padding:'2px 9px',borderRadius:20,fontSize:11,fontWeight:600,background:cfg.bg,color:cfg.text,border:`1px solid ${cfg.border}` }}>
                  {event.type==='oneOnOne'?'1:1':event.type==='meeting'?'Meeting':event.type}
                </span>
                {event.source==='outlook' && (
                  <span style={{ display:'inline-flex',alignItems:'center',gap:4,padding:'2px 9px',borderRadius:20,fontSize:11,fontWeight:600,background:'color-mix(in srgb,var(--accent) 8%,var(--surface))',color:'var(--accent)',border:'1px solid var(--accent-border)' }}>
                    <Icon name="link" size={9}/> Outlook
                  </span>
                )}
                {event.source==='google' && (
                  <span style={{ display:'inline-flex',alignItems:'center',gap:4,padding:'2px 9px',borderRadius:20,fontSize:11,fontWeight:600,background:'color-mix(in srgb,var(--success) 12%,var(--surface))',color:'var(--success)',border:'1px solid color-mix(in srgb,var(--success) 40%,transparent)' }}>
                    <Icon name="link" size={9}/> Google
                  </span>
                )}
              </div>
              {event.personName && (
                <div style={{ display:'flex',alignItems:'center',gap:10,padding:'10px 12px',background:'var(--surface-2)',borderRadius:10,marginBottom:10 }}>
                  <Avatar who={event.personId} size="xs"/>
                  <span style={{ fontSize:13,color:'var(--text)' }}>{event.personName}</span>
                </div>
              )}
              {event.description && (
                <div style={{ fontSize:13,color:'var(--text-muted)',padding:'10px 12px',background:'var(--surface-2)',borderRadius:10,whiteSpace:'pre-wrap',lineHeight:1.6 }}>{event.description}</div>
              )}
              {event.source==='outlook' && (
                <div style={{ fontSize:11.5,color:'var(--text-subtle)',marginTop:12 }}>Outlook events are managed in Outlook and can&rsquo;t be edited here.</div>
              )}
              <div style={{ display:'flex',gap:8,alignItems:'center',marginTop:20,paddingTop:16,borderTop:'1px solid var(--border)' }}>
                {(isLocal || event.source==='google') && (
                  confirmDel ? (
                    <React.Fragment>
                      <span style={{ fontSize:12.5,color:'var(--danger)',marginRight:'auto' }}>Delete this event?</span>
                      <button className="btn sm ghost" onClick={()=>setConfirmDel(false)}>Cancel</button>
                      <button className="btn sm" style={{ background:'var(--danger)',color:'#fff',borderColor:'var(--danger)' }} onClick={()=>{ onDelete?.(event.id); onClose(); }}>Delete</button>
                    </React.Fragment>
                  ) : (
                    <React.Fragment>
                      <button className="btn sm ghost" onClick={()=>setConfirmDel(true)} style={{ color:'var(--danger)',marginRight:'auto',gap:6 }}><Icon name="trash" size={12}/> Delete</button>
                      {event.plannerSection && onOpenPlanner && (
                        <button className="btn sm ghost" onClick={() => { onOpenPlanner(event); onClose(); }} style={{ gap:6 }}>
                          <Icon name="planner" size={12}/> Open in Planner
                        </button>
                      )}
                      {isLocal && <button className="btn sm primary" onClick={()=>setEditing(true)} style={{ gap:6 }}><Icon name="edit" size={12}/> Edit</button>}
                    </React.Fragment>
                  )
                )}
                {!isLocal && event.source !== 'google' && (
                  <React.Fragment>
                    {event.plannerSection && onOpenPlanner && (
                      <button className="btn sm ghost" onClick={() => { onOpenPlanner(event); onClose(); }} style={{ gap:6 }}>
                        <Icon name="planner" size={12}/> Open in Planner
                      </button>
                    )}
                    <button className="btn sm ghost" onClick={onClose}>Dismiss</button>
                  </React.Fragment>
                )}
              </div>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <div style={{ display:'flex',alignItems:'center',gap:12,marginBottom:16 }}>
                <div style={{ fontSize:16,fontWeight:650,color:'var(--text)',flex:1 }}>Edit entry</div>
                <button onClick={()=>setEditing(false)} style={{ flexShrink:0,width:28,height:28,borderRadius:8,border:'1px solid var(--border)',background:'var(--surface-2)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-muted)' }}>
                  <Icon name="x" size={13}/>
                </button>
              </div>
              <div style={{ display:'flex',flexDirection:'column',gap:12 }}>
                <div>
                  <label style={labelStyle}>Title</label>
                  <input style={inputStyle} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Event title"/>
                </div>
                <div style={{ display:'flex',gap:10 }}>
                  <div style={{ flex:1.4 }}>
                    <label style={labelStyle}>Date</label>
                    <input type="date" style={inputStyle} value={date} onChange={e=>setDate(e.target.value)}/>
                  </div>
                  <div style={{ flex:1 }}>
                    <label style={labelStyle}>Start</label>
                    <input type="time" style={inputStyle} value={time} onChange={e=>setTime(e.target.value)}/>
                  </div>
                  <div style={{ flex:1 }}>
                    <label style={labelStyle}>Mins</label>
                    <input type="number" min={15} step={15} style={inputStyle} value={dur} onChange={e=>setDur(e.target.value)}/>
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Notes</label>
                  <textarea rows={3} style={{ ...inputStyle, resize:'vertical' }} value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Description / talking points"/>
                </div>
                {event.plannerSection === 'oneOnOnes' && (
                  <div style={{ fontSize:11.5,color:'var(--text-subtle)' }}>Changes sync to the matching 1:1 row in your planner.</div>
                )}
              </div>
              <div style={{ display:'flex',gap:8,justifyContent:'flex-end',marginTop:20,paddingTop:16,borderTop:'1px solid var(--border)' }}>
                <button className="btn sm ghost" onClick={()=>setEditing(false)}>Cancel</button>
                <button className="btn sm primary" onClick={save}>Save changes</button>
              </div>
            </React.Fragment>
          )}
        </div>
      </div>
    </div>
  );
}

// ── MicrosoftLogo — SVG inline ────────────────────────────────────
function MicrosoftLogo({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 21 21" style={{ flexShrink:0 }}>
      <rect x="1"  y="1"  width="9" height="9" fill="#f25022"/>
      <rect x="11" y="1"  width="9" height="9" fill="#7fba00"/>
      <rect x="1"  y="11" width="9" height="9" fill="#00a4ef"/>
      <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
    </svg>
  );
}

// ── OutlookSetupModal ─────────────────────────────────────────────
function OutlookSetupModal({ open, config, onSaveConfig, onClose, onConnect }) {
  const [clientId, setClientId] = useStateCal(config?.clientId || '');
  const [showSteps, setShowSteps] = useStateCal(false);
  const [saving, setSaving] = useStateCal(false);

  useEffectCal(() => {
    if (open) setClientId(config?.clientId || '');
  }, [open]);

  if (!open) return null;

  const handleSaveAndSign = async () => {
    if (!clientId.trim()) return;
    setSaving(true);
    onSaveConfig({ clientId: clientId.trim(), tenantId: 'common' });
    // Small delay to let MSAL init before triggering sign-in
    setTimeout(async () => {
      setSaving(false);
      onClose();
      onConnect();
    }, 400);
  };

  const redirectUri = window.location.origin + window.location.pathname;

  return (
    <div id="modal-outlook-setup" style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(3px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background:'var(--surface)',border:'1px solid var(--border)',borderRadius:20,boxShadow:'0 24px 64px rgba(0,0,0,.2)',width:480,maxWidth:'94vw',overflow:'hidden' }}>

        {/* Header */}
        <div style={{ padding:'24px 24px 0',display:'flex',alignItems:'flex-start',gap:14 }}>
          <div style={{ width:44,height:44,borderRadius:10,background:'#f3f3f3',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
            <MicrosoftLogo size={22}/>
          </div>
          <div style={{ flex:1,minWidth:0 }}>
            <div style={{ fontSize:17,fontWeight:650,color:'var(--text)',marginBottom:3 }}>Connect to Outlook</div>
            <div style={{ fontSize:13,color:'var(--text-muted)',lineHeight:1.5 }}>
              Sync your Outlook calendar so meetings appear alongside your 1:1s.
            </div>
          </div>
          <button onClick={onClose} style={{ flexShrink:0,width:28,height:28,borderRadius:8,border:'1px solid var(--border)',background:'var(--surface-2)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-muted)' }}>
            <Icon name="x" size={13}/>
          </button>
        </div>

        <div style={{ padding:'20px 24px 24px',display:'flex',flexDirection:'column',gap:16 }}>

          {/* Client ID field */}
          <div>
            <label style={{ fontSize:12.5,fontWeight:600,color:'var(--text-muted)',display:'block',marginBottom:6 }}>
              Azure App Client ID
            </label>
            <input
              type="text"
              value={clientId}
              autoFocus
              onChange={e => setClientId(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && clientId.trim()) handleSaveAndSign(); if (e.key === 'Escape') onClose(); }}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              style={{ width:'100%',boxSizing:'border-box',height:38,padding:'0 12px',border:'1px solid var(--border)',borderRadius:10,background:'var(--surface-2)',fontSize:13,fontFamily:'var(--mono)',outline:'none',color:'var(--text)' }}
            />
          </div>

          {/* Collapsible how-to */}
          <div style={{ background:'var(--surface-2)',borderRadius:10,overflow:'hidden',border:'1px solid var(--border)' }}>
            <button
              onClick={() => setShowSteps(v => !v)}
              style={{ width:'100%',padding:'10px 14px',background:'transparent',border:'none',cursor:'pointer',display:'flex',alignItems:'center',gap:8,fontSize:13,fontWeight:600,color:'var(--text-muted)',textAlign:'left' }}>
              <Icon name={showSteps ? 'chevron-down' : 'chevron-right'} size={12}/>
              How do I get a Client ID?
            </button>
            {showSteps && (
              <div style={{ padding:'0 14px 14px',display:'flex',flexDirection:'column',gap:8 }}>
                <div style={{ fontSize:12.5,color:'var(--text-muted)',lineHeight:1.7 }}>
                  You need a free Azure app registration — it takes about 5 minutes and only needs to be done once.
                </div>
                {[
                  { n:1, text: <>Go to <a href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade" target="_blank" rel="noopener" style={{ color:'var(--accent)' }}>portal.azure.com → App registrations → New registration</a></> },
                  { n:2, text: 'Give it any name, e.g. "Calendar Sync"' },
                  { n:3, text: 'Supported account types → "Accounts in any organizational directory and personal Microsoft accounts"' },
                  { n:4, text: <>Redirect URI → <strong>Single-page application (SPA)</strong> → enter: <code style={{ background:'var(--surface-3)',padding:'1px 5px',borderRadius:4,fontSize:11,fontFamily:'var(--mono)' }}>{redirectUri}</code></> },
                  { n:5, text: 'Click Register, then copy the Application (client) ID from the overview page and paste it above' },
                ].map(({ n, text }) => (
                  <div key={n} style={{ display:'flex',gap:10,alignItems:'flex-start' }}>
                    <span style={{ flexShrink:0,width:20,height:20,borderRadius:'50%',background:'var(--accent)',color:'var(--accent-fg)',fontSize:11,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center' }}>{n}</span>
                    <span style={{ fontSize:12.5,color:'var(--text-muted)',lineHeight:1.6,paddingTop:1 }}>{text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ display:'flex',gap:10,flexDirection:'column' }}>
            <button
              disabled={!clientId.trim() || saving}
              onClick={handleSaveAndSign}
              style={{ display:'flex',alignItems:'center',justifyContent:'center',gap:10,height:42,borderRadius:10,border:'1px solid #8c8c8c',background:'#fff',cursor:clientId.trim()?'pointer':'not-allowed',opacity:clientId.trim()?1:0.5,fontSize:14,fontWeight:600,color:'#5f6368',transition:'box-shadow .15s',boxShadow:'0 1px 3px rgba(0,0,0,.12)' }}
              onMouseEnter={e => { if (clientId.trim()) e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,.18)'; }}
              onMouseLeave={e => e.currentTarget.style.boxShadow='0 1px 3px rgba(0,0,0,.12)'}>
              <MicrosoftLogo size={18}/>
              {saving ? 'Connecting…' : 'Sign in with Microsoft'}
            </button>
            <button className="btn ghost" onClick={onClose} style={{ fontSize:13 }}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── OutlookBanner ─────────────────────────────────────────────────
// allowSetup / allowSignIn default to the web behaviour (full MSAL setup +
// interactive sign-in). The app passes both false — a Capacitor webview can't do
// MSAL popups, so it only surfaces the settings gear and relies on a cached
// account from OutlookService.init.
function OutlookBanner({ config, onSaveConfig, connected, displayName, syncing, error, onConnect, onDisconnect, allowSetup = true, allowSignIn = true }) {
  const [modalOpen, setModalOpen] = useStateCal(false);

  // If no client ID: show setup modal trigger
  if (!config?.clientId) {
    if (!allowSetup) return null;
    return (
      <>
        <OutlookSetupModal
          open={modalOpen}
          config={config}
          onSaveConfig={onSaveConfig}
          onClose={() => setModalOpen(false)}
          onConnect={onConnect}
        />
        <button
          className="btn sm ghost"
          onClick={() => setModalOpen(true)}
          style={{ display:'flex',alignItems:'center',gap:7,padding:'0 10px',height:30,borderRadius:8,border:'1px solid var(--border-strong)',fontSize:12.5,fontWeight:600 }}>
          <MicrosoftLogo size={13}/>
          Sign in with Microsoft
        </button>
      </>
    );
  }

  // Client ID saved but not yet signed in
  if (!connected) return (
    <div style={{ display:'flex',alignItems:'center',gap:6 }}>
      <OutlookSetupModal
        open={modalOpen}
        config={config}
        onSaveConfig={onSaveConfig}
        onClose={() => setModalOpen(false)}
        onConnect={onConnect}
      />
      <button className="btn sm ghost" style={{ padding:'0 7px' }} title="Outlook settings" onClick={() => setModalOpen(true)}>
        <Icon name="settings" size={13}/>
      </button>
      {allowSignIn && (
        <button
          onClick={onConnect}
          style={{ display:'flex',alignItems:'center',gap:7,padding:'0 10px',height:30,borderRadius:8,border:'1px solid var(--border-strong)',background:'#fff',cursor:'pointer',fontSize:12.5,fontWeight:600,color:'#5f6368',boxShadow:'0 1px 3px rgba(0,0,0,.1)' }}>
          <MicrosoftLogo size={13}/>
          Sign in with Microsoft
        </button>
      )}
    </div>
  );

  // Connected
  return (
    <div style={{ display:'flex',alignItems:'center',gap:8 }}>
      {syncing && <span style={{ fontSize:11,color:'var(--text-muted)',display:'flex',alignItems:'center',gap:4 }}><span style={{ width:6,height:6,borderRadius:'50%',background:'var(--warning)',display:'inline-block' }}/> Syncing</span>}
      {error   && <span style={{ fontSize:11,color:'var(--danger)' }} title={error}>Sync error</span>}
      {!syncing && !error && (
        <span style={{ display:'flex',alignItems:'center',gap:6,fontSize:12,color:'var(--text-muted)' }}>
          <MicrosoftLogo size={12}/>
          {displayName || 'Outlook connected'}
        </span>
      )}
      <button className="btn sm ghost" style={{ padding:'0 7px' }} title="Change account / settings" onClick={() => {
        onDisconnect();
        onSaveConfig({ clientId: config?.clientId || '', tenantId: config?.tenantId || 'common' });
      }}><Icon name="settings" size={13}/></button>
      <button className="btn sm ghost" onClick={onDisconnect} style={{ fontSize:12 }}>Sign out</button>
    </div>
  );
}

// ── DayColumn (week / work-week view) ─────────────────────────
function DayColumn({ date, events, isToday, onEventClick, nowPx, onMoveEvent, onUpdateEvent, onNewGoogleEvent }) {
  const totalPx = (CAL_END_HOUR - CAL_START_HOUR) * CAL_PX_PER_HOUR;
  const laid = useMemoCal(() => layoutDayEvents(events), [events]);
  const [dragOver, setDragOver] = useStateCal(false);

  // drag = { id, type: 'move'|'resize-top'|'resize-bottom', startY, origStart: Date, origEnd: Date }
  const [drag, setDrag] = useStateCal(null);
  // preview = { start: Date, end: Date } — updated on every mousemove
  const [preview, setPreview] = useStateCal(null);

  const computePreview = (type, origStart, origEnd, deltaY, shiftKey) => {
    const deltaMs = (deltaY / CAL_PX_PER_HOUR) * 3600000;
    const dur = origEnd.getTime() - origStart.getTime();
    const dayStart = new Date(origStart); dayStart.setHours(CAL_START_HOUR, 0, 0, 0);
    const dayEnd   = new Date(origStart); dayEnd.setHours(CAL_END_HOUR, 0, 0, 0);
    let ps, pe;
    if (type === 'move') {
      ps = snapTime(new Date(origStart.getTime() + deltaMs), shiftKey);
      pe = new Date(ps.getTime() + dur);
      if (ps < dayStart) { ps = new Date(dayStart); pe = new Date(ps.getTime() + dur); }
      if (pe > dayEnd)   { pe = new Date(dayEnd);   ps = new Date(pe.getTime() - dur); }
    } else if (type === 'resize-top') {
      ps = snapTime(new Date(origStart.getTime() + deltaMs), shiftKey);
      pe = new Date(origEnd);
      if (ps < dayStart) ps = new Date(dayStart);
      if (pe - ps < 15 * 60000) ps = new Date(pe.getTime() - 15 * 60000);
    } else {
      ps = new Date(origStart);
      pe = snapTime(new Date(origEnd.getTime() + deltaMs), shiftKey);
      if (pe > dayEnd) pe = new Date(dayEnd);
      if (pe - ps < 15 * 60000) pe = new Date(ps.getTime() + 15 * 60000);
    }
    return { ps, pe };
  };

  const startDrag = (e, type, ev) => {
    if (e.button !== 0) return;
    const origStart = new Date(ev.start), origEnd = new Date(ev.end);
    setDrag({ id: ev.id, type, startY: e.clientY, origStart, origEnd });
    setPreview({ start: origStart, end: origEnd });
  };

  useEffectCal(() => {
    if (!drag) return;
    const { id, type, startY, origStart, origEnd } = drag;

    const onMove = (e) => {
      const { ps, pe } = computePreview(type, origStart, origEnd, e.clientY - startY, e.shiftKey);
      setPreview({ start: ps, end: pe });
    };
    const onUp = (e) => {
      const deltaY = e.clientY - startY;
      if (Math.abs(deltaY) > 3) {
        const { ps, pe } = computePreview(type, origStart, origEnd, deltaY, e.shiftKey);
        onUpdateEvent?.(id, { start: formatLocalISO(ps), end: formatLocalISO(pe) });
        // Suppress the click that fires after mouseup so the modal doesn't open
        const cancelClick = (ev) => { ev.stopPropagation(); document.removeEventListener('click', cancelClick, true); };
        document.addEventListener('click', cancelClick, true);
      }
      setDrag(null);
      setPreview(null);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [drag]);

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const id = e.dataTransfer.getData('text/plain');
    if (id) onMoveEvent?.(id, isoDate(date));
  };

  const dragId = drag ? String(drag.id) : null;
  const dragLayout = dragId ? laid.find(l => String(l.ev.id) === dragId) : null;

  const handleBgClick = (e) => {
    if (!onNewGoogleEvent || drag) return;
    if (e.target.closest?.('.cal-event')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const totalHours = CAL_START_HOUR + y / CAL_PX_PER_HOUR;
    const h = Math.max(CAL_START_HOUR, Math.min(CAL_END_HOUR - 1, Math.floor(totalHours)));
    const rawMin = Math.round(((totalHours - Math.floor(totalHours)) * 60) / 15) * 15;
    const m = rawMin >= 60 ? 0 : rawMin;
    const pad = n => String(n).padStart(2, '0');
    onNewGoogleEvent(isoDate(date), `${pad(h)}:${pad(m)}`);
  };

  return (
    <div className={`cal-day-col${drag ? ' cal-col-dragging' : ''}`}
      onClick={handleBgClick}
      onDragOver={onMoveEvent ? (e)=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; if(!dragOver) setDragOver(true); } : undefined}
      onDragLeave={onMoveEvent ? ()=>setDragOver(false) : undefined}
      onDrop={onMoveEvent ? handleDrop : undefined}
      style={{ flex:1,minWidth:0,position:'relative',height:totalPx,borderLeft:'1px solid var(--border)',
        background:dragOver?'color-mix(in srgb,var(--accent) 10%,transparent)':isToday?'color-mix(in srgb,var(--accent) 3%,transparent)':'transparent',
        transition:'background .12s', cursor: onNewGoogleEvent && !drag ? 'cell' : undefined }}>
      {Array.from({ length:(CAL_END_HOUR-CAL_START_HOUR)*2 }, (_,i) => (
        <div key={i} style={{ position:'absolute',top:i*(CAL_PX_PER_HOUR/2),left:0,right:0,
          borderTop:i===0?'none':i%2===0?'1px solid var(--border)':'1px dashed color-mix(in srgb,var(--border) 55%,transparent)',pointerEvents:'none' }}/>
      ))}
      {isToday && nowPx!==null && (
        <div style={{ position:'absolute',top:nowPx,left:0,right:0,zIndex:4,pointerEvents:'none',display:'flex',alignItems:'center' }}>
          <div style={{ flex:1,height:2,background:'var(--danger)',opacity:.85 }}/>
        </div>
      )}
      {laid.map(({ ev, col, totalCols }) => {
        const cfg = EVENT_CFG[ev.type] || EVENT_CFG.meeting;
        const top = eventTopPx(ev.start), height = eventHeightPx(ev.start, ev.end);
        const g = 3, colW = 100 / totalCols;
        const isShort = height < 38;
        const canTimeDrag = !!onUpdateEvent && ev.source !== 'outlook' && ev.source !== 'google';
        const isGhost = String(ev.id) === dragId;
        const showGrips = canTimeDrag && height >= 28;

        return (
          <div key={ev.id}
            className={`cal-event${isGhost ? ' cal-event-dragging' : ''}`}
            onClick={() => onEventClick(ev)}
            title={ev.title}
            onMouseDown={canTimeDrag ? (e) => { e.stopPropagation(); startDrag(e, 'move', ev); } : undefined}
            style={{ position:'absolute',left:`calc(${col*colW}% + ${g}px)`,width:`calc(${colW}% - ${g*2}px)`,
              top, height:height-2,
              background:cfg.bg,
              borderLeft: isGhost ? `1px dashed ${cfg.border}` : `3px solid ${cfg.border}`,
              borderRadius:6,
              padding:isShort?'2px 6px':'5px 7px',
              overflow:'hidden',zIndex:2,
              cursor: canTimeDrag ? 'grab' : 'pointer',
              boxShadow:'0 1px 3px rgba(0,0,0,.06)',
            }}>
            {showGrips && (
              <div className="cal-grip cal-grip-top"
                onMouseDown={(e) => { e.stopPropagation(); startDrag(e, 'resize-top', ev); }}>
                <div style={{ width:18,height:2,borderRadius:1,background:cfg.border,opacity:.6 }}/>
              </div>
            )}
            <div style={{ fontSize:isShort?10.5:11.5,fontWeight:600,color:cfg.text,overflow:'hidden',
              textOverflow:'ellipsis',
              whiteSpace:isShort?'nowrap':'normal',lineHeight:1.35,
              display:isShort?'block':'-webkit-box',
              WebkitLineClamp:isShort?undefined:2,WebkitBoxOrient:isShort?undefined:'vertical',
              paddingTop: showGrips ? 4 : 0,
            }}>
              {ev.title}
            </div>
            {height > 42 && (
              <div style={{ fontSize:10,color:cfg.text,opacity:.72,marginTop:2,fontFamily:'var(--mono)' }}>
                {fmt12(ev.start)}{ev.end ? ` · ${fmtDuration(ev.start,ev.end)}` : ''}
              </div>
            )}
            {(ev.source==='outlook'||ev.source==='google') && height>38 && (
              <div style={{ position:'absolute',bottom:4,right:5,opacity:.4 }}><Icon name="link" size={8}/></div>
            )}
            {showGrips && (
              <div className="cal-grip cal-grip-bottom"
                onMouseDown={(e) => { e.stopPropagation(); startDrag(e, 'resize-bottom', ev); }}>
                <div style={{ width:18,height:2,borderRadius:1,background:cfg.border,opacity:.6 }}/>
              </div>
            )}
          </div>
        );
      })}

      {/* Drag preview block */}
      {drag && preview && dragLayout && (() => {
        const { col, totalCols, ev: dragEv } = dragLayout;
        const cfg = EVENT_CFG[dragEv.type] || EVENT_CFG.meeting;
        const g = 3, colW = 100 / totalCols;
        const pTop    = eventTopPx(preview.start);
        const pHeight = eventHeightPx(preview.start, preview.end);
        const labelTop = Math.max(0, pTop - 16);
        const timeLabel = `${fmt12(preview.start)} – ${fmt12(preview.end)}`;
        return (
          <React.Fragment>
            <div className="cal-drag-label"
              style={{ top:labelTop, left:`calc(${col*colW}% + ${g}px)`, color:cfg.text }}>
              {timeLabel}
            </div>
            <div className="cal-drag-preview"
              style={{ top:pTop, height:pHeight-2,
                left:`calc(${col*colW}% + ${g}px)`, width:`calc(${colW}% - ${g*2}px)`,
                background:cfg.bg, border:`1.5px solid ${cfg.border}`,
                padding:'5px 7px',
                boxShadow:`0 2px 10px color-mix(in srgb,${cfg.border} 30%,transparent)`,
              }}>
              <div style={{ fontSize:10.5,fontWeight:600,color:cfg.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                {dragEv.title}
              </div>
            </div>
          </React.Fragment>
        );
      })()}
    </div>
  );
}

// ── WeekGrid (shared by Week + Work Week) ─────────────────────────
function WeekGrid({ days, eventsByDay, today, isCurrentPeriod, nowPx, onEventClick, scrollRef, onMoveEvent, onUpdateEvent, onNewGoogleEvent }) {
  const totalPx   = (CAL_END_HOUR - CAL_START_HOUR) * CAL_PX_PER_HOUR;
  const hourSlots = Array.from({ length: CAL_END_HOUR - CAL_START_HOUR }, (_,i) => CAL_START_HOUR+i);
  return (
    <div className="card" style={{ padding:0,overflow:'hidden',border:'1px solid var(--border)' }}>
      {/* Day headers */}
      <div style={{ display:'flex',borderBottom:'1px solid var(--border)',background:'var(--surface)',position:'sticky',top:0,zIndex:10,boxShadow:'0 1px 0 var(--border)' }}>
        <div style={{ width:CAL_TIME_W,flexShrink:0 }}/>
        {days.map(d => {
          const key = isoDate(d), isToday = key===today;
          return (
            <div key={key} style={{ flex:1,padding:'10px 4px 8px',textAlign:'center',borderLeft:'1px solid var(--border)',background:isToday?'color-mix(in srgb,var(--accent) 4%,var(--surface))':'transparent' }}>
              <div style={{ fontSize:10,fontWeight:700,letterSpacing:'.07em',color:isToday?'var(--accent)':'var(--text-subtle)',textTransform:'uppercase',marginBottom:4 }}>
                {d.toLocaleDateString([],{weekday:'short'})}
              </div>
              <div style={{ width:34,height:34,borderRadius:'50%',margin:'0 auto',display:'flex',alignItems:'center',justifyContent:'center',fontSize:17,fontWeight:700,
                background:isToday?'var(--accent)':'transparent',color:isToday?'var(--accent-fg)':'var(--text)',
                boxShadow:isToday?'0 2px 8px color-mix(in srgb,var(--accent) 40%,transparent)':'none' }}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>
      {/* Scroll area */}
      <div ref={scrollRef} className="cal-scroll" style={{ display:'flex',overflowY:'auto',maxHeight:'calc(100vh - 260px)' }}>
        {/* Time gutter */}
        <div style={{ width:CAL_TIME_W,flexShrink:0,position:'relative',height:totalPx,background:'var(--surface)' }}>
          {isCurrentPeriod && nowPx!==null && (
            <div className="cal-now-dot" style={{ position:'absolute',top:nowPx-4.5,right:8,zIndex:5,width:9,height:9,borderRadius:'50%',background:'var(--danger)',boxShadow:'0 0 0 3px color-mix(in srgb,var(--danger) 25%,transparent)' }}/>
          )}
          {hourSlots.map((h,i) => (
            <div key={h} style={{ position:'absolute',top:i*CAL_PX_PER_HOUR,right:10,left:0,display:'flex',alignItems:'flex-start',justifyContent:'flex-end',paddingTop:3 }}>
              <span style={{ fontSize:10,fontWeight:500,color:'var(--text-subtle)',fontFamily:'var(--mono)',userSelect:'none' }}>
                {h<12?`${h}`:h===12?'12':`${h-12}`}<span style={{ fontSize:8,marginLeft:1 }}>{h<12?'am':'pm'}</span>
              </span>
            </div>
          ))}
        </div>
        {days.map(d => {
          const key = isoDate(d);
          return <DayColumn key={key} date={d} events={eventsByDay[key]||[]} isToday={key===today} onEventClick={onEventClick} nowPx={isCurrentPeriod?nowPx:null} onMoveEvent={onMoveEvent} onUpdateEvent={onUpdateEvent} onNewGoogleEvent={onNewGoogleEvent}/>;
        })}
      </div>
    </div>
  );
}

// ── MonthView ──────────────────────────────────────────────────────
function MonthView({ eventsByDay, monthGrid, today, onEventClick, onMoveEvent }) {
  const { days, year, month } = monthGrid;
  const weeks = Array.from({ length:6 }, (_,i) => days.slice(i*7, i*7+7));
  const [dragKey, setDragKey] = useStateCal(null);

  return (
    <div className="card" style={{ padding:0,overflow:'hidden',border:'1px solid var(--border)' }}>
      {/* Weekday headers */}
      <div style={{ display:'grid',gridTemplateColumns:'repeat(7,1fr)',borderBottom:'1px solid var(--border)',background:'var(--surface-2)' }}>
        {DAY_SHORT.map(d => (
          <div key={d} style={{ padding:'10px 0',textAlign:'center',fontSize:10.5,fontWeight:700,color:'var(--text-subtle)',letterSpacing:'.06em',textTransform:'uppercase' }}>{d}</div>
        ))}
      </div>
      {/* Weeks */}
      {weeks.map((week,wi) => (
        <div key={wi} style={{ display:'grid',gridTemplateColumns:'repeat(7,1fr)',borderBottom:wi<5?'1px solid var(--border)':'none' }}>
          {week.map(d => {
            const key = isoDate(d);
            const isToday = key===today;
            const isCurrentMonth = d.getMonth()===month;
            const dayEvents = (eventsByDay[key]||[]).slice(0,3);
            const overflow  = (eventsByDay[key]||[]).length - 3;
            return (
              <div key={key} className="cal-month-cell"
                onDragOver={onMoveEvent ? (e)=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; if(dragKey!==key) setDragKey(key); } : undefined}
                onDragLeave={onMoveEvent ? ()=>setDragKey(k=>k===key?null:k) : undefined}
                onDrop={onMoveEvent ? (e)=>{ e.preventDefault(); setDragKey(null); const id=e.dataTransfer.getData('text/plain'); if(id) onMoveEvent(id, key); } : undefined}
                style={{ minHeight:100,padding:'6px 6px 4px',borderLeft:week.indexOf(d)>0?'1px solid var(--border)':'none',position:'relative',transition:'background .12s',background:dragKey===key?'color-mix(in srgb,var(--accent) 10%,var(--surface))':isToday?'color-mix(in srgb,var(--accent) 4%,var(--surface))':'var(--surface)' }}>
                {/* Date number */}
                <div style={{ marginBottom:4,display:'flex',justifyContent:'center' }}>
                  <span style={{ width:26,height:26,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',
                    fontSize:12.5,fontWeight:isToday?700:500,
                    background:isToday?'var(--accent)':'transparent',
                    color:isToday?'var(--accent-fg)':isCurrentMonth?'var(--text)':'var(--text-subtle)',
                  }}>{d.getDate()}</span>
                </div>
                {/* Event chips */}
                <div style={{ display:'flex',flexDirection:'column',gap:2 }}>
                  {dayEvents.map(ev => {
                    const cfg = EVENT_CFG[ev.type]||EVENT_CFG.meeting;
                    const canDrag = !!onMoveEvent && ev.source !== 'outlook' && ev.source !== 'google';
                    return (
                      <div key={ev.id} className="cal-chip" onClick={()=>onEventClick(ev)} title={canDrag?`${ev.title} — drag to another day to reschedule`:ev.title}
                        draggable={canDrag}
                        onDragStart={canDrag ? (e)=>{ e.stopPropagation(); e.dataTransfer.setData('text/plain', String(ev.id)); e.dataTransfer.effectAllowed='move'; } : undefined}
                        style={{ fontSize:10.5,fontWeight:600,padding:'2px 6px',borderRadius:4,color:cfg.text,background:cfg.bg,borderLeft:`2px solid ${cfg.border}`,cursor:canDrag?'grab':'pointer' }}>
                        {ev.title}
                      </div>
                    );
                  })}
                  {overflow > 0 && (
                    <div style={{ fontSize:10,color:'var(--text-subtle)',padding:'1px 6px',fontWeight:500 }}>+{overflow} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── YearView ───────────────────────────────────────────────────────
function YearView({ year, allEvents, today, onDayClick }) {
  const eventMap = useMemoCal(() => {
    const m = {};
    allEvents.forEach(ev => {
      if (!ev.start) return;
      const k = ev.start.length === 10 ? ev.start : isoDate(new Date(ev.start));
      if (!m[k]) m[k] = []; m[k].push(ev);
    });
    return m;
  }, [allEvents]);

  return (
    <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16 }}>
      {Array.from({ length:12 }, (_,mi) => {
        const miniDays = getMiniMonth(year, mi);
        const weeks = Array.from({ length:6 }, (_,i) => miniDays.slice(i*7,i*7+7));
        return (
          <div key={mi} className="card" style={{ padding:'14px 12px' }}>
            <div style={{ fontSize:12,fontWeight:700,color:'var(--text)',marginBottom:10,textAlign:'center',letterSpacing:'.02em' }}>
              {MONTH_NAMES[mi]}
            </div>
            {/* Mini day headers */}
            <div style={{ display:'grid',gridTemplateColumns:'repeat(7,1fr)',marginBottom:4 }}>
              {DAY_SHORT.map(d => (
                <div key={d} style={{ textAlign:'center',fontSize:8.5,fontWeight:600,color:'var(--text-subtle)',letterSpacing:'.04em' }}>{d[0]}</div>
              ))}
            </div>
            {/* Mini weeks */}
            {weeks.map((week,wi) => (
              <div key={wi} style={{ display:'grid',gridTemplateColumns:'repeat(7,1fr)',marginBottom:1 }}>
                {week.map(d => {
                  const key = isoDate(d);
                  const isToday = key===today;
                  const inMonth = d.getMonth()===mi;
                  const evs = eventMap[key]||[];
                  return (
                    <div key={key} onClick={evs.length?()=>onDayClick(key):undefined}
                      style={{ textAlign:'center',padding:'1px 0',cursor:evs.length?'pointer':'default' }}
                      title={evs.length?`${evs.length} event${evs.length!==1?'s':''}`:undefined}>
                      <div style={{ width:20,height:20,borderRadius:'50%',margin:'0 auto',display:'flex',alignItems:'center',justifyContent:'center',
                        fontSize:9.5,fontWeight:isToday?700:400,
                        background:isToday?'var(--accent)':'transparent',
                        color:isToday?'var(--accent-fg)':inMonth?'var(--text)':'var(--text-subtle)',
                        position:'relative',
                      }}>
                        {d.getDate()}
                      </div>
                      {evs.length > 0 && inMonth && (
                        <div style={{ display:'flex',justifyContent:'center',gap:1.5,marginTop:1 }}>
                          {evs.slice(0,3).map(ev => {
                            const cfg = EVENT_CFG[ev.type]||EVENT_CFG.meeting;
                            return <div key={ev.id} style={{ width:3.5,height:3.5,borderRadius:'50%',background:cfg.border }}/>;
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── AgendaView ─────────────────────────────────────────────────────
function AgendaView({ agendaDays, eventsByDay, today, onEventClick }) {
  const daysWithContext = agendaDays.map(d => ({
    d,
    key: isoDate(d),
    events: (eventsByDay[isoDate(d)]||[]).sort((a,b) => new Date(a.start)-new Date(b.start)),
  }));

  const hasSomething = daysWithContext.some(x => x.events.length > 0);

  return (
    <div className="card" style={{ padding:0,overflow:'hidden',border:'1px solid var(--border)' }}>
      {!hasSomething && (
        <div style={{ padding:'48px 32px',textAlign:'center',color:'var(--text-subtle)',fontSize:13.5 }}>
          No events in this period — schedule a 1:1 from the Team page or connect Outlook.
        </div>
      )}
      {daysWithContext.map(({ d, key, events }) => {
        const isToday = key===today;
        const isPast  = key < today;
        if (!events.length) return null;
        return (
          <div key={key} style={{ display:'flex',borderBottom:'1px solid var(--border)' }}>
            {/* Date column */}
            <div style={{ width:88,flexShrink:0,padding:'14px 16px',borderRight:'1px solid var(--border)',background:isToday?'color-mix(in srgb,var(--accent) 4%,var(--surface-2))':'var(--surface-2)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'flex-start',gap:2 }}>
              <div style={{ fontSize:10,fontWeight:700,letterSpacing:'.06em',textTransform:'uppercase',color:isToday?'var(--accent)':isPast?'var(--text-subtle)':'var(--text-muted)' }}>
                {d.toLocaleDateString([],{weekday:'short'})}
              </div>
              <div style={{ fontSize:22,fontWeight:700,lineHeight:1, width:38,height:38,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',background:isToday?'var(--accent)':'transparent',color:isToday?'var(--accent-fg)':isPast?'var(--text-subtle)':'var(--text)' }}>
                {d.getDate()}
              </div>
              <div style={{ fontSize:10,color:isToday?'var(--accent)':'var(--text-subtle)',fontWeight:500 }}>
                {MONTH_SHORT[d.getMonth()]}
              </div>
            </div>
            {/* Events column */}
            <div style={{ flex:1,padding:'8px 0' }}>
              {events.map(ev => {
                const cfg = EVENT_CFG[ev.type]||EVENT_CFG.meeting;
                return (
                  <div key={ev.id} className="cal-agenda-row" onClick={()=>onEventClick(ev)}
                    style={{ display:'flex',alignItems:'center',gap:12,padding:'8px 16px',cursor:'pointer' }}>
                    <div style={{ width:3,alignSelf:'stretch',borderRadius:2,background:cfg.border,flexShrink:0 }}/>
                    <div style={{ width:80,flexShrink:0 }}>
                      <div style={{ fontSize:12,fontWeight:600,color:cfg.text,fontFamily:'var(--mono)' }}>{fmt12(ev.start)}</div>
                      {ev.end && <div style={{ fontSize:10,color:'var(--text-subtle)',fontFamily:'var(--mono)' }}>{fmtDuration(ev.start,ev.end)}</div>}
                    </div>
                    <div style={{ flex:1,minWidth:0 }}>
                      <div style={{ fontSize:13.5,fontWeight:600,color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{ev.title}</div>
                      {ev.personName && <div style={{ fontSize:11,color:'var(--text-muted)',marginTop:2 }}>{ev.personName}</div>}
                      {ev.description && !ev.personName && <div style={{ fontSize:11,color:'var(--text-muted)',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{ev.description}</div>}
                    </div>
                    {(ev.source==='outlook'||ev.source==='google') && <div style={{ flexShrink:0,opacity:.4 }}><Icon name="link" size={11}/></div>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}


// ── Shared exports ────────────────────────────────────────────────
// Each platform's CalendarView orchestrator (web: page-head + Google; app:
// m-appbar) imports what it needs from here.
export {
  OutlookService,
  CAL_START_HOUR, CAL_END_HOUR, CAL_PX_PER_HOUR, CAL_TIME_W, EVENT_CFG,
  getWeekDays, getMonthGrid, getMiniMonth, getYearMonths, getAgendaDays,
  eventTopPx, eventHeightPx, nowTopPx, fmt12, fmtDuration, isoDate, todayStr,
  snapTime, formatLocalISO, layoutDayEvents, MONTH_NAMES, MONTH_SHORT, DAY_SHORT,
  MicrosoftLogo, EventDetailModal, OutlookSetupModal, OutlookBanner,
  DayColumn, WeekGrid, MonthView, YearView, AgendaView,
};
