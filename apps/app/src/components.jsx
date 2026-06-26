import React from 'react';
import { Icon } from './icons.jsx';
import { HelmData } from './data.jsx';
import { getProfileKey } from './profile-keys.js';
// components.jsx — shared bits: Avatar, Pill, TypeIcon, FilterChip, EmptyState, Drawer

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ─── helmPushPref ─────────────────────────────────────────────────────────────
// On Android, localStorage is the only persistence layer — no server sync needed.
function helmPushPref(_key, _serialised) {
  // localStorage is the only persistence layer on Android — no server sync needed.
}
export { helmPushPref };

// ─── effectiveNeedsMe ─────────────────────────────────────────────────────────
// Returns true if the PR needs review from the current user, using configurable criteria.
function effectiveNeedsMe(pr, criteria) {
  criteria = criteria || {};
  const votes = criteria.votes && criteria.votes.length ? criteria.votes : [0];
  // Drafts
  if (!criteria.includeDrafts && pr.draft) return false;
  if (criteria.onlyActive && pr.status !== 'active') return false;
  // Exclude PRs with merge conflicts
  if (criteria.excludeConflicts && pr.hasConflicts) return false;
  // Exclude PRs I authored
  if (criteria.excludeMine) {
    const myId = (typeof slugify === 'function') ? slugify((HelmData.ME && HelmData.ME.name) || '') : '';
    if (myId && pr.author === myId) return false;
  }
  // Minimum age (pr.age is a relative string like "5m", "3h", "2d")
  if (criteria.minAgeDays) {
    const a = String(pr.age || '');
    const ageDays = a.endsWith('d') ? (parseInt(a, 10) || 0) : 0;
    if (ageDays < criteria.minAgeDays) return false;
  }
  const meName = (HelmData.ME && HelmData.ME.name) || '';
  if (!meName) return pr.needsMe;
  return (pr.reviewerDetails || []).some(function(r) { return r.name === meName && votes.indexOf(r.vote) !== -1; });
}
export { effectiveNeedsMe };

// ─── usePersisted ──────────────────────────────────────────────────────────────
// Like useState but reads/writes to localStorage. Handles Sets automatically.
// Pass { sync: true } as third arg to trigger helmPushPref (no-op on Android).
function usePersisted(key, initial, { sync = false } = {}) {
  const seed = typeof initial === 'function' ? initial() : initial;
  const isSet = seed instanceof Set;

  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(getProfileKey(key));
      if (raw === null) return seed;
      const parsed = JSON.parse(raw);
      return isSet ? new Set(parsed) : parsed;
    } catch {
      return seed;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(getProfileKey(key), JSON.stringify(value instanceof Set ? [...value] : value));
    } catch {}
  }, [key, value]);

  useEffect(() => {
    if (!sync) return;
    const serialised = localStorage.getItem(getProfileKey(key));
    if (serialised === null) return;
    helmPushPref(key, serialised);
  }, [key, value, sync]);

  return [value, setValue];
}

