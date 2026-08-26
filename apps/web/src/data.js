// data.js — NexusMDData: seed + live loader (thin @nexusmd/core wiring).
// Replaces the legacy data.jsx monolith; heavy mapping logic lives in @nexusmd/core.

import { loadAdoData, loadCachedAdoData } from '@nexusmd/core';
import { createAdoHttpAdapter } from './ado-client.js';
import { localStorageAdapter } from '@nexusmd/web-adapters';
import { GitHubClient } from './github-client.js';

// ── Stored planner / themes ───────────────────────────────────────────────────
export function loadStoredPlanner() {
  try { const s = localStorage.getItem('nexusmd.planner'); if (s) return JSON.parse(s); } catch (_) {}
  return { tasks: [], meetSched: [], meetNotes: [], chatsIn: [], chatsOut: [], statusUpdates: [], oneOnOnes: [], teamNotes: [] };
}

export function loadStoredThemes() {
  try { const s = localStorage.getItem('nexusmd.themes'); if (s) return JSON.parse(s); } catch (_) {}
  return { morale: '', delivery: '', capability: '', process: '', stakeholder: '', risks: '' };
}

// ── Profile-type router ───────────────────────────────────────────────────────
export function getActiveProfileType() {
  try {
    const activeId = localStorage.getItem('nexusmd.activeProfileId');
    if (!activeId) return 'ado';
    const profiles = JSON.parse(localStorage.getItem('nexusmd.profiles') || '[]');
    return profiles.find(p => p.id === activeId)?.type || 'ado';
  } catch (_) { return 'ado'; }
}

