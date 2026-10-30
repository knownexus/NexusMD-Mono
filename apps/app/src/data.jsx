// data.jsx — HelmData: seed + live loader (thin @nexusmd/core wiring).
// All ADO fetch/map/derive logic is in @nexusmd/core. Only planner/theme
// storage helpers and the HelmData/HelmApi window shims live here.
import {
  loadAdoData, loadCachedAdoData, loadJiraData, loadCachedJiraData, buildSnapshot, refreshProviders,
  isTerminalState, isActiveState, isReviewState, isBlockedState, stateCategory,
  timeAgo, adoTypeToHelm, adoStateToHelm, slugify,
} from '@nexusmd/core';
import { getAdoConfig, isAdoConfigured, usesAdoWorkItems, createAdoHttpAdapter } from './ado-client.js';
import { skippedFetches } from './work-screens.js';
import { getJiraConfig, isJiraActive, createJiraHttpAdapter } from './jira-client.js';
import { localStorageAdapter } from '@nexusmd/web-adapters';
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
  TYPES: [],
  PRIORITIES: [],
  WI_TYPE_STATES: {},
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
// The cached ADO and Jira snapshots merged into the shape the views read.
function mergedSnapshot() {
  return buildSnapshot({
    adoConfig: getAdoConfig(), adoConfigured: isAdoConfigured(), adoWorkItems: usesAdoWorkItems(),
    jiraConfig: getJiraConfig(), jiraActive: isJiraActive(),
    storage: localStorageAdapter, empty: {},
  });
}

async function runLoad(isRefresh = false) {
  const adoOn = isAdoConfigured() && getActiveProfileType() !== 'manual';
  const jiraOn = isJiraActive() && getActiveProfileType() !== 'manual';
  if (!adoOn && !jiraOn) {
    HelmData.configured = false;
    HelmData.loaded = true;
    window.dispatchEvent(new CustomEvent('helmdata:loaded'));
    return;
  }
  const adapters = { http: createAdoHttpAdapter(), storage: localStorageAdapter };
  const priorData = isRefresh ? { ...HelmData } : null;
  try {
    // Each provider records its own outcome; one failing keeps the other's data and its own cache.
    await refreshProviders({
      storage: localStorageAdapter,
      providers: {
        ado: {
          configured: adoOn,
          run: () => loadAdoData(getAdoConfig(), adapters, { isRefresh, priorData, skip: { ...skippedFetches(), workItems: !usesAdoWorkItems() } }),
        },
        jira: {
          configured: jiraOn,
          run: () => {
            const prior = loadCachedJiraData(getJiraConfig(), { storage: localStorageAdapter });
            return loadJiraData(getJiraConfig(), { http: createJiraHttpAdapter(), storage: localStorageAdapter },
              { isRefresh: !!prior?._jiraMeta, priorData: prior });
          },
        },
      },
    });
    applyToShim({ ...mergedSnapshot(), loaded: true, configured: true });
  } catch (err) {
    console.error('[data.jsx] load failed:', err);
    HelmData.loaded = true;
    window.dispatchEvent(new CustomEvent('helmdata:loaded'));
  }
}

export const HelmApi = window.HelmApi = { load: () => runLoad(true) };

// Stale-while-revalidate: show cache immediately, then fetch fresh data.
const cached = (isAdoConfigured() || isJiraActive()) ? mergedSnapshot() : loadCachedAdoData(getAdoConfig(), { storage: localStorageAdapter });
if (cached && (cached.TEAM?.length || cached.WORK_ITEMS?.length || cached.PRS?.length)) {
  Object.assign(HelmData, cached, { loaded: true, configured: true });
  window.dispatchEvent(new CustomEvent('helmdata:loaded'));
}

runLoad(false);
