// data.jsx — HelmData: seed + live loader (thin @nexusmd/core wiring).
// All ADO fetch/map/derive logic is in @nexusmd/core. Only planner/theme
// storage helpers and the HelmData/HelmApi window shims live here.
import {
  loadAdoData, loadCachedAdoData,
  isTerminalState, isActiveState, isReviewState, isBlockedState, stateCategory,
  timeAgo, adoTypeToHelm, adoStateToHelm, slugify,
} from '@nexusmd/core';
import { getAdoConfig, isAdoConfigured, createAdoHttpAdapter } from './ado-client.js';
import { localStorageAdapter } from './storage-adapter.js';
import { getProfileKey } from './profile-keys.js';

function getActiveProfileType() {
  try {
    const id = localStorage.getItem('helm.activeProfileId');
    const list = JSON.parse(localStorage.getItem('helm.profiles') || '[]');
    return list.find(p => p.id === id)?.type || 'ado';
  } catch (_) { return 'ado'; }
}

function loadStoredPlanner() {
  try { const s = localStorage.getItem(getProfileKey('helm.planner')); if (s) return JSON.parse(s); } catch (_) {}
  return { tasks: [], meetSched: [], meetNotes: [], chatsIn: [], chatsOut: [], statusUpdates: [], oneOnOnes: [], teamNotes: [] };
}

function loadStoredThemes() {
  try { const s = localStorage.getItem(getProfileKey('helm.themes')); if (s) return JSON.parse(s); } catch (_) {}
  return { morale: '', delivery: '', capability: '', process: '', stakeholder: '', risks: '' };
}

// Re-export helpers onto window for legacy view files that still reference them directly.
Object.assign(window, { timeAgo, adoTypeToHelm, adoStateToHelm, slugify, isTerminalState, isActiveState, isReviewState, isBlockedState, stateCategory });

// ── HelmData compatibility shim ───────────────────────────────────────────────
// Views read window.HelmData; data is populated by core then dispatched via event.
export const HelmData = window.HelmData = {
  TEAM: [{ id: 'dev1', name: 'Loading…', role: 'Developer', initials: '…', tz: 'UTC', status: 'online', focus: '' }],
  ME: { id: 'me', name: 'Loading…', role: 'Eng Manager', initials: 'ME' },
  PROJECTS: [], CONFIG_PROJECTS: [],
  STATES: ['Backlog','To Do','Active','In Progress','In Review','Blocked','Resolved','Done','Closed'],
  WORK_ITEMS: [], PRS: [], BUILDS: [], TESTS: [], ACTIVITY: [], ORG: '',
  RESOLVED_WI: [], AVG_RESOLUTION_DAYS: null,
  SPRINT: { name: 'Current Sprint', start: '—', end: '—', daysLeft: 0, totalPoints: 1, donePoints: 0, inProgPoints: 0, reviewPoints: 0, burndown: [] },
  PLANNER_NOW: loadStoredPlanner(), THEMES: loadStoredThemes(),
  loaded: false, configured: false, REFRESH_SECS: 30, UAT_BRANCH: '',
};

function applyToShim(data) {
  Object.assign(HelmData, data);
  window.dispatchEvent(new CustomEvent('helmdata:loaded'));
}

// ── Loader ────────────────────────────────────────────────────────────────────
async function runLoad(isRefresh = false) {
  if (!isAdoConfigured() || getActiveProfileType() === 'manual') {
    HelmData.configured = false;
    HelmData.loaded = true;
    window.dispatchEvent(new CustomEvent('helmdata:loaded'));
    return;
  }
  const cfg = getAdoConfig();
  const adapters = { http: createAdoHttpAdapter(), storage: localStorageAdapter };
  const priorData = isRefresh ? { ...HelmData } : null;
  try {
    const data = await loadAdoData(cfg, adapters, { isRefresh, priorData });
    applyToShim(data);
  } catch (err) {
    console.error('[data.jsx] loadAdoData failed:', err);
    HelmData.loaded = true;
    window.dispatchEvent(new CustomEvent('helmdata:loaded'));
  }
}

export const HelmApi = window.HelmApi = { load: () => runLoad(true) };

// Stale-while-revalidate: show cache immediately, then fetch fresh data.
const cached = loadCachedAdoData(getAdoConfig(), { storage: localStorageAdapter });
if (cached) {
  Object.assign(HelmData, cached, { loaded: true, configured: true });
  window.dispatchEvent(new CustomEvent('helmdata:loaded'));
}

runLoad(false);
