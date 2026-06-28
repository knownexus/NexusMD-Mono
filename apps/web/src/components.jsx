import React from 'react';
import { NexusMDData } from './data.js';
// components.jsx — shared bits: Avatar, Pill, TypeIcon, FilterChip, EmptyState, Drawer

import { effectiveNeedsMe as coreEffectiveNeedsMe } from '@nexusmd/core';
import {
  StateDot, Prio, FilterChip, CardFrame, Sparkline, Stat,
  Avatar, TypeIcon, usePersisted, NotificationBanner, MenuButton,
  Ring, SortHeader, StatusSelect, ProjectChip, Drawer,
} from '@nexusmd/ui';

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
// PR review-filter logic now lives in @nexusmd/core; this thin wrapper injects the
// current user (NexusMDData.ME) so existing call sites keep their (pr, criteria) shape.
export function effectiveNeedsMe(pr, criteria) {
  return coreEffectiveNeedsMe(pr, criteria, NexusMDData.ME);
}

// Avatar, TypeIcon, usePersisted, NotificationBanner, MenuButton, plus the pure
// StateDot/Prio/FilterChip/CardFrame/Sparkline/Stat all live in @nexusmd/ui now
// (imported above) and are re-exported so existing local importers keep working.
// The context-based ui versions are wired by the NexusDataProvider in main.jsx
// (data = NexusMDData, storage = localStorage, getProfileKey = identity,
// pushPref = nexusMDPushPref), so behaviour is identical to the old local copies.
export {
  StateDot, Prio, FilterChip, CardFrame, Sparkline, Stat,
  Avatar, TypeIcon, usePersisted, NotificationBanner, MenuButton,
  Ring, SortHeader, StatusSelect, ProjectChip, Drawer,
};

// Drawer, Ring, SortHeader, StatusSelect, ProjectChip, NotificationBanner all come
// from @nexusmd/ui now (imported + re-exported above).
