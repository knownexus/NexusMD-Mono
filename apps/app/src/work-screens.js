// work-screens.js — which of Work's screens are switched off, per profile (mirrors the desktop
// Work module). A switched-off screen leaves the navigation, and for the screens with data of
// their own (Pull requests, Builds, Tests) nothing is fetched. Team and Triage only hide: the
// team list and the work items are what the rest of Work runs on.
import React from 'react';
import { getProfileKey } from './profile-keys.js';

export const WORK_SCREENS = [
  { id: 'pr',     label: 'Pull requests' },
  { id: 'builds', label: 'Builds' },
  { id: 'tests',  label: 'Tests' },
  { id: 'triage', label: 'Triage' },
  { id: 'team',   label: 'Team' },
];

// The loader's `skip` flag for each screen that loads something of its own.
export const FETCHED_BY = { pr: 'prs', builds: 'builds', tests: 'tests' };

const KEY = () => getProfileKey('work.screens.off');
const EVENT = 'nexusmd:work-screens';
const known = new Set(WORK_SCREENS.map(s => s.id));

let cache = null;
function read() {
  try {
    const ids = JSON.parse(localStorage.getItem(KEY()) || '[]');
    return Array.isArray(ids) ? ids.filter(id => known.has(id)) : [];
  } catch { return []; }
}

export function getOffScreens() {
  return cache ?? (cache = read());
}

// Saves the switched-off screens. Work items and Home always stay, so any combination is allowed.
export function setOffScreens(ids) {
  const next = [...new Set(ids)].filter(id => known.has(id));
  try { localStorage.setItem(KEY(), JSON.stringify(next)); } catch { /* kept for this session */ }
  cache = next;
  window.dispatchEvent(new Event(EVENT));
}

export function skippedFetches(off = getOffScreens()) {
  return Object.fromEntries(Object.entries(FETCHED_BY).map(([view, flag]) => [flag, off.includes(view)]));
}

function subscribe(fn) {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

export function useOffScreens() {
  return React.useSyncExternalStore(subscribe, getOffScreens);
}

// Only for tests: forget what was read.
export function resetOffScreensCache() { cache = null; }
