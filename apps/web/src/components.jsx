import React from 'react';
import { NexusMDData } from './data.js';
// components.jsx — shared bits: Avatar, Pill, TypeIcon, FilterChip, EmptyState, Drawer

import { Icon } from './icons.jsx';
import { slugify, stateCategory } from '@nexusmd/core';

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ─── nexusMDPushPref ─────────────────────────────────────────────────────────────
// Debounced push of a single preference key to the server (/api/prefs).
// Multiple calls for the same key within 1.5 s are coalesced into one request.
const _prefTimers = {};
export function nexusMDPushPref(key, serialised) {
  clearTimeout(_prefTimers[key]);
  _prefTimers[key] = setTimeout(() => {
    fetch('/api/prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: serialised }),
    }).catch(() => {});
  }, 1500);
}

// ─── effectiveNeedsMe ─────────────────────────────────────────────────────────
// Returns true if the PR needs review from the current user, using configurable criteria.
export function effectiveNeedsMe(pr, criteria) {
  criteria = criteria || {};
  const votes = criteria.votes && criteria.votes.length ? criteria.votes : [0];
  // Drafts
  if (!criteria.includeDrafts && pr.draft) return false;
  if (criteria.onlyActive && pr.status !== 'active') return false;
  // Exclude PRs with merge conflicts
  if (criteria.excludeConflicts && pr.hasConflicts) return false;
  // Exclude PRs I authored
  if (criteria.excludeMine) {
    const myId = slugify((NexusMDData.ME && NexusMDData.ME.name) || '');
    if (myId && pr.author === myId) return false;
  }
  // Minimum age (pr.age is a relative string like "5m", "3h", "2d")
  if (criteria.minAgeDays) {
    const a = String(pr.age || '');
    const ageDays = a.endsWith('d') ? (parseInt(a, 10) || 0) : 0;
    if (ageDays < criteria.minAgeDays) return false;
  }
  const meName = (NexusMDData.ME && NexusMDData.ME.name) || '';
  if (!meName) return pr.needsMe;
  return (pr.reviewerDetails || []).some(function(r) { return r.name === meName && votes.indexOf(r.vote) !== -1; });
}

// ─── usePersisted ──────────────────────────────────────────────────────────────
// Like useState but reads/writes to localStorage. Handles Sets automatically.
// Pass { sync: true } as third arg to also debounce-push changes to /api/prefs.
export function usePersisted(key, initial, { sync = false } = {}) {
  const seed = typeof initial === 'function' ? initial() : initial;
  const isSet = seed instanceof Set;

  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return seed;
      const parsed = JSON.parse(raw);
      return isSet ? new Set(parsed) : parsed;
    } catch {
      return seed;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value instanceof Set ? [...value] : value));
    } catch {}
  }, [key, value]);

  useEffect(() => {
    if (!sync) return;
    const serialised = localStorage.getItem(key);
    if (serialised === null) return;
    nexusMDPushPref(key, serialised);
  }, [key, value, sync]);

  return [value, setValue];
}

export function Avatar({ who, size = 'sm', title }) {
  // who can be a team id, 'me', or a name
  const team = NexusMDData.TEAM;
  const me = NexusMDData.ME;
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

export function TypeIcon({ type }) {
  if (window.nexusMDTypeLabels) {
    const labels = { bug: 'Bug', task: 'Task', story: 'Story', feature: 'Feature', epic: 'Epic', spike: 'Spike' };
    return <span className={`type-pill ${type}`} title={type}>{labels[type] || type}</span>;
  }
  const map = { bug: 'B', task: 'T', story: 'S', feature: 'F', epic: 'E', spike: 'K' };
  return <span className={`type-icon ${type}`} title={type}>{map[type] || '·'}</span>;
}

export function StateDot({ state, withLabel }) {
  const cat = stateCategory(state);
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

export function Prio({ p }) {
  if (!p) return <span className="muted mono" style={{fontSize:10.5}}>—</span>;
  return <span className={`prio p${p}`}>P{p}</span>;
}

export function FilterChip({ active, count, onClick, children, icon }) {
  return (
    <div className={`filter-chip ${active ? 'active' : ''}`} onClick={onClick}>
      {icon}
      <span>{children}</span>
      {count != null && <span className="count">{count}</span>}
    </div>
  );
}

export function CardFrame({ title, subtitle, actions, children, className = '', icon, padded = true, badge }) {
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

export function Sparkline({ data, width = 64, height = 22, color = 'currentColor' }) {
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

export function Stat({ label, value, meta, trend, spark, sparkColor, accent, icon }) {
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
export function Drawer({ open, onClose, title, badges, children, actions }) {
  const DRAWER_MIN = 280;
  const DRAWER_MAX = 2000;
  const drawerRef = useRef(null);
  const draggedW  = useRef(null);
  const [drawerWidth, setDrawerWidth] = useState(() => {
    const stored = parseInt(localStorage.getItem('nexusmd.ui.drawerWidth') || '560', 10);
    return Math.min(DRAWER_MAX, Math.max(DRAWER_MIN, stored));
  });

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
      if (draggedW.current) localStorage.setItem('nexusmd.ui.drawerWidth', String(draggedW.current));
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', cleanup);
    window.addEventListener('blur', cleanup);
  }

  return (
    <React.Fragment>
      <div className={`drawer-backdrop ${open ? 'open' : ''}`} onClick={onClose}/>
      <div className={`drawer ${open ? 'open' : ''}`} ref={drawerRef} style={{ width: drawerWidth }}>
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
export function Ring({ value, max, size = 56, stroke = 6, color = 'var(--accent)', track = 'var(--surface-3)', label }) {
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
export function MenuButton({ items }) {
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
export function SortHeader({ col, label, sort, setSort, align }) {
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
export function StatusSelect({ value, onChange, options = ['', 'To Do', 'In Progress', 'Blocked', 'Done', 'Deferred'] }) {
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
export function ProjectChip({ id }) {
  const p = NexusMDData.PROJECTS.find(x => x.id === id);
  if (!p) return null;
  return (
    <span className="pill" style={{ background: 'transparent', borderColor: 'var(--border)' }}>
      <span className="dot" style={{ background: p.color }}/>
      {p.name}
    </span>
  );
}

export function NotificationBanner({ label, onDismiss, onView }) {
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