function Avatar({ who, size = 'sm', title }) {
  // who can be a team id, 'me', or a name
  const team = HelmData.TEAM;
  const me = HelmData.ME;
  const member = who === 'me' ? me : team.find(t => t.id === who);
  const initials = member ? member.initials : (who || '?').slice(0, 2).toUpperCase();
  const hueSeed = (member?.id || who || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = (hueSeed * 47) % 360;
  const bg = member?.id === 'me'
    ? 'var(--accent)'
    : `oklch(0.75 0.1 ${hue})`;
  const fg = member?.id === 'me' ? 'var(--accent-fg)' : 'oklch(0.25 0.08 ' + hue + ')';
  return <div className={`avatar ${size}`} style={{ background: bg, color: fg }} title={title || member?.name || who}>{initials}</div>;
}

function TypeIcon({ type }) {
  if (window.helmTypeLabels) {
    const labels = { bug: 'Bug', task: 'Task', story: 'Story', feature: 'Feature', epic: 'Epic', spike: 'Spike' };
    return <span className={`type-pill ${type}`} title={type}>{labels[type] || type}</span>;
  }
  const map = { bug: 'B', task: 'T', story: 'S', feature: 'F', epic: 'E', spike: 'K' };
  return <span className={`type-icon ${type}`} title={type}>{map[type] || '·'}</span>;
}

function StateDot({ state, withLabel }) {
  const cat = typeof stateCategory !== 'undefined' ? stateCategory(state) : 'todo';
  const dotColor = {
    done:    'var(--success)',
    active:  'var(--info)',
    review:  'var(--violet)',
    blocked: 'var(--danger)',
    todo:    'var(--text-muted)',
  }[cat] ?? 'var(--text-muted)';
  return (
    <span className="row" style={{ gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }}/>
      {withLabel && <span>{state || '—'}</span>}
    </span>
  );
}

function Prio({ p }) {
  if (!p) return <span className="muted mono" style={{fontSize:10.5}}>—</span>;
  return <span className={`prio p${p}`}>P{p}</span>;
}

function FilterChip({ active, count, onClick, children, icon }) {
  return (
    <div className={`filter-chip ${active ? 'active' : ''}`} onClick={onClick}>
      {icon}
      <span>{children}</span>
      {count != null && <span className="count">{count}</span>}
    </div>
  );
}

function CardFrame({ title, subtitle, actions, children, className = '', icon, padded = true, badge }) {
  return (
    <div className={`card ${className}`}>
      <div className="card-head">
        {icon && <span style={{color: 'var(--text-subtle)'}}>{icon}</span>}
        <h3>{title}</h3>
        {badge && <span className="pill" style={{fontSize:10}}>{badge}</span>}
        {subtitle && <span className="muted" style={{fontSize: 11.5, fontWeight: 400}}>{subtitle}</span>}
        {actions && <div className="actions">{actions}</div>}
      </div>
      <div className={padded ? 'card-body' : 'card-body flush'}>{children}</div>
    </div>
  );
}

function Sparkline({ data, width = 64, height = 22, color = 'currentColor' }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function Stat({ label, value, meta, trend, spark, sparkColor, accent, icon }) {
  return (
    <div className="stat">
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className="stat-value" style={accent ? { color: accent } : null}>{value}</div>
      {meta && (
        <div className="stat-meta">
          {trend && <span className={`stat-trend ${trend.dir}`}>{trend.dir === 'up' ? '↑' : trend.dir === 'down' ? '↓' : '·'} {trend.value}</span>}
          <span>{meta}</span>
        </div>
      )}
      {spark && <Sparkline data={spark} color={sparkColor || 'var(--text-subtle)'}/>}
    </div>
  );
}

// Drawer / sliding panel for detail
function Drawer({ open, onClose, title, badges, children, actions }) {
  const DRAWER_MIN = 280;
  const DRAWER_MAX = 2000;
  const drawerRef = useRef(null);
  const draggedW  = useRef(null);
  const [drawerWidth, setDrawerWidth] = useState(() => {
    const stored = parseInt(localStorage.getItem(getProfileKey('helm.ui.drawerWidth')) || '560', 10);
    return Math.min(DRAWER_MAX, Math.max(DRAWER_MIN, stored));
  });

  const [isPhone, setIsPhone] = useState(() => window.matchMedia('(max-width:600px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width:600px)');
    const handler = e => setIsPhone(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  function onResizeStart(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = drawerRef.current ? drawerRef.current.offsetWidth : drawerWidth;
    draggedW.current = startW;
    document.body.classList.add('resizing-drawer');

    function onMove(ev) {
      const newW = Math.min(DRAWER_MAX, Math.max(DRAWER_MIN, startW + (startX - ev.clientX)));
      draggedW.current = newW;
      setDrawerWidth(newW);
    }

    function cleanup() {
      document.body.classList.remove('resizing-drawer');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', cleanup);
      window.removeEventListener('blur', cleanup);
      if (draggedW.current) localStorage.setItem(getProfileKey('helm.ui.drawerWidth'), String(draggedW.current));
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', cleanup);
    window.addEventListener('blur', cleanup);
  }

  return (
    <React.Fragment>
      <div className={`drawer-backdrop ${open ? 'open' : ''}`} onClick={onClose}/>
      <div className={`drawer ${open ? 'open' : ''}`} ref={drawerRef} style={isPhone ? undefined : { width: drawerWidth }}>
        <div className="drawer-resize-handle" onMouseDown={onResizeStart}/>
        <div className="drawer-head">
          <h2 className="truncate">{title}</h2>
          {badges}
          <div className="spacer"/>
          {actions}
          <button className="btn icon ghost sm" onClick={onClose} title="Close (Esc)"><Icon name="x" size={14}/></button>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </React.Fragment>
  );
}

// Mini progress ring (for sprint card)
function Ring({ value, max, size = 56, stroke = 6, color = 'var(--accent)', track = 'var(--surface-3)', label }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={track} strokeWidth={stroke}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${(c*pct).toFixed(2)} ${c.toFixed(2)}`} transform={`rotate(-90 ${size/2} ${size/2})`}/>
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontFamily: 'var(--mono)', fontSize: size > 50 ? 13 : 11, fontWeight: 600 }}>
        {label != null ? label : Math.round(pct * 100) + '%'}
      </div>
    </div>
  );
}

// Reusable popup menu trigger (small)
function MenuButton({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="btn icon ghost sm" onClick={(e) => { e.stopPropagation(); setOpen(o=>!o); }} title="More">
        <Icon name="more" size={14}/>
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '110%',
          minWidth: 160, background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: 'var(--shadow-pop)', padding: 4, zIndex: 50, fontSize: 13
        }}>
          {items.map((it, i) => (
            <button key={i} onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick && it.onClick(); }} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 5,
              width: '100%', textAlign: 'left', background: 'transparent', border: 0, cursor: 'pointer',
              color: it.danger ? 'var(--danger)' : 'var(--text)',
              fontSize: 13,
            }} onMouseEnter={e=>e.currentTarget.style.background='var(--surface-2)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              {it.icon}
              <span>{it.label}</span>
              {it.kbd && <span className="kbd" style={{ marginLeft: 'auto' }}>{it.kbd}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Sortable header
function SortHeader({ col, label, sort, setSort, align }) {
  const active = sort.col === col;
  return (
    <th className={active ? 'sorted' : ''} onClick={() => setSort(s => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }))} style={align ? { textAlign: align } : null}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
        {label}
        <span className="sort">{active && sort.dir === 'desc' ? '↓' : '↑'}</span>
      </span>
    </th>
  );
}

// Inline status select
function StatusSelect({ value, onChange, options = ['', 'To Do', 'In Progress', 'Blocked', 'Done', 'Deferred'] }) {
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value)} style={{
      border: 0, background: 'transparent', font: 'inherit', cursor: 'pointer',
      appearance: 'none', padding: '2px 14px 2px 6px', borderRadius: 4,
      backgroundImage: 'url("data:image/svg+xml;utf8,<svg width=\'10\' height=\'10\' viewBox=\'0 0 10 10\' xmlns=\'http://www.w3.org/2000/svg\'><path d=\'M2 4l3 3 3-3\' stroke=\'%238a857d\' fill=\'none\' stroke-width=\'1.5\'/></svg>")',
      backgroundRepeat: 'no-repeat', backgroundPosition: 'right 2px center', backgroundSize: '10px',
    }}>
      {options.map(o => <option key={o} value={o}>{o || '—'}</option>)}
    </select>
  );
}

// Project chip
function ProjectChip({ id }) {
  const p = HelmData.PROJECTS.find(x => x.id === id);
  if (!p) return null;
  return (
    <span className="pill" style={{ background: 'transparent', borderColor: 'var(--border)' }}>
      <span className="dot" style={{ background: p.color }}/>
      {p.name}
    </span>
  );
}

Object.assign(window, { Avatar, TypeIcon, StateDot, Prio, FilterChip, CardFrame, Sparkline, Stat, Drawer, Ring, MenuButton, SortHeader, StatusSelect, ProjectChip, usePersisted });

function NotificationBanner({ label, onDismiss, onView }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      margin: '0 0 12px 0', padding: '9px 14px',
      borderRadius: 8, fontSize: 13,
      background: 'var(--accent-soft)',
      border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
      color: 'var(--accent)',
    }}>
      <Icon name="bell" size={13} style={{ flexShrink: 0 }}/>
      <span style={{ flex: 1 }}>{label}</span>
      {onView && (
        <button className="btn sm ghost" onClick={onView}
          style={{ color: 'var(--accent)', padding: '2px 10px', flexShrink: 0 }}>
          View
        </button>
      )}
      <button className="btn icon ghost sm" onClick={onDismiss} style={{ flexShrink: 0 }}>
        <Icon name="x" size={12}/>
      </button>
    </div>
  );
}
export { NotificationBanner };


// ─── Sheet — mobile bottom sheet ─────────────────────────────────────────────
function Sheet({ open, onClose, icon, title, sub, children, footer, size }) {
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const labelId = title ? 'm-sheet-title' : undefined;
  return (
    <div className="m-sheet-veil"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="m-sheet" style={size === 'tall' ? { maxHeight: '92%' } : null}
        role="dialog" aria-modal="true" aria-labelledby={labelId}
        onClick={e => e.stopPropagation()}>
        {(title || icon) && (
          <div className="m-sheet-h">
            {icon && (
              <span className="ic">
                <Icon name={icon} size={16}/>
              </span>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 id={labelId}>{title}</h2>
              {sub && <div className="sub">{sub}</div>}
            </div>
            <button className="m-iconbtn" onClick={onClose} aria-label="Close">
              <Icon name="x" size={17}/>
            </button>
          </div>
        )}
        <div className="m-sheet-body">{children}</div>
        {footer && <div className="m-sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}
export { Sheet };

// ─── Flash — mobile toast ─────────────────────────────────────────────────────
function Flash({ msg, icon }) {
  if (!msg) return null;
  return (
    <div className="m-flash">
      <Icon name={icon || 'check'} size={15}/>
      {msg}
    </div>
  );
}
export { Flash };


// ─── StatusBar — mobile time/battery bar ─────────────────────────────────────
function StatusBar() {
  const fmtTime = () => {
    const t = new Date();
    const hh = t.getHours() % 12 || 12;
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ap = t.getHours() < 12 ? 'AM' : 'PM';
    return `${hh}:${mm} ${ap}`;
  };
  const [time, setTime] = useState(fmtTime);
  useEffect(() => {
    const id = setInterval(() => setTime(fmtTime()), 30000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="m-statusbar">
      <span>{time}</span>
      <span className="sb-icons">
        <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor">
          <rect x="0" y="7" width="3" height="5" rx="1"/>
          <rect x="5" y="4.5" width="3" height="7.5" rx="1"/>
          <rect x="10" y="2" width="3" height="10" rx="1"/>
          <rect x="15" y="0" width="3" height="12" rx="1" opacity=".35"/>
        </svg>
        <svg width="26" height="13" viewBox="0 0 26 13" fill="none">
          <rect x="1" y="1" width="21" height="11" rx="3" stroke="currentColor" opacity=".4"/>
          <rect x="3" y="3" width="16" height="7" rx="1.5" fill="currentColor"/>
          <rect x="23.5" y="4" width="2" height="5" rx="1" fill="currentColor" opacity=".5"/>
        </svg>
      </span>
    </div>
  );
}
export { StatusBar };