// ── /api/config → core contract mapping ──────────────────────────────────────
// The ASP.NET ConfigController returns:
//   { org, projects: string[], testProject, refreshSecs, isDefault,
//     uatProject, uatPipelineId, uatBranch, emailEnabled, emailTo, … }
// Core expects: { org, projects, testProject, uatBranch, refreshSecs }
async function getAdoConfig() {
  const r = await fetch('/api/config');
  if (!r.ok) return null;
  const cfg = await r.json();
  if (!cfg.org || cfg.isDefault) return null;
  return {
    org:         cfg.org,
    projects:    cfg.projects    || [],
    testProject: cfg.testProject || (cfg.projects?.[0] ?? ''),
    uatBranch:   (cfg.uatBranch  || '').replace(/^refs\/heads\//, ''),
    refreshSecs: cfg.refreshSecs || 30,
  };
}

// ── Initial NexusMDData seed ──────────────────────────────────────────────────
export const NexusMDData = {
  TEAM: [{ id: 'dev1', name: 'Loading…', role: 'Developer', initials: '…', tz: 'UTC', status: 'online', focus: '' }],
  ME: { id: 'me', name: 'Loading…', role: 'Eng Manager', initials: 'ME' },
  PROJECTS: [],
  CONFIG_PROJECTS: [],
  STATES: ['Backlog','To Do','Active','In Progress','In Review','Blocked','Resolved','Done','Closed'],
  TYPES: [],
  PRIORITIES: [],
  WI_TYPE_STATES: {},
  WORK_ITEMS: [], PRS: [], BUILDS: [], TESTS: [], ACTIVITY: [], ORG: '',
  RESOLVED_WI: [], AVG_RESOLUTION_DAYS: null,
  SPRINT: { name: 'Current Sprint', start: '—', end: '—', daysLeft: 0, totalPoints: 1, donePoints: 0, inProgPoints: 0, reviewPoints: 0, burndown: [] },
  PLANNER_NOW: loadStoredPlanner(), THEMES: loadStoredThemes(),
  loaded: false, configured: false,
  REFRESH_SECS: 30,
  UAT_BRANCH: '',  // short branch name, e.g. "UAT" — set from Uat:Branch config
};

// ── GitHub data path ──────────────────────────────────────────────────────────
async function nexusMDLoadGitHubData(isRefresh = false) {
  const done = () => { NexusMDData.loaded = true; window.dispatchEvent(new CustomEvent('nexusMDdata:loaded')); };
  if (!GitHubClient?.isConfigured()) {
    NexusMDData.configured = false;
    done();
    return;
  }

  try {
    const activeId = localStorage.getItem('nexusmd.activeProfileId');
    const cacheKey = `nexusmd.p.${activeId}.livedata.v1`;
    if (!isRefresh) {
      try {
        const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
        if (cached) { Object.assign(NexusMDData, cached, { loaded: true, configured: true }); done(); }
      } catch (_) {}
    }

    const [prs, issues, runs, team] = await Promise.all([
      GitHubClient.getPullRequests().catch(() => []),
      GitHubClient.getIssues().catch(() => []),
      GitHubClient.getWorkflowRuns().catch(() => []),
      GitHubClient.getTeam().catch(() => []),
    ]);

    NexusMDData.PRS = prs.map(pr => ({
      id: `gh-${pr.Repo}-${pr.Id}`,
      title: pr.Title,
      author: pr.Author,
      draft: pr.Draft,
      status: pr.State === 'open' ? 'active' : pr.State,
      branch: pr.Branch,
      url: pr.Url,
      created: pr.Created,
      updated: pr.Updated,
      reviewers: (pr.Reviewers || []).map(r => ({ name: r.Login, vote: r.State === 'APPROVED' ? 10 : r.State === 'CHANGES_REQUESTED' ? -10 : 0 })),
      project: pr.Repo.split('/')[0],
      repo: pr.Repo,
    }));

    NexusMDData.WORK_ITEMS = issues.map(i => ({
      id: `gh-${i.Repo}-${i.Id}`,
      type: (i.Tags || []).includes('bug') ? 'bug' : 'story',
      title: i.Title,
      state: i.State === 'open' ? 'To Do' : 'Done',
      assignee: i.Assignee || null,
      assigneeId: null,
      tags: i.Tags || [],
      project: i.Repo.split('/')[0],
      url: i.Url,
      changed: i.Updated,
      priority: 3,
    }));

    NexusMDData.BUILDS = runs.map(r => ({
      id: `gh-run-${r.Id}`,
      name: r.Name,
      status: r.NexusMDStatus,
      branch: r.Branch,
      started: r.Created,
      url: r.Url,
      project: r.Repo.split('/')[0],
    }));

    NexusMDData.TEAM = team.map(m => ({
      id: m.Login,
      name: m.Login,
      initials: m.Login.slice(0, 2).toUpperCase(),
      role: 'Contributor',
      tz: 'UTC',
      status: 'online',
      focus: '',
      avatar: m.AvatarUrl,
    }));

    NexusMDData.configured = true;
    const cachePayload = { PRS: NexusMDData.PRS, WORK_ITEMS: NexusMDData.WORK_ITEMS, BUILDS: NexusMDData.BUILDS, TEAM: NexusMDData.TEAM };
    try { localStorage.setItem(cacheKey, JSON.stringify(cachePayload)); } catch (_) {}
    done();
  } catch (err) {
    console.error('GitHub data load error:', err);
    done();
  }
}

// ── ADO data path (via @nexusmd/core) ────────────────────────────────────────
async function nexusMDLoadLiveData(isRefresh = false) {
  const done = () => { NexusMDData.loaded = true; window.dispatchEvent(new CustomEvent('nexusMDdata:loaded')); };

  // Stale-while-revalidate: serve cached data immediately on first load.
  // No config yet at this point, so org-match validation inside loadCachedAdoData
  // is skipped (it only checks when config.org is truthy).
  if (!isRefresh) {
    try {
      const cached = loadCachedAdoData({}, { storage: localStorageAdapter });
      if (cached) { Object.assign(NexusMDData, cached, { loaded: true, configured: true }); done(); }
    } catch (_) {}
  }

  // Config must load first
  let cfg;
  if (!isRefresh) {
    cfg = await getAdoConfig();
    if (!cfg) { done(); return; }
    NexusMDData.configured = true;
  } else {
    cfg = {
      org:         NexusMDData.ORG,
      projects:    NexusMDData.CONFIG_PROJECTS,
      testProject: NexusMDData._testProject,
      refreshSecs: NexusMDData.REFRESH_SECS,
      uatBranch:   NexusMDData.UAT_BRANCH,
    };
    if (!cfg.org) { done(); return; }
  }

  try {
    const result = await loadAdoData(
      cfg,
      { http: createAdoHttpAdapter(), storage: localStorageAdapter },
      { isRefresh, priorData: NexusMDData }
    );
    Object.assign(NexusMDData, result);
  } catch (err) {
    console.error('[data.js] loadAdoData failed:', err);
  }

  done();
}

// ── Main router ───────────────────────────────────────────────────────────────
async function nexusMDLoadData(isRefresh = false) {
  const type = getActiveProfileType();
  if (type === 'github') return nexusMDLoadGitHubData(isRefresh);
  if (type === 'manual') {
    NexusMDData.loaded = true;
    NexusMDData.configured = false;
    window.dispatchEvent(new CustomEvent('nexusMDdata:loaded'));
    return;
  }
  return nexusMDLoadLiveData(isRefresh);
}

// ── Public API ────────────────────────────────────────────────────────────────
export const NexusMDApi = { load: (isRefresh) => nexusMDLoadData(isRefresh) };
nexusMDLoadData(false).catch(() => { NexusMDData.loaded = true; window.dispatchEvent(new CustomEvent('nexusMDdata:loaded')); });
