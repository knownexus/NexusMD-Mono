import React from 'react';
import { Icon } from './icons.jsx';
import { HelmData } from './data.jsx';
import { effectiveNeedsMe as coreEffectiveNeedsMe } from '@nexusmd/core';
import {
  StateDot, Prio, FilterChip, CardFrame, Sparkline, Stat,
  Avatar, usePersisted, useSeenTracking, NotificationBanner, MenuButton,
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

Object.assign(window, { Avatar, TypeIcon, StateDot, Prio, FilterChip, CardFrame, Sparkline, Stat, Drawer, Ring, MenuButton, SortHeader, StatusSelect, ProjectChip, usePersisted, useSeenTracking });

// NotificationBanner comes from @nexusmd/ui (imported above) and is re-exported
// so existing app importers keep working unchanged.
export { NotificationBanner };


// ─── Sheet — mobile bottom sheet ─────────────────────────────────────────────
// Sheet now comes from @nexusmd/ui (single shared implementation).
export { Sheet } from '@nexusmd/ui';

// ─── Flash — mobile toast ─────────────────────────────────────────────────────
// A toast. With `onUndo` it stays longer and offers Undo.
function Flash({ msg, icon, onUndo }) {
  if (!msg) return null;
  return (
    <div className={`m-flash${onUndo ? ' has-undo' : ''}`} role="status">
      <Icon name={icon || 'check'} size={15}/>
      <span style={{ flex: 1, minWidth: 0 }}>{msg}</span>
      {onUndo && <button type="button" className="m-flash-undo" onClick={onUndo}>Undo</button>}
    </div>
  );
}
export { Flash };

