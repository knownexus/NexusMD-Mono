import React from 'react';
import { Icon } from './icons.jsx';
import { HelmData } from './data.jsx';
import { effectiveNeedsMe as coreEffectiveNeedsMe } from '@nexusmd/core';
import {
  StateDot, Prio, FilterChip, CardFrame, Sparkline, Stat,
  Avatar, usePersisted, NotificationBanner, MenuButton,
  Ring, SortHeader, StatusSelect, ProjectChip, Drawer,
} from '@nexusmd/ui';
// components.jsx — shared bits: Avatar, Pill, TypeIcon, FilterChip, EmptyState, Drawer
// StateDot/Prio/FilterChip/CardFrame/Sparkline/Stat now come from @nexusmd/ui (single
// source). They're re-exposed on window below (Object.assign) so the legacy view files
// that reference them as free globals keep working unchanged.

const { useState, useEffect } = React;

// ─── helmPushPref ─────────────────────────────────────────────────────────────
// On Android, localStorage is the only persistence layer — no server sync needed.
function helmPushPref(_key, _serialised) {
  // localStorage is the only persistence layer on Android — no server sync needed.
}
export { helmPushPref };

// ─── effectiveNeedsMe ─────────────────────────────────────────────────────────
// PR review-filter logic now lives in @nexusmd/core; this thin wrapper injects the
// current user (HelmData.ME) so existing call sites keep their (pr, criteria) shape.
function effectiveNeedsMe(pr, criteria) {
  return coreEffectiveNeedsMe(pr, criteria, HelmData.ME);
}
export { effectiveNeedsMe };

// usePersisted, Avatar, NotificationBanner and MenuButton now come from @nexusmd/ui
// (context-based, imported above). The NexusDataProvider in app.jsx supplies
// data = HelmData, storage = localStorage, getProfileKey (profile-scoped), and
// pushPref = helmPushPref, so behaviour is identical to the old local copies.
// TypeIcon stays local because the app uses the `helmTypeLabels` window flag.

function TypeIcon({ type }) {
  if (window.helmTypeLabels) {
    const labels = { bug: 'Bug', task: 'Task', story: 'Story', feature: 'Feature', epic: 'Epic', spike: 'Spike' };
    return <span className={`type-pill ${type}`} title={type}>{labels[type] || type}</span>;
  }
  const map = { bug: 'B', task: 'T', story: 'S', feature: 'F', epic: 'E', spike: 'K' };
  return <span className={`type-icon ${type}`} title={type}>{map[type] || '·'}</span>;
}

// Drawer now comes from @nexusmd/ui (imported above, re-exposed on window below).
// It persists width under getProfileKey('helm.ui.drawerWidth') via the provider's
// namespace='helm' + profile-scoped getProfileKey — identical to the old local copy.

// Ring, SortHeader, StatusSelect, ProjectChip now come from @nexusmd/ui (imported
// above) and are re-exposed on window below. MenuButton likewise. ProjectChip
// resolves PROJECTS from the NexusDataProvider (data = HelmData).

Object.assign(window, { Avatar, TypeIcon, StateDot, Prio, FilterChip, CardFrame, Sparkline, Stat, Drawer, Ring, MenuButton, SortHeader, StatusSelect, ProjectChip, usePersisted });

// NotificationBanner comes from @nexusmd/ui (imported above) and is re-exported
// so existing app importers keep working unchanged.
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
