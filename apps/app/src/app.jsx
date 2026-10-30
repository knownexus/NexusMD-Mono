import React from 'react';
import { Icon } from './icons.jsx';
import ReactDOM from 'react-dom/client';
import { adoGet, adoPost, adoPatch, adoPut, getAdoConfig, saveAdoConfig, createAdoHttpAdapter } from './ado-client.js';
import { toast } from './toast.jsx';
import { helmPushPref, effectiveNeedsMe } from './components.jsx';
import { HelmData, HelmApi } from './data.jsx';
import { useProfile, ProfileProvider } from './profile-context.jsx';
import { useTweaks } from './tweaks-panel.jsx';
import { getProfileKey } from './profile-keys.js';
import {
  NexusDataProvider, renderContent, SEEN_FINGERPRINTS, DEFAULT_PROJECT_AREAS,
  ProjectAreasModal, DocumentsView, ApiClientProvider, ApiClientView, SettField, SetupScreen, LoadingScreen, ProfileMenu, WidgetOrderEditor, Mini,
  PRCommitsTab, PRFilesTab, CreateWIModal, WIDetail, PersonDetail, DetailDrawer,
} from '@nexusmd/ui';
import { workItemSource } from './work-item-source.js';
import { JiraSettingsModal } from './jira-settings.jsx';
import { useOffScreens } from './work-screens.js';
import { EditorScreen } from './editor-screen.jsx';
import { GitView } from './git-view.jsx';
import { apiFileAdapter } from './adapters/api-file.js';
import { scriptRunnerAdapter } from './adapters/api-script-runner.js';
import { apiHttpAdapter } from './adapters/api-http.js';
import { secureStorageAdapter } from './adapters/secureStorage.js';
import { registerCloudDeepLink, hydrateCloudTokens } from './cloud-auth.js';
import { startAppAutoSync } from './sync.js';
import { DashboardView } from './views/view-dashboard.jsx';
import { WorkItemsView } from './views/view-workitems.jsx';
import { PRView } from './views/view-prs.jsx';
import { BuildsView } from './views/view-builds.jsx';
import { TestsView } from './views/view-tests.jsx';
import { CalendarView } from './views/view-calendar.jsx';
import { TriageView } from './views/view-triage.jsx';
import { TeamView } from './views/view-team.jsx';
import { PlannerView, plannerExportDocx } from './planner/view-planner.jsx';
import { SettingsView } from './views/view-settings.jsx';
import { ListsView } from './views/view-lists.jsx';
import { WorkItemDetail } from './work-item-detail.jsx';
import { ToastHost } from './toast.jsx';
// app.jsx — Shell: sidebar, topbar, view switcher, theme/density, tweaks, settings modal

const { useState, useEffect, useMemo, useRef, useCallback } = React;


// Apply stored team preferences (hidden members, custom members) to a raw team list.
// Called on init and on every data reload so dropdowns always reflect Team page selections
// even before the Team page has been visited.
function applyTeamPrefs(baseTeam) {
  let removedIds = [];
  let customMembers = [];
  try { removedIds = JSON.parse(localStorage.getItem(getProfileKey('helm.team.removed')) || '[]'); } catch (_) {}
  try { customMembers = JSON.parse(localStorage.getItem(getProfileKey('helm.team.custom')) || '[]'); } catch (_) {}
  const azureTeam = (baseTeam || []).filter(t => !t.isCustom);
  const visibleAzure = azureTeam.filter(t => !removedIds.includes(t.id));
  const existingIds = new Set(visibleAzure.map(t => t.id));
  const newCustom = customMembers.filter(m => m.id && !existingIds.has(m.id));
  return [...visibleAzure, ...newCustom];
}

const HELM_THEMES = [
  { id: 'parchment', label: 'Parchment', swatch: ['#f4f1e8', '#ebe5d4', '#9a7e22'] },
  { id: 'dusk',      label: 'Dusk',      swatch: ['#e4e0d2', '#dbd5c2', '#9a7e22'] },
  { id: 'paper',     label: 'Paper',     swatch: ['#f5f5f5', '#e8e8e8', '#1d6fcc'] },
  { id: 'cobalt',    label: 'Cobalt',    swatch: ['#0d1620', '#1f2c3b', '#4a9eff'] },
  { id: 'noir',      label: 'Noir',      swatch: ['#171410', '#282420', '#e8a020'] },
  { id: 'slate',     label: 'Slate',     swatch: ['#1a1c20', '#2a2e38', '#8098e0'] },
  { id: 'forest',    label: 'Forest',    swatch: ['#0e1812', '#1c2a20', '#48b870'] },
];
window.HELM_THEMES = HELM_THEMES;

const DEFAULT_TWEAKS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "lightTheme": "parchment",
  "darkTheme": "cobalt",
  "density": "balanced",
  "sidebar": "labels",
  "typeLabels": false,
  "widgetOrder": ["sprint", "review", "blockers", "team", "triage", "activity", "resolvedme"],
  "widgetWidths": {},
  "widgetHeights": {},
  "quickLinks": [],
  "showMarkdown": true,
  "hiddenDashWidgets": []
}/*EDITMODE-END*/;

const adoHttp = createAdoHttpAdapter();

// Platform calls handed to the shared work-item components in @nexusmd/ui.
async function createWorkItem({ project, type, fields }) {
  const patchDoc = Object.entries(fields).map(([fieldPath, value]) => ({
    op: 'add', path: `/fields/${fieldPath}`, value,
  }));
  await adoPost(`${encodeURIComponent(project)}/_apis/wit/workitems/$${encodeURIComponent(type)}?api-version=7.0`, patchDoc);
}
const patchWorkItemFields = (id, ops) => adoPatch(`_apis/wit/workitems/${id}?api-version=7.0`, ops);
const confidential = {
  load: () => window.helmConfidential?.loadConfidentialConfig?.(),
  hash: (pw) => window.helmConfidential.hashPassword(pw),
};

function detectDefaultSidebar() {
  return window.matchMedia('(max-width:600px)').matches ? 'bottom' : 'labels';
}

const NAV_PRIMARY = [
  { id: 'dashboard', label: 'Dashboard',     icon: 'dashboard' },
  { id: 'work',      label: 'Work items',    icon: 'work'      },
  { id: 'pr',        label: 'Pull requests', icon: 'pr'        },
  { id: 'builds',    label: 'Builds',        icon: 'build'     },
  { id: 'tests',     label: 'Tests',         icon: 'check-circle' },
  { id: 'calendar',  label: 'Calendar',      icon: 'planner'   },
];
const NAV_SECONDARY = [
  { id: 'triage',   label: 'Triage',   icon: 'inbox'   },
  { id: 'team',     label: 'Team',     icon: 'team'    },
  { id: 'planner',  label: 'Planner',  icon: 'planner' },
  { id: 'markdown', label: 'Documents', icon: 'doc'    },
  { id: 'api',      label: 'API Client', icon: 'link'   },
  { id: 'editor',   label: 'Editor',     icon: 'edit'   },
  { id: 'git',      label: 'Repos',      icon: 'git-branch' },
];

// The API client's adapters: collections in a virtual file system, scripts in a worker, native HTTP.
const API_CLIENT_ADAPTERS = {
  file: apiFileAdapter, scriptRunner: scriptRunnerAdapter, apiHttp: apiHttpAdapter, secureStorage: secureStorageAdapter,
};

// ─── Mobile nav tab lists (module-level constants — never recreated) ──────────
const ALL_PRIMARY_TABS = [
  { id: 'dashboard', label: 'Home',    icon: 'dashboard' },
  { id: 'work',      label: 'Work',    icon: 'work'      },
  { id: 'lists',     label: 'Lists',   icon: 'work'      },
  { id: 'planner',   label: 'Planner', icon: 'planner'   },
  { id: 'pr',        label: 'PRs',     icon: 'pr'        },
];
const ALL_SECONDARY_TABS = [
  { id: 'builds',   label: 'Builds',   icon: 'build'        },
  { id: 'tests',    label: 'Tests',    icon: 'check-circle' },
  { id: 'calendar', label: 'Calendar', icon: 'planner'      },
  { id: 'triage',   label: 'Triage',   icon: 'inbox'        },
  { id: 'team',     label: 'Team',     icon: 'team'         },
  { id: 'markdown', label: 'Documents', icon: 'doc'         },
  { id: 'api',      label: 'API Client', icon: 'link'        },
  { id: 'editor',   label: 'Editor',     icon: 'edit'        },
  { id: 'git',      label: 'Repos',      icon: 'git-branch'  },
  { id: 'settings', label: 'Settings', icon: 'settings'     },
];

function tabsForType(type) {
  if (type === 'manual') {
    const ADO_IDS = new Set(['work', 'pr', 'builds', 'tests', 'triage', 'git']);
    return {
      primary:   ALL_PRIMARY_TABS.filter(t => !ADO_IDS.has(t.id)),
      secondary: ALL_SECONDARY_TABS.filter(t => !ADO_IDS.has(t.id)),
    };
  }
  return {
    primary:   ALL_PRIMARY_TABS.filter(t => t.id !== 'lists'),
    secondary: ALL_SECONDARY_TABS,
  };
}

function MobileBottomNav({ view, navigate, navBadges, changeBadges, setMoreOpen, primaryTabs, secondaryTabs }) {
  return (
    <div className="m-bottomnav">
      {primaryTabs.map(n => {
        const active = n.id === view;
        const badge = navBadges[n.id] || changeBadges[n.id] || 0;
        return (
          <button key={n.id} type="button" className={`m-navitem${active ? ' active' : ''}`}
            onClick={() => navigate(n.id)}>
            <span className="m-navicon">
              <Icon name={n.icon} size={21}/>
              {badge > 0 && <span className="m-nav-badge">{badge > 9 ? '9+' : badge}</span>}
            </span>
            {n.label}
          </button>
        );
      })}
      <button type="button"
        className={`m-navitem${secondaryTabs.some(s => s.id === view) ? ' active' : ''}`}
        onClick={() => setMoreOpen(true)}>
        <span className="m-navicon"><Icon name="more" size={21}/></span>
        More
      </button>
    </div>
  );
}

function TabletRail({ view, navigate, navBadges, changeBadges, primaryTabs, railPinned }) {
  return (
    <div className="m-rail">
      <div className="m-rail-brand">
        <svg viewBox="0 0 64 64" fill="none" style={{ width: 32, height: 32 }}>
          <circle cx="32" cy="32" r="27" stroke="currentColor" strokeWidth="2" opacity=".55"/>
          <line x1="32" y1="14" x2="32" y2="32" stroke="currentColor" strokeWidth="2.2"/>
          <line x1="16" y1="42" x2="32" y2="32" stroke="currentColor" strokeWidth="2.2"/>
          <line x1="48" y1="42" x2="32" y2="32" stroke="currentColor" strokeWidth="2.2"/>
          <circle cx="32" cy="14" r="3.4" fill="currentColor"/>
          <circle cx="16" cy="42" r="3.4" fill="currentColor"/>
          <circle cx="48" cy="42" r="3.4" fill="currentColor"/>
          <circle cx="32" cy="32" r="5.6" fill="currentColor"/>
        </svg>
      </div>
      {primaryTabs.map(n => {
        const active = n.id === view;
        const badge = navBadges[n.id] || changeBadges[n.id] || 0;
        return (
          <button key={n.id} type="button" className={`m-railitem${active ? ' active' : ''}`}
            onClick={() => navigate(n.id)}>
            <span className="m-navicon">
              <Icon name={n.icon} size={21}/>
              {badge > 0 && <span className="m-nav-badge">{badge > 9 ? '9+' : badge}</span>}
            </span>
            {n.label}
          </button>
        );
      })}
      <div style={{ flex: 1 }}/>
      {railPinned.map(n => (
        <button key={n.id} type="button" className={`m-railitem${n.id === view ? ' active' : ''}`}
          onClick={() => navigate(n.id)}>
          <span className="m-navicon"><Icon name={n.icon} size={21}/></span>
          {n.label}
        </button>
      ))}
    </div>
  );
}

// ─── Settings modal (reads/writes localStorage via ado-client.js) ─────────────
function SettingsModal({ open, onClose, onSaved }) {
  const [org, setOrg]         = useState('');
  const [pat, setPat]         = useState('');
  const [projects, setProjects] = useState('');
  const [interval, setInterval] = useState(30);
  const [testProject, setTestProject] = useState('');
  const [uatProject, setUatProject] = useState('');
  const [uatPipelineId, setUatPipelineId] = useState('');
  const [uatBranch, setUatBranch] = useState('');
  const [adoWorkItems, setAdoWorkItems] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [emailFrom, setEmailFrom] = useState('');
  const [emailTo, setEmailTo] = useState('');
  const [digestHour, setDigestHour] = useState('');
  const [status, setStatus]   = useState('');
  const [saving, setSaving]   = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [quickLinks, setQuickLinks] = useState([]);

  useEffect(() => {
    if (!open) return;
    const c = getAdoConfig();
    setOrg(c.org || '');
    setPat('');
    setProjects((c.projects || []).join(', '));
    setInterval(c.refreshSecs || 30);
    setTestProject(c.testProject || '');
    setUatProject(c.uatProject || '');
    setUatPipelineId(c.uatPipelineId || '');
    setUatBranch(c.uatBranch || '');
    setAdoWorkItems(c.workItems !== false);
    setStatus('');
    const stored = localStorage.getItem(getProfileKey('helm.tweaks'));
    let tweaks = {};
    try { tweaks = stored ? JSON.parse(stored) : {}; } catch (_) {}
    setQuickLinks(tweaks.quickLinks || DEFAULT_TWEAKS.quickLinks);
  }, [open]);

  const save = async () => {
    setSaving(true); setStatus('Saving…');
    try {
      const projectList = projects.split(/[,\n]+/).map(p => p.trim()).filter(Boolean);
      saveAdoConfig({
        org:           org.trim(),
        ...(pat.trim() ? { pat: pat.trim() } : {}),
        projects:      projectList,
        refreshSecs:   parseInt(interval, 10) || 30,
        testProject:   testProject.trim(),
        uatProject:    uatProject.trim(),
        uatPipelineId: parseInt(uatPipelineId, 10) || 0,
        uatBranch:     uatBranch.trim(),
        workItems:     adoWorkItems,
      });
      setStatus('Saved! Reloading data…');
      setPat('');
      onSaved?.();
      const stored2 = localStorage.getItem(getProfileKey('helm.tweaks'));
      let tweaks2 = {};
      try { tweaks2 = stored2 ? JSON.parse(stored2) : {}; } catch (_) {}
      localStorage.setItem(getProfileKey('helm.tweaks'), JSON.stringify({ ...tweaks2, quickLinks }));
      setTimeout(onClose, 1200);
    } catch (e) {
      setStatus('Error: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const discoverProjects = async () => {
    const currentOrg = org.trim();
    const currentPat = pat.trim() || getAdoConfig().pat;
    if (!currentOrg || !currentPat) { setStatus('Enter org and PAT first.'); return; }
    setDiscovering(true);
    try {
      // Temporarily save org+pat so adoGet can use them
      saveAdoConfig({ org: currentOrg, pat: currentPat });
      const j = await adoGet('_apis/projects?api-version=7.0');
      const names = (j.value || []).map(p => p.name).filter(Boolean);
      if (!names.length) { setStatus('No projects returned.'); setDiscovering(false); return; }
      setProjects(names.join(', '));
      setStatus(`Discovered ${names.length} projects.`);
    } catch (e) {
      setStatus('Error: ' + e.message);
    } finally {
      setDiscovering(false);
    }
  };

  if (!open) return null;
  return (
    <div id="modal-settings" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px',
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16,
        boxShadow: 'var(--shadow-pop)', width: 720, maxWidth: '100%',
        maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Fixed header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', flex: 1 }}>
            Azure DevOps Settings
          </h2>
          <button className="btn icon ghost sm" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Top row: Connection + Testing & UAT side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>

            {/* Connection */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-subtle)', marginBottom: 12 }}>Connection</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={adoWorkItems} onChange={e => setAdoWorkItems(e.target.checked)}/>
                  Load Azure DevOps work items
                </label>
                {!adoWorkItems && (
                  <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: -6 }}>Pull requests, builds and tests still come from Azure DevOps.</div>
                )}
                <SettField label="Organisation" hint="The name after dev.azure.com/">
                  <input value={org} onChange={e => setOrg(e.target.value)} placeholder="your-org-name" style={settInputStyle}/>
                </SettField>
                <SettField label="Personal Access Token" hint="Stored server-side only. Needs Work Items (Read & Write), Code (Read & Write), Build (Read & Execute), Test Management (Read), and Project and Team (Read) scopes.">
                  <input type="password" value={pat} onChange={e => setPat(e.target.value)}
                    placeholder="Leave blank to keep existing PAT" style={settInputStyle}/>
                </SettField>
                <SettField label="Projects" hint="Comma-separated project names.">
                  <textarea value={projects} onChange={e => setProjects(e.target.value)}
                    placeholder="Project1, Project2, Project3" rows={3}
                    style={{ ...settInputStyle, resize: 'vertical', paddingTop: 8, paddingBottom: 8 }}/>
                  <div style={{ marginTop: 6 }}>
                    <button className="btn sm ghost" onClick={discoverProjects} disabled={discovering}>
                      {discovering ? 'Discovering…' : 'Discover projects'}
                    </button>
                  </div>
                </SettField>
                <SettField label="Auto-refresh interval (seconds)">
                  <input type="number" value={interval} onChange={e => setInterval(e.target.value)}
                    min={10} max={3600} style={{ ...settInputStyle, width: 120 }}/>
                </SettField>
              </div>
            </div>

            {/* Testing & UAT */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-subtle)', marginBottom: 12 }}>Testing & UAT</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <SettField label="Test Project">
                  <input value={testProject} onChange={e => setTestProject(e.target.value)} style={settInputStyle}/>
                </SettField>
                <SettField label="UAT Project">
                  <input value={uatProject} onChange={e => setUatProject(e.target.value)} style={settInputStyle}/>
                </SettField>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <SettField label="UAT Pipeline ID">
                    <input type="number" value={uatPipelineId} onChange={e => setUatPipelineId(e.target.value)} style={settInputStyle}/>
                  </SettField>
                  <SettField label="UAT Branch">
                    <input value={uatBranch} onChange={e => setUatBranch(e.target.value)} style={settInputStyle}/>
                  </SettField>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-subtle)', marginBottom: 12 }}>Quick Links</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {quickLinks.map((lnk, i) => {
                const LINK_COLORS = ['var(--info)', 'var(--success)', 'var(--violet)', 'var(--accent)'];
                return (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '160px 1fr auto', gap: 8, alignItems: 'center' }}>
                    <input value={lnk.label} onChange={e => setQuickLinks(ls => ls.map((l, j) => j === i ? { ...l, label: e.target.value } : l))}
                      placeholder="Label" style={settInputStyle}/>
                    <input value={lnk.url} onChange={e => setQuickLinks(ls => ls.map((l, j) => j === i ? { ...l, url: e.target.value } : l))}
                      placeholder="https://…" style={settInputStyle}/>
                    <button className="btn sm ghost" style={{ color: 'var(--danger)' }}
                      onClick={() => setQuickLinks(ls => ls.filter((_, j) => j !== i))}>
                      <Icon name="x" size={12}/>
                    </button>
                  </div>
                );
              })}
              <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }}
                onClick={() => {
                  const LINK_COLORS = ['var(--info)', 'var(--success)', 'var(--violet)', 'var(--accent)'];
                  setQuickLinks(ls => [...ls, { label: '', url: '', color: LINK_COLORS[ls.length % LINK_COLORS.length] }]);
                }}>
                <Icon name="plus" size={12}/> Add link
              </button>
            </div>
          </div>

          {/* Email digest — not available on Android */}
          {false && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-subtle)', marginBottom: 12 }}>Daily Digest Email</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <SettField label="Enable">
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-muted)' }}>
                  <input type="checkbox" checked={emailEnabled} onChange={e => setEmailEnabled(e.target.checked)} />
                  Send a daily digest email
                </label>
              </SettField>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <SettField label="SMTP Host">
                  <input value={smtpHost} onChange={e => setSmtpHost(e.target.value)} style={settInputStyle}/>
                </SettField>
                <SettField label="SMTP Port">
                  <input type="number" value={smtpPort} onChange={e => setSmtpPort(e.target.value)} style={settInputStyle}/>
                </SettField>
                <SettField label="Digest hour (0–23)">
                  <input type="number" min={0} max={23} value={digestHour} onChange={e => setDigestHour(e.target.value)} style={settInputStyle}/>
                </SettField>
                <SettField label="SMTP Username">
                  <input value={smtpUser} onChange={e => setSmtpUser(e.target.value)} style={settInputStyle}/>
                </SettField>
                <SettField label="SMTP Password">
                  <input type="password" value={smtpPass} onChange={e => setSmtpPass(e.target.value)} style={settInputStyle}/>
                </SettField>
                <div/>
                <SettField label="From address">
                  <input value={emailFrom} onChange={e => setEmailFrom(e.target.value)} style={settInputStyle}/>
                </SettField>
                <SettField label="To address">
                  <input value={emailTo} onChange={e => setEmailTo(e.target.value)} style={settInputStyle}/>
                </SettField>
              </div>
            </div>
          </div>
          )}
        </div>

        {/* Fixed footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {status && (
            <div style={{
              padding: '8px 12px', borderRadius: 8, fontSize: 13,
              background: status.startsWith('Error') ? 'var(--danger-soft)' : 'var(--success-soft)',
              color: status.startsWith('Error') ? 'var(--danger)' : 'var(--success)',
            }}>{status}</div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save & reload'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const settInputStyle = {
  width: '100%', padding: '7px 10px',
  border: '1px solid var(--border)', borderRadius: 6,
  background: 'var(--surface-2)', outline: 'none', fontSize: 13, boxSizing: 'border-box',
};

// ─── Main App ─────────────────────────────────────────────────────────────────
function AppShell() {
  const { activeProfile } = useProfile();

  const storedTweaks = (() => {
    try {
      const s = localStorage.getItem(getProfileKey('helm.tweaks'));
      const parsed = s ? JSON.parse(s) : {};
      return { ...DEFAULT_TWEAKS, sidebar: detectDefaultSidebar(), ...parsed };
    } catch { return { ...DEFAULT_TWEAKS, sidebar: detectDefaultSidebar() }; }
  })();
  const [tweaks, setTweak] = useTweaks(storedTweaks);

  const offScreens = useOffScreens();
  const { primary: allPrimary, secondary: allSecondary } = tabsForType(activeProfile?.type || 'ado');
  const primaryTabs = allPrimary.filter(t => !offScreens.includes(t.id));
  const secondaryTabs = allSecondary.filter(t => !offScreens.includes(t.id));
  const visibleSecondaryTabs = secondaryTabs.filter(t =>
    t.id !== 'markdown' || tweaks.showMarkdown !== false
  );
  const RAIL_PINNED = visibleSecondaryTabs.filter(t =>
    ['builds', 'tests', 'team', 'settings'].includes(t.id) ||
    (t.id === 'markdown' && tweaks.showMarkdown !== false)
  );

  // Sync render-time globals so child components can read them without prop drilling
  window.helmTypeLabels = tweaks.typeLabels || false;

  useEffect(() => {
    const palette = tweaks.theme === 'dark'
      ? (tweaks.darkTheme || 'cobalt')
      : (tweaks.lightTheme || 'parchment');
    document.body.dataset.theme = palette;
  }, [tweaks.theme, tweaks.darkTheme, tweaks.lightTheme]);

  useEffect(() => {
    document.body.dataset.density = tweaks.density || 'balanced';
  }, [tweaks.density]);

  useEffect(() => {
    try { localStorage.setItem(getProfileKey('helm.tweaks'), JSON.stringify(tweaks)); } catch (_) {}
  }, [tweaks]);

  const [view, setView] = useState(() => {
    const path = window.location.pathname.replace(/^\//, '') || 'dashboard';
    const validIds = [...NAV_PRIMARY, ...NAV_SECONDARY].map(n => n.id);
    validIds.push('settings');
    return validIds.includes(path) ? path : 'dashboard';
  });
  const navigate = useCallback((viewId) => {
    setView(viewId);
    const path = viewId === 'dashboard' ? '/' : '/' + viewId;
    window.history.pushState(null, '', path);
  }, []);
  const [drawer, setDrawer]       = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [jiraSettingsOpen, setJiraSettingsOpen] = useState(false);
  const [projectAreasOpen, setProjectAreasOpen] = useState(false);
  const [projectAreas, setProjectAreas] = useState(() => {
    try {
      const s = localStorage.getItem(getProfileKey('helm.projectAreas.v3'));
      const data = s ? JSON.parse(s) : DEFAULT_PROJECT_AREAS;
      HelmData.PROJECT_AREAS = data;
      return data;
    } catch { HelmData.PROJECT_AREAS = DEFAULT_PROJECT_AREAS; return DEFAULT_PROJECT_AREAS; }
  });
  useEffect(() => {
    try {
      localStorage.setItem(getProfileKey('helm.projectAreas.v3'), JSON.stringify(projectAreas));
      HelmData.PROJECT_AREAS = projectAreas;
    } catch {}
  }, [projectAreas]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createPrefill, setCreatePrefill] = useState(null);
  const [dataVersion, setDataVersion]   = useState(0);   // bump to force re-render after data load
  const [dataLoaded, setDataLoaded]     = useState(HelmData.loaded);
  const [autoRefreshPaused, setAutoRefreshPaused] = useState(false);
  const [autoRefreshLeft, setAutoRefreshLeft] = useState(HelmData.REFRESH_SECS || 30);

  // ── Mobile device detection ───────────────────────────────────────────────
  const [isPhone, setIsPhone] = useState(() => window.matchMedia('(max-width:600px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width:600px)');
    const handler = e => setIsPhone(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  const device = isPhone ? 'phone' : 'tablet';

  // ── Flash toast state (mobile) ────────────────────────────────────────────
  const [mobileFlash, setMobileFlash] = useState(null);
  const showFlash = useCallback((msg, icon) => {
    setMobileFlash({ msg, icon, k: Date.now() });
  }, []);
  useEffect(() => {
    if (!mobileFlash) return;
    const t = setTimeout(() => setMobileFlash(null), 2600);
    return () => clearTimeout(t);
  }, [mobileFlash]);

  // ── More sheet ────────────────────────────────────────────────────────────
  const [moreOpen, setMoreOpen] = useState(false);

  // Listen for async data load
  useEffect(() => {
    const handler = () => { setDataLoaded(true); setDataVersion(v => v + 1); };
    window.addEventListener('helmdata:loaded', handler);
    return () => window.removeEventListener('helmdata:loaded', handler);
  }, []);

  // Re-hydrate open views after a cloud sync writes merged data to localStorage.
  // Team uses the dataVersion lever; tweaks are re-read into useTweaks state.
  // Planner / notes are handled inside the planner view (listens to the same event).
  useEffect(() => {
    const handler = (e) => {
      const collId = e.detail?.collId;
      if (collId === 'team-custom' || collId === 'team-removed') {
        setDataVersion(v => v + 1);
      } else if (collId === 'tweaks') {
        try {
          const s = localStorage.getItem(getProfileKey('helm.tweaks'));
          const parsed = s ? JSON.parse(s) : {};
          setTweak({ ...DEFAULT_TWEAKS, sidebar: detectDefaultSidebar(), ...parsed });
        } catch (_) {}
      }
    };
    document.addEventListener('nexusmd:sync-applied', handler);
    return () => document.removeEventListener('nexusmd:sync-applied', handler);
  }, [setTweak]);

  // Work items state (live editable)
  const [workItems, setWorkItems] = useState(() => HelmData.WORK_ITEMS);
  const [prs, setPrs] = useState(() => HelmData.PRS);
  const [calendarEvents, setCalendarEvents] = usePersisted('helm.calendar.events', []);
  const [acknowledgedBuilds, setAcknowledgedBuilds] = usePersisted('helm.builds.acknowledged', [], { sync: true });
  const acknowledgedSet = useMemo(() => new Set(acknowledgedBuilds), [acknowledgedBuilds]);
  const [acknowledgedTests, setAcknowledgedTests] = usePersisted('helm.tests.acknowledged', [], { sync: true });
  const acknowledgedTestsSet = useMemo(() => new Set(acknowledgedTests), [acknowledgedTests]);
  const [needsMeCriteria, setNeedsMeCriteria] = usePersisted('helm.pr.needsMeCriteria', { votes: [0], includeDrafts: false }, { sync: true });

  // Team state — kept in sync with TeamView mutations and data reloads.
  // applyTeamPrefs filters out hidden members and merges custom members from
  // localStorage so dropdowns are correct even before the Team page is visited.
  const [team, setTeam] = useState(() => {
    const filtered = applyTeamPrefs(HelmData.TEAM);
    HelmData.TEAM = filtered;
    return filtered;
  });

  // Re-sync when data loads
  useEffect(() => {
    setWorkItems(HelmData.WORK_ITEMS);
    setPrs(HelmData.PRS);
    const filtered = applyTeamPrefs(HelmData.TEAM);
    // Mirror what TeamView.useEffect does on mount — keep the global in sync so
    // every direct read of HelmData.TEAM (Avatar, sub-widgets, etc.) also
    // sees the filtered list without needing the Team page to be visited first.
    HelmData.TEAM = filtered;
    setTeam(filtered);
  }, [dataVersion]);

  const seenCategories = {
    work:   { items: HelmData.WORK_ITEMS || [], fingerprint: SEEN_FINGERPRINTS.work },
    pr:     { items: HelmData.PRS || [],        fingerprint: SEEN_FINGERPRINTS.pr },
    builds: { items: HelmData.BUILDS || [],     fingerprint: SEEN_FINGERPRINTS.builds },
    tests:  { items: HelmData.TESTS || [],      fingerprint: SEEN_FINGERPRINTS.tests },
  };
  const { unseenIds: newItemIds, unseenCounts: changeBadges, markSeen } = useSeenTracking(
    seenCategories, dataLoaded, { storage: window.localStorage, getProfileKey },
  );

  // Mark the active tab's items seen the moment the user opens it (and keep marking
  // it seen as new data arrives while that tab stays active, matching prior behavior
  // of zeroing the active tab's badge on every refresh).
  useEffect(() => {
    if (['work', 'pr', 'builds', 'tests'].includes(view)) markSeen(view);
  }, [view, dataVersion]);

  useEffect(() => { setAutoRefreshLeft(HelmData.REFRESH_SECS || 30); }, [dataVersion]);
  useEffect(() => {
    if (!dataLoaded || autoRefreshPaused) return;
    const t = setInterval(() => {
      setAutoRefreshLeft(v => {
        if (v <= 1) {
          HelmApi?.load().catch(() => {});
          return HelmData.REFRESH_SECS || 30;
        }
        return v - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [dataLoaded, autoRefreshPaused, dataVersion]);

  // Planner + themes persisted to localStorage
  const [plannerData, setPlannerData] = useState(() => HelmData.PLANNER_NOW);
  const [themes, setThemes]           = useState(() => HelmData.THEMES);

  const plannerSaveTimer = useRef(null);
  const themesSaveTimer  = useRef(null);
  useEffect(() => {
    clearTimeout(plannerSaveTimer.current);
    plannerSaveTimer.current = setTimeout(() => {
      const s = JSON.stringify(plannerData);
      try { localStorage.setItem(getProfileKey('helm.planner'), s); } catch (_) {}
      helmPushPref?.('helm.planner', s);
    }, 600);
  }, [plannerData]);
  useEffect(() => {
    clearTimeout(themesSaveTimer.current);
    themesSaveTimer.current = setTimeout(() => {
      const s = JSON.stringify(themes);
      try { localStorage.setItem(getProfileKey('helm.themes'), s); } catch (_) {}
      helmPushPref?.('helm.themes', s);
    }, 600);
  }, [themes]);

  // After settings saved → reload live data
  const handleSettingsSaved = useCallback(() => {
    setDataLoaded(false);
    HelmApi?.load().catch(() => {});
  }, []);

  const addTeamNote = React.useCallback(async (dev, text) => {
    const today = new Date().toISOString().slice(0, 10);
    const newRow = { id: 'n' + Date.now(), person: dev.name, note: text, date: today, status: '', _confidential: true };
    setPlannerData(prev => ({
      ...prev,
      teamNotes: [...(prev.teamNotes || []), newRow],
    }));
  }, []);

  const scheduleOneOnOne = React.useCallback(async (dev, { date, time, duration, points }) => {
    const start = `${date}T${time}`;
    const endDate = new Date(`${date}T${time}`);
    endDate.setMinutes(endDate.getMinutes() + duration);
    const pad = n => String(n).padStart(2, '0');
    const end = `${endDate.getFullYear()}-${pad(endDate.getMonth()+1)}-${pad(endDate.getDate())}T${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`;
    const eventId = Date.now().toString();

    setPlannerData(prev => {
      const newRow = {
        id: 'oo' + Date.now(),
        person: dev.name,
        date,
        points: points || '',
        theirAsks: '',
        actions: '',
        status: '',
      };
      const next = { ...prev, oneOnOnes: [...(prev.oneOnOnes || []), newRow] };
      // Persist immediately so PlannerView reads fresh data when it mounts
      const { year, week } = getYearWeekForOffset(0);
      const saved = loadWeekPlanner(year, week);
      saveWeekPlanner(year, week, next, saved?.themes || {});
      return next;
    });

    setCalendarEvents(prev => [...prev, {
      id: eventId,
      title: `1:1 with ${dev.name}`,
      start,
      end,
      type: 'oneOnOne',
      personId: dev.id,
      personName: dev.name,
      plannerSection: 'oneOnOnes',
      description: points || '',
    }]);

    // Best-effort: also create in Outlook if signed in
    if (window.OutlookService?.isConnected()) {
      window.OutlookService.createEvent({
        title: `1:1 with ${dev.name}`,
        start,
        end,
        description: points || '',
      }).catch(err => console.warn('Outlook createEvent failed:', err));
    }
  }, []);

  const navigateToPlanner = React.useCallback((sectionOrEvent) => {
    const isEvent = sectionOrEvent && typeof sectionOrEvent === 'object';
    const section = isEvent ? sectionOrEvent.plannerSection : sectionOrEvent;
    let notification = null;

    if (isEvent && sectionOrEvent.type === 'oneOnOne' && section === 'oneOnOnes') {
      const ev = sectionOrEvent;
      const evDate = ev.start?.slice(0, 10);
      setPlannerData(prev => {
        const exists = (prev.oneOnOnes || []).some(
          o => o.person?.toLowerCase() === ev.personName?.toLowerCase() && o.date === evDate
        );
        if (exists) return prev;
        return {
          ...prev,
          oneOnOnes: [...(prev.oneOnOnes || []), {
            id: 'oo' + Date.now(),
            person: ev.personName || '',
            date: evDate || '',
            points: ev.description || '',
            theirAsks: '',
            actions: '',
            status: '',
          }],
        };
      });
      const fmtDate = evDate
        ? new Date(evDate + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
        : '';
      notification = {
        sectionId: 'oneOnOnes',
        personName: ev.personName || '',
        date: evDate || '',
        label: `1:1 with ${ev.personName || 'team member'}${fmtDate ? ' (' + fmtDate + ')' : ''} added to planner`,
      };
    }

    window.NexusMDNav = { pendingFilter: section || null, view: 'planner', notification };
    navigate('planner');
  }, [navigate]);

  // ── Calendar entry edit / delete / move — keeps the planner's 1:1 rows in sync ──
  // Resolve the ISO {year, week} for a yyyy-mm-dd date using the planner's helpers.
  const weekForDate = React.useCallback((dateStr) => {
    if (!dateStr) return null;
    try {
      if (typeof getIsoYearWeek === 'function' && typeof getMondayOfDate === 'function')
        return getIsoYearWeek(getMondayOfDate(dateStr + 'T12:00:00'));
    } catch (_) {}
    return null;
  }, []);

  // Mutate the persisted planner week-store's oneOnOnes list for a given date.
  const mutateWeekOneOnOnes = React.useCallback((dateStr, fn) => {
    const yw = weekForDate(dateStr);
    if (!yw || typeof loadWeekPlanner !== 'function' || typeof saveWeekPlanner !== 'function') return;
    const saved = loadWeekPlanner(yw.year, yw.week) || { data: {}, themes: {} };
    const data = saved.data || {};
    saveWeekPlanner(yw.year, yw.week, { ...data, oneOnOnes: fn(data.oneOnOnes || []) }, saved.themes || {});
  }, [weekForDate]);

  // Align planner 1:1 rows when a calendar 1:1 event is edited / moved / deleted.
  const syncOneOnOnePlanner = React.useCallback((oldEv, newEv) => {
    if ((oldEv?.plannerSection || newEv?.plannerSection) !== 'oneOnOnes') return;
    const oldDate = oldEv?.start?.slice(0, 10);
    const oldPerson = (oldEv?.personName || '').toLowerCase();
    const newDate = newEv?.start?.slice(0, 10);
    const match = (o) => o.person?.toLowerCase() === oldPerson && o.date === oldDate;
    const wOld = weekForDate(oldDate), wNew = weekForDate(newDate);
    const sameWeek = !!newEv && !!wOld && !!wNew && wOld.year === wNew.year && wOld.week === wNew.week;

    // In-memory state (the week PlannerView currently shows)
    setPlannerData((prev) => {
      let rows = prev.oneOnOnes || [];
      if (!newEv || !sameWeek) rows = rows.filter((o) => !match(o));
      else rows = rows.map((o) => match(o)
        ? { ...o, person: newEv.personName || o.person, date: newDate || o.date, points: newEv.description ?? o.points }
        : o);
      return { ...prev, oneOnOnes: rows };
    });

    // Persisted per-week stores (source of truth)
    if (!newEv) { mutateWeekOneOnOnes(oldDate, (rows) => rows.filter((o) => !match(o))); return; }
    if (sameWeek) {
      mutateWeekOneOnOnes(oldDate, (rows) => rows.map((o) => match(o)
        ? { ...o, person: newEv.personName || o.person, date: newDate, points: newEv.description ?? o.points } : o));
    } else {
      let moved = null;
      mutateWeekOneOnOnes(oldDate, (rows) => { const keep = []; rows.forEach((o) => match(o) ? (moved = { ...o }) : keep.push(o)); return keep; });
      mutateWeekOneOnOnes(newDate, (rows) => {
        const exists = rows.some((o) => o.person?.toLowerCase() === (newEv.personName || '').toLowerCase() && o.date === newDate);
        if (exists) return rows;
        const row = moved
          ? { ...moved, person: newEv.personName || moved.person, date: newDate, points: newEv.description ?? moved.points }
          : { id: 'oo' + Date.now(), person: newEv.personName || '', date: newDate, points: newEv.description || '', theirAsks: '', actions: '', status: '' };
        return [...rows, row];
      });
    }
  }, [weekForDate, mutateWeekOneOnOnes]);

  const updateCalendarEvent = React.useCallback((id, patch) => {
    const oldEv = (calendarEvents || []).find((e) => String(e.id) === String(id));
    if (!oldEv || oldEv.source === 'outlook') return;
    const newEv = { ...oldEv, ...patch };
    setCalendarEvents((prev) => prev.map((e) => (String(e.id) === String(id) ? { ...e, ...patch } : e)));
    syncOneOnOnePlanner(oldEv, newEv);
    toast?.('Calendar entry updated', 'success');
  }, [calendarEvents, syncOneOnOnePlanner]);

  const deleteCalendarEvent = React.useCallback((id) => {
    const oldEv = (calendarEvents || []).find((e) => String(e.id) === String(id));
    if (!oldEv || oldEv.source === 'outlook') return;
    setCalendarEvents((prev) => prev.filter((e) => String(e.id) !== String(id)));
    syncOneOnOnePlanner(oldEv, null);
    toast?.('Calendar entry deleted', 'success');
  }, [calendarEvents, syncOneOnOnePlanner]);

  const moveCalendarEvent = React.useCallback((id, newDateStr) => {
    const ev = (calendarEvents || []).find((e) => String(e.id) === String(id));
    if (!ev || !newDateStr) return;
    if (ev.source === 'outlook') return;
    if (ev.start && ev.start.slice(0, 10) === newDateStr) return; // no-op
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const time = ev.start ? ev.start.slice(11) : '09:00';
    const newStart = `${newDateStr}T${time || '09:00'}`;
    let newEnd = ev.end;
    if (ev.start && ev.end) {
      const durMs = new Date(ev.end) - new Date(ev.start);
      newEnd = fmt(new Date(new Date(newStart).getTime() + durMs));
    }
    updateCalendarEvent(id, { start: newStart, end: newEnd });
  }, [calendarEvents, updateCalendarEvent]);

  useEffect(() => {
    const onPop = () => {
      const path = window.location.pathname.replace(/^\//, '') || 'dashboard';
      const validIds = [...NAV_PRIMARY, ...NAV_SECONDARY].map(n => n.id);
      validIds.push('settings');
      setView(validIds.includes(path) ? path : 'dashboard');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Keyboard shortcuts (1-6 to switch tabs)
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (e.metaKey || e.ctrlKey) return;
      const map = { '1':'dashboard','2':'work','3':'pr','4':'builds','5':'tests','6':'calendar','7':'triage','8':'team','9':'planner' };
      if (map[e.key]) navigate(map[e.key]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const counts = useMemo(() => ({
    work:    workItems.filter(w => !isTerminalState(w.state)).length,
    pr:      (HelmData.PRS||[]).filter(p=>p.status==='active').length,
    builds:  (HelmData.BUILDS||[]).filter(b=>b.status==='failed'&&!acknowledgedSet.has(b.id)).length,
    tests:   (HelmData.TESTS||[]).filter(t=>t.result==='failed'&&!acknowledgedTestsSet.has(t.id)).length,
    calendar: (calendarEvents || []).filter(ev => {
      const d = new Date(ev.start);
      return d >= new Date(new Date().setHours(0,0,0,0));
    }).length,
    team:    team.length,
    planner: (plannerData.tasks||[]).filter(t=>t.status!=='Done').length,
  }), [workItems, dataVersion, plannerData, team, acknowledgedSet, acknowledgedTestsSet, calendarEvents]);

  const openWI     = (w) => setDrawer({ kind:'wi',     data:w });
  const openPR     = (p) => setDrawer({ kind:'pr',     data:p });
  const openPerson = (d) => setDrawer({ kind:'person', data:d });

  useEffect(() => {
    const h = (e) => {
      setCreatePrefill(e.detail || null);
      setCreateOpen(true);
    };
    window.addEventListener('helm:create-wi', h);
    return () => window.removeEventListener('helm:create-wi', h);
  }, []);

  useEffect(() => {
    const h = (e) => {
      const target = e.detail?.view;
      if (!target) return;
      window.NexusMDNav = { pendingFilter: e.detail.filter || null, view: target };
      navigate(target);
    };
    window.addEventListener('helm:navigate', h);
    return () => window.removeEventListener('helm:navigate', h);
  }, [navigate]);

  const configured = HelmData.configured;

  const needsMeBadge = (prs || []).filter(p => effectiveNeedsMe(p, needsMeCriteria)).length;
  const navBadges = { pr: needsMeBadge };

  const activeScreen = (() => {
    if (!dataLoaded) return (
      <div className="m-screen">
        <div className="m-empty" style={{ paddingTop: 80 }}>
          <div className="et">Loading…</div>
        </div>
      </div>
    );
    // Manual profiles have no ADO connection by design — skip the gate entirely.
    // For ADO profiles, allow Settings through so the user can reach Profiles to switch.
    if (!configured && activeProfile?.type !== 'manual' && view !== 'settings') return (
      <div className="m-screen">
        <div className="m-empty" style={{ paddingTop: 80 }}>
          <div className="ei"><Icon name="settings" size={22}/></div>
          <div className="et">Connect to Azure DevOps</div>
          <div style={{ maxWidth: 260, margin: '8px auto 0', lineHeight: 1.5, fontSize: 13.5 }}>
            Enter your organisation, PAT, and project names to get started.
          </div>
          <button className="btn primary m-btn-lg" style={{ marginTop: 20 }}
            onClick={() => setSettingsOpen(true)}>
            <Icon name="settings" size={14}/> Configure connection
          </button>
        </div>
      </div>
    );
    switch (view) {
      case 'dashboard': return <DashboardView onOpenItem={openWI} onOpenPR={openPR}
        widgetOrder={tweaks.widgetOrder} setWidgetOrder={arr => setTweak('widgetOrder', arr)}
        quickLinks={tweaks.quickLinks || DEFAULT_TWEAKS.quickLinks}
        density={tweaks.density} team={team} acknowledgedSet={acknowledgedSet}
        needsMeCriteria={needsMeCriteria}
        setPlannerData={setPlannerData}
        widgetWidths={tweaks.widgetWidths || {}} setWidgetWidths={ww => setTweak('widgetWidths', ww)}
        widgetHeights={tweaks.widgetHeights || {}} setWidgetHeights={wh => setTweak('widgetHeights', wh)}
        hiddenDashWidgets={tweaks.hiddenDashWidgets || []}
        device={device} onFlash={showFlash}/>;
      case 'work': return <WorkItemsView items={workItems} setItems={setWorkItems}
        onOpen={openWI} onCreate={() => { setCreatePrefill(null); setCreateOpen(true); }}
        team={team} newItemIds={newItemIds.work} device={device} onFlash={showFlash}/>;
      case 'pr': return <PRView prs={prs} onOpen={openPR}
        needsMeCriteria={needsMeCriteria} setNeedsMeCriteria={setNeedsMeCriteria}
        newItemIds={newItemIds.pr} device={device} onFlash={showFlash}/>;
      case 'builds': return <BuildsView builds={HelmData?.BUILDS || []}
        acknowledgedBuilds={acknowledgedBuilds} setAcknowledgedBuilds={setAcknowledgedBuilds}
        newItemIds={newItemIds.builds} device={device}/>;
      case 'tests': return <TestsView tests={HelmData?.TESTS || []}
        acknowledgedTests={acknowledgedTests} setAcknowledgedTests={setAcknowledgedTests}
        newItemIds={newItemIds.tests} device={device}/>;
      case 'calendar': return <CalendarView calendarEvents={calendarEvents}
        onNavigatePlanner={navigateToPlanner} onUpdateEvent={updateCalendarEvent}
        onDeleteEvent={deleteCalendarEvent} onMoveEvent={moveCalendarEvent} device={device}/>;
      case 'triage': return <TriageView device={device}/>;
      case 'team': return <TeamView team={team} workItems={workItems}
        prs={HelmData?.PRS || []} onOpenItem={openWI} onOpenPerson={openPerson}
        onTeamChange={setTeam} onAddNote={addTeamNote}
        onScheduleOneOnOne={scheduleOneOnOne} device={device}/>;
      case 'planner': return <PlannerView data={plannerData} setData={setPlannerData}
        themes={themes} setThemes={setThemes} onExportDocx={plannerExportDocx} device={device} onFlash={showFlash}/>;
      case 'lists': return <ListsView />;
      case 'markdown': return <DocumentsView/>;
      case 'editor': return <EditorScreen/>;
      case 'git': return <GitView/>;
      case 'api': return <ApiClientProvider adapters={API_CLIENT_ADAPTERS}><ApiClientView/></ApiClientProvider>;
      case 'settings': return <SettingsView tweaks={tweaks} setTweak={setTweak}
        onOpenConnection={() => setSettingsOpen(true)}
        onOpenJira={() => setJiraSettingsOpen(true)}
        onWorkScreensChanged={handleSettingsSaved}
        onOpenProjectAreas={() => setProjectAreasOpen(true)}
        onGoPlanner={() => navigate('planner')} device={device}/>;
      default: return null;
    }
  })();

  return (
    <div className="m-app" data-device={device}>
      <StatusBar/>
      {device === 'phone' ? (
        <>
          <div className="m-main">{activeScreen}</div>
          <MobileBottomNav view={view} navigate={navigate} navBadges={navBadges} changeBadges={changeBadges} setMoreOpen={setMoreOpen} primaryTabs={primaryTabs} secondaryTabs={visibleSecondaryTabs}/>
        </>
      ) : (
        <div className="m-bodyrow">
          <TabletRail view={view} navigate={navigate} navBadges={navBadges} changeBadges={changeBadges} primaryTabs={primaryTabs} railPinned={RAIL_PINNED}/>
          <div className="m-main">{activeScreen}</div>
        </div>
      )}

      {mobileFlash && <Flash key={mobileFlash.k} msg={mobileFlash.msg} icon={mobileFlash.icon}/>}

      <Sheet open={moreOpen} icon="more" title="More" sub="Secondary views"
        onClose={() => setMoreOpen(false)}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {visibleSecondaryTabs.map(s => (
            <button key={s.id} className="m-action"
              onClick={() => { navigate(s.id); setMoreOpen(false); }}>
              <span className="ai"><Icon name={s.icon} size={18}/></span>
              <span className="at">{s.label}</span>
            </button>
          ))}
        </div>
      </Sheet>

      <DetailDrawer drawer={drawer} onClose={() => setDrawer(null)}
        setWorkItems={setWorkItems} team={team} plannerData={plannerData}
        patchFields={patchWorkItemFields} confidential={confidential} PRDetail={PRDetail}/>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)}
        onSaved={handleSettingsSaved}/>
      <JiraSettingsModal open={jiraSettingsOpen} onClose={() => setJiraSettingsOpen(false)}
        onSaved={handleSettingsSaved}/>
      <ProjectAreasModal open={projectAreasOpen} onClose={() => setProjectAreasOpen(false)}
        areas={projectAreas} setAreas={setProjectAreas}/>
      <CreateWIModal open={createOpen} onClose={() => setCreateOpen(false)} onSubmit={createWorkItem} inputStyle={settInputStyle}
        onCreated={handleSettingsSaved} prefill={createPrefill} team={team}/>
    </div>
  );
}

// ─── NavItem ──────────────────────────────────────────────────────────────────
function NavItem({ item, active, onClick, count, changed }) {
  return (
    <div className={`nav-item ${active?'active':''}`} onClick={onClick} title={item.label}>
      <span className="nav-icon"><Icon name={item.icon} size={15}/></span>
      <span className="nav-label">{item.label}</span>
      {!!changed && !active && (
        <span className="nav-badge" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>{changed}</span>
      )}
      {count!=null && count>0 && (
        <span className={`nav-badge ${item.id==='builds'&&count>0?'dot':''}`}>
          {item.id==='builds'?'':count}
        </span>
      )}
    </div>
  );
}

function PRDetail({ pr, onClose }) {
  const { TEAM, ME } = HelmData;
  const [tab, setTab] = useState('overview');
  const [comment, setComment] = useState('');
  const [commentPreview, setCommentPreview] = useState(false);
  const [voting, setVoting] = useState(false);
  const [commentStatus, setCommentStatus] = useState('');
  const [posting, setPosting] = useState(false);
  const [uatPushing, setUatPushing] = useState(false);
  const [uatStatus, setUatStatus] = useState('');
  const [threadState, setThreadState] = useState({ status: 'idle', threads: [], error: null });
  const [replyOpen,    setReplyOpen]    = useState({});  // threadId → boolean
  const [replyText,    setReplyText]    = useState({});  // threadId → string
  const [replyPreview, setReplyPreview] = useState({});  // threadId → boolean
  const [replyPosting, setReplyPosting] = useState({});  // threadId → boolean
  const [resolving,    setResolving]    = useState({});  // threadId → boolean

  useEffect(() => {
    if (!pr.repoId || !pr.project) return;
    setThreadState({ status: 'loading', threads: [], error: null });
    adoGet(
      `${encodeURIComponent(pr.project)}/_apis/git/repositories/${pr.repoId}/pullRequests/${pr.id}/threads?api-version=7.0`
    )
      .then(data => {
        const threads = (data.value || []).filter(t =>
          !t.isDeleted &&
          (t.comments || []).some(c => c.commentType === 1 && !c.isDeleted)
        );
        setThreadState({ status: 'ok', threads, error: null });
      })
      .catch(e => setThreadState({ status: 'error', threads: [], error: e.message }));
  }, [pr.id, pr.repoId, pr.project]);

  const isActive = pr.status === 'active' && !pr.draft;
  const canVote  = isActive && pr.repoId && pr.project && ME?.adoId;

  const voteLabels = { 10:'Approved', 5:'Approved with suggestions', '-5':'Waiting for author', '-10':'Rejected', 0:'Reset vote' };
  const voteColors = { 10:'var(--success)', 5:'var(--info)', '-5':'var(--warning)', '-10':'var(--danger)', 0:'var(--text-muted)' };

  const vote = async (v) => {
    if (!canVote) return;
    if (!window.confirm(`Submit vote: "${voteLabels[String(v)]}" on PR #${pr.id}?`)) return;
    setVoting(true);
    try {
      await adoPut(
        `${encodeURIComponent(pr.project)}/_apis/git/repositories/${pr.repoId}/pullRequests/${pr.id}/reviewers/${ME.adoId}?api-version=7.0`,
        { vote: v }
      );
    } catch(e) { window.alert('Vote failed: ' + e.message); }
    finally { setVoting(false); }
  };

  const uatBranch = (HelmData.UAT_BRANCH || '').trim();

  const pushToUat = async () => {
    const sourceBranch = pr.sourceBranch || pr.branch;
    if (!sourceBranch) { window.alert('Cannot determine source branch for this PR.'); return; }
    if (!window.confirm(
      `Set branch "${uatBranch}" to the HEAD of "${sourceBranch}"?\n\n` +
      `Repo: ${pr.repo || pr.repoId}\n` +
      `This will overwrite the current UAT branch tip.`
    )) return;
    setUatPushing(true);
    setUatStatus('Pushing…');
    try {
      const projEnc2 = encodeURIComponent(pr.project);
      const refsBase = `${projEnc2}/_apis/git/repositories/${pr.repoId}/refs?api-version=7.0`;
      // Get source branch HEAD commit
      const srcFilter = encodeURIComponent(sourceBranch.replace(/^refs\/heads\//, ''));
      const srcRefs = await adoGet(`${refsBase}&filter=heads/${srcFilter}`);
      const srcCommitId = (srcRefs.value || [])[0]?.objectId;
      if (!srcCommitId) throw new Error('Could not resolve source branch HEAD.');
      // Get UAT branch current commit (0000… if not yet created)
      const uatBranchName = (HelmData.UAT_BRANCH || uatBranch || 'uat').replace(/^refs\/heads\//, '');
      const uatRefs = await adoGet(`${refsBase}&filter=heads/${encodeURIComponent(uatBranchName)}`);
      const uatCommitId = (uatRefs.value || [])[0]?.objectId || '0000000000000000000000000000000000000000';
      // Update the UAT ref
      await adoPost(refsBase, [{ name: `refs/heads/${uatBranchName}`, newObjectId: srcCommitId, oldObjectId: uatCommitId }]);
      setUatStatus(`✓ UAT updated to ${sourceBranch}`);
      setTimeout(() => setUatStatus(''), 4000);
    } catch (e) {
      setUatStatus('✗ ' + e.message);
    } finally {
      setUatPushing(false);
    }
  };

  const postComment = async () => {
    if (!comment.trim()) return;
    if (!pr.repoId || !pr.project) { window.alert('Cannot comment: missing PR details.'); return; }
    setPosting(true); setCommentStatus('Posting…');
    try {
      const data = await adoPost(
        `${encodeURIComponent(pr.project)}/_apis/git/repositories/${pr.repoId}/pullRequests/${pr.id}/threads?api-version=7.0`,
        { comments: [{ parentCommentId: 0, content: comment.trim(), commentType: 1 }], status: 1 }
      );
      setComment(''); setCommentStatus('Posted!');
      setThreadState(prev => ({
        ...prev,
        threads: [...prev.threads, data],
      }));
      setTimeout(() => setCommentStatus(''), 2000);
    } catch(e) { setCommentStatus('✗ ' + e.message.slice(0,60)); }
    finally { setPosting(false); }
  };

  const resolveThread = async (threadId, currentStatus) => {
    const newStatus = currentStatus === 'active' ? 'fixed' : 'active';
    setResolving(r => ({ ...r, [threadId]: true }));
    try {
      await adoPatch(
        `${encodeURIComponent(pr.project)}/_apis/git/repositories/${pr.repoId}/pullRequests/${pr.id}/threads/${threadId}?api-version=7.0`,
        { status: newStatus }
      );
      setThreadState(prev => ({
        ...prev,
        threads: prev.threads.map(t => t.id === threadId ? { ...t, status: newStatus } : t),
      }));
    } catch (e) {
      toast?.('Failed to update thread: ' + e.message, 'error');
    } finally {
      setResolving(r => ({ ...r, [threadId]: false }));
    }
  };

  const postReply = async (threadId) => {
    const text = (replyText[threadId] || '').trim();
    if (!text) return;
    const thread = threadState.threads.find(t => t.id === threadId);
    const lastCommentId = Math.max(
      ...(thread?.comments || []).filter(c => c.commentType === 1).map(c => c.id),
      0
    );
    setReplyPosting(r => ({ ...r, [threadId]: true }));
    try {
      const data = await adoPost(
        `${encodeURIComponent(pr.project)}/_apis/git/repositories/${pr.repoId}/pullRequests/${pr.id}/threads/${threadId}/comments?api-version=7.0`,
        { parentCommentId: lastCommentId, content: text, commentType: 1 }
      );
      setThreadState(prev => ({
        ...prev,
        threads: prev.threads.map(t =>
          t.id === threadId ? { ...t, comments: [...(t.comments || []), data] } : t
        ),
      }));
      setReplyText(r => ({ ...r, [threadId]: '' }));
      setReplyOpen(r => ({ ...r, [threadId]: false }));
      setReplyPreview(r => ({ ...r, [threadId]: false }));
    } catch (e) {
      toast?.('Failed to post reply: ' + e.message, 'error');
    } finally {
      setReplyPosting(r => ({ ...r, [threadId]: false }));
    }
  };

  // Author display name
  const authorName = pr.authorName || (TEAM||[]).find(t => t.id === pr.author)?.name || pr.author || '';

  const tabBtnStyle = (active) => ({
    fontSize: 12, fontWeight: active ? 600 : 500, padding: '5px 12px', borderRadius: 6,
    border: 'none', cursor: 'pointer',
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? 'var(--accent-fg, #fff)' : 'var(--text-muted)',
  });

  return (
    <div>
      {/* ── Author + status header ─── */}
      <div className="drawer-section" style={{ paddingBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <Avatar who={pr.author} size="sm"/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{authorName}</div>
            <div className="muted" style={{ fontSize: 11 }}>opened {pr.age} ago</div>
          </div>
          <span className={`pill ${pr.status === 'merged' ? 'success' : pr.draft ? '' : ''}`}>{pr.draft ? 'Draft' : pr.status}</span>
          {pr.hasConflicts && <span className="pill danger"><Icon name="alert" size={10}/> Conflicts</span>}
          {pr.url && <a href={pr.url} target="_blank" rel="noopener" className="btn sm ghost" style={{ textDecoration: 'none' }}><Icon name="link" size={12}/> ADO</a>}
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 12, alignItems: 'center', color: 'var(--text-muted)', marginBottom: 12 }}>
          <Icon name="git-branch" size={12}/>
          <span className="mono">{pr.sourceBranch || pr.branch}</span>
          <span>→</span>
          <span className="mono">{pr.targetBranch || 'main'}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <Mini label="Approvals" value={`${pr.approvals}/${pr.approvals + (pr.needs || 0)}`}/>
          <Mini label="Comments"  value={pr.comments} color={pr.unresolvedComments > 0 ? 'var(--warning)' : undefined}/>
        </div>
        {pr.ciStatus === 'failed' && <div style={{ marginBottom: 4 }}><span className="pill danger">CI failing</span></div>}
        {pr.ciStatus === 'success' && <div style={{ marginBottom: 4 }}><span className="pill success">CI passing</span></div>}
      </div>

      {/* ── Tabs ─── */}
      <div style={{ display: 'flex', gap: 2, padding: '0 16px 0', borderBottom: '1px solid var(--border)', marginBottom: 0, background: 'var(--surface-2)' }}>
        {[['overview','Overview'],['commits','Commits'],['files','Files']].map(([id, label]) => (
          <button key={id} style={tabBtnStyle(tab === id)} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {/* ── Overview tab ─── */}
      {tab === 'overview' && (
        <div>
          {/* Description */}
          {pr.description && (
            <div className="drawer-section">
              <h4>Description</h4>
              <div
                className="wi-html-content"
                style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)', overflowWrap: 'break-word' }}
                dangerouslySetInnerHTML={{ __html: renderContent(pr.description) }}
              />
            </div>
          )}
          {/* Reviewers with vote status */}
          {(pr.reviewerDetails||[]).length > 0 && (
            <div className="drawer-section">
              <h4>Reviewers</h4>
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {(pr.reviewerDetails||[]).map((r)=>{
                  const voteLabel = r.vote >= 10 ? 'Approved' : r.vote >= 5 ? 'Approved w/ suggestions' : r.vote <= -10 ? 'Rejected' : r.vote === -5 ? 'Waiting' : 'Pending';
                  const votePillCls = r.vote >= 10 ? 'success' : r.vote >= 5 ? 'info' : r.vote <= -10 ? 'danger' : r.vote === -5 ? 'warning' : '';
                  return (
                    <div key={r.name} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',background:'var(--surface-2)',borderRadius:6,fontSize:13}}>
                      <Avatar who={r.id} size="sm"/>
                      <span style={{flex:1}}>{r.name}</span>
                      <span className={`pill ${votePillCls}`} style={{fontSize:10}}>{voteLabel}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Fallback to reviewer IDs if no details */}
          {!(pr.reviewerDetails||[]).length && (pr.reviewers||[]).length > 0 && (
            <div className="drawer-section">
              <h4>Reviewers</h4>
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {(pr.reviewers||[]).map((r,i)=>(
                  <div key={r} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',background:'var(--surface-2)',borderRadius:6,fontSize:13}}>
                    <Avatar who={r} size="sm"/>
                    <span style={{flex:1}}>{r==='me'?'You':(TEAM||[]).find(t=>t.id===r)?.name||r}</span>
                    {i<pr.approvals?<span className="pill success" style={{fontSize:10}}><Icon name="check" size={9}/> Approved</span>:<span className="pill" style={{fontSize:10}}>Pending</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Linked work items */}
          {(pr.linkedWorkItems||[]).length > 0 && (
            <div className="drawer-section">
              <h4>Linked work items</h4>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {(pr.linkedWorkItems||[]).map(wi => (
                  <div key={wi.id} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 10px',background:'var(--surface-2)',borderRadius:6,fontSize:12.5}}>
                    {wi.type && <TypeIcon type={wi.type.toLowerCase()}/>}
                    <span className="mono muted" style={{fontSize:11}}>#{wi.id}</span>
                    <span style={{flex:1,minWidth:0}} className="truncate">{wi.title || `Work Item #${wi.id}`}</span>
                    {wi.state && <StateDot state={wi.state}/>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Comment threads */}
          <div className="drawer-section">
            {threadState.status === 'loading' && (
              <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Loading comments…</div>
            )}
            {threadState.status === 'error' && (
              <div style={{ color: 'var(--danger)', fontSize: 13 }}>{threadState.error}</div>
            )}
            {threadState.status === 'ok' && (() => {
              const openCount = threadState.threads.filter(t => t.status === 'active').length;
              const threadTabStyle = (active) => ({
                fontSize: 11.5, padding: '2px 10px', borderRadius: 6,
                border: '1px solid var(--border)',
                background: active ? 'var(--accent)' : 'transparent',
                color: active ? '#fff' : 'var(--text-muted)',
                cursor: 'pointer', lineHeight: '20px',
              });
              return (
                <>
                  <h4>
                    Comments
                    {threadState.threads.length > 0 && (
                      <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)', marginLeft: 6 }}>
                        ({threadState.threads.length}{openCount > 0 ? ` · ${openCount} open` : ''})
                      </span>
                    )}
                  </h4>
                  {threadState.threads.length === 0 && (
                    <p style={{ fontSize: 12.5, color: 'var(--text-subtle)', margin: 0 }}>No comments yet.</p>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {threadState.threads.map(t => {
                      const isOpen = t.status === 'active';
                      const filePath = t.threadContext?.filePath;
                      const visibleComments = (t.comments || []).filter(c => c.commentType === 1 && !c.isDeleted);
                      const isReplying = replyOpen[t.id];
                      return (
                        <div key={t.id} style={{
                          border: '1px solid var(--border)',
                          borderLeft: `3px solid ${isOpen ? 'var(--warning)' : 'var(--border)'}`,
                          borderRadius: 8,
                          background: 'var(--surface-2)',
                          overflow: 'hidden',
                        }}>
                          {/* Thread header */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                            <span style={{
                              fontSize: 10, padding: '1px 6px', borderRadius: 4, fontWeight: 600,
                              background: isOpen ? 'rgba(234,179,8,0.15)' : 'var(--success-soft)',
                              color: isOpen ? 'var(--warning)' : 'var(--success)',
                            }}>{isOpen ? 'Open' : 'Resolved'}</span>
                            {filePath
                              ? <span className="mono muted truncate" style={{ fontSize: 10.5, flex: 1 }}>{filePath}</span>
                              : <span className="muted" style={{ fontSize: 10.5, flex: 1 }}>General</span>}
                            <button
                              className="btn sm ghost"
                              style={{ fontSize: 11, padding: '2px 8px', flexShrink: 0 }}
                              disabled={!!resolving[t.id]}
                              onClick={() => resolveThread(t.id, t.status)}
                            >
                              {resolving[t.id] ? '…' : isOpen ? 'Resolve' : 'Re-open'}
                            </button>
                          </div>

                          {/* All comments in thread */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                            {visibleComments.map((c, idx) => (
                              <div key={c.id || idx} style={{
                                padding: '10px 12px',
                                borderBottom: idx < visibleComments.length - 1 ? '1px solid var(--border)' : 'none',
                              }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, flexWrap: 'wrap', gap: 4 }}>
                                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                                    {c.author?.displayName || 'Unknown'}
                                  </span>
                                  <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                                    {c.publishedDate ? timeAgo(c.publishedDate) : ''}
                                  </span>
                                </div>
                                <div
                                  className="wi-html-content"
                                  style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.55, overflowWrap: 'break-word' }}
                                  dangerouslySetInnerHTML={{ __html: renderContent(c.content || '') }}
                                />
                              </div>
                            ))}
                          </div>

                          {/* Reply area */}
                          {pr.repoId && pr.project && (
                            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
                              {!isReplying ? (
                                <button
                                  className="btn sm ghost"
                                  style={{ fontSize: 11.5 }}
                                  onClick={() => setReplyOpen(r => ({ ...r, [t.id]: true }))}
                                >
                                  Reply
                                </button>
                              ) : (
                                <div>
                                  <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                                    <button style={threadTabStyle(!replyPreview[t.id])} onClick={() => setReplyPreview(r => ({ ...r, [t.id]: false }))}>Write</button>
                                    <button style={threadTabStyle(!!replyPreview[t.id])} onClick={() => setReplyPreview(r => ({ ...r, [t.id]: true }))}>Preview</button>
                                  </div>
                                  {replyPreview[t.id] ? (
                                    <div
                                      className="wi-html-content"
                                      style={{
                                        minHeight: 56, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8,
                                        background: 'var(--surface-2)', fontSize: 13, lineHeight: 1.6,
                                        color: (replyText[t.id] || '').trim() ? 'var(--text)' : 'var(--text-subtle)',
                                        overflowWrap: 'break-word',
                                      }}
                                      dangerouslySetInnerHTML={{
                                        __html: (replyText[t.id] || '').trim()
                                          ? renderContent(replyText[t.id])
                                          : '<em>Nothing to preview</em>',
                                      }}
                                    />
                                  ) : (
                                    <textarea
                                      value={replyText[t.id] || ''}
                                      onChange={e => setReplyText(r => ({ ...r, [t.id]: e.target.value }))}
                                      onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') postReply(t.id); }}
                                      rows={3}
                                      placeholder="Reply… (Markdown supported)"
                                      style={{
                                        width: '100%', padding: '8px 10px', border: '1px solid var(--border)',
                                        borderRadius: 8, background: 'var(--surface-2)', color: 'var(--text)',
                                        fontSize: 13, fontFamily: 'var(--mono)', resize: 'vertical',
                                        boxSizing: 'border-box',
                                      }}
                                    />
                                  )}
                                  <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
                                    <button
                                      className="btn sm primary"
                                      onClick={() => postReply(t.id)}
                                      disabled={replyPosting[t.id] || !(replyText[t.id] || '').trim()}
                                    >
                                      {replyPosting[t.id] ? 'Posting…' : 'Post reply'}
                                    </button>
                                    <button
                                      className="btn sm ghost"
                                      onClick={() => {
                                        setReplyOpen(r => ({ ...r, [t.id]: false }));
                                        setReplyText(r => ({ ...r, [t.id]: '' }));
                                        setReplyPreview(r => ({ ...r, [t.id]: false }));
                                      }}
                                    >Cancel</button>
                                    <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Ctrl+Enter to post</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </div>

          {/* Push to UAT */}
          {pr.repoId && pr.project && uatBranch && pr.status !== 'abandoned' && pr.status !== 'merged' && (
            <div className="drawer-section">
              <h4>UAT</h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn sm" disabled={uatPushing} onClick={pushToUat}
                  style={{ background: 'var(--violet, var(--accent))', color: 'white', borderColor: 'transparent' }}>
                  <Icon name="git-branch" size={12}/>
                  {uatPushing ? 'Pushing…' : `Push to ${uatBranch}`}
                </button>
                <span className="muted" style={{ fontSize: 11.5 }}>
                  → sets <span className="mono">{uatBranch}</span> to HEAD of <span className="mono">{pr.sourceBranch || pr.branch}</span>
                </span>
              </div>
              {uatStatus && (
                <div style={{
                  marginTop: 8, fontSize: 12, padding: '6px 10px', borderRadius: 6,
                  background: uatStatus.startsWith('✗') ? 'var(--danger-soft)' : 'var(--success-soft)',
                  color:      uatStatus.startsWith('✗') ? 'var(--danger)'      : 'var(--success)',
                }}>{uatStatus}</div>
              )}
            </div>
          )}

          {/* Voting actions */}
          {isActive && (
            <div className="drawer-section">
              <h4>Your vote</h4>
              {canVote ? (
                <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                  {[[10,'Approve'],[5,'Approve w/ suggestions'],[-5,'Waiting'],[-10,'Reject'],[0,'Reset']].map(([v,label])=>(
                    <button key={v} className="btn sm ghost" disabled={voting}
                      style={{fontSize:12, borderColor: voting ? undefined : voteColors[String(v)], color: voting ? undefined : voteColors[String(v)]}}
                      onClick={()=>vote(v)}>{label}</button>
                  ))}
                </div>
              ) : (
                <div className="muted" style={{fontSize:12}}>
                  {!ME?.adoId ? 'ADO identity not resolved — cannot vote.' : 'Voting only available on active non-draft PRs with a resolved repo.'}
                </div>
              )}
            </div>
          )}

          {/* Comment */}
          {pr.repoId && pr.project && (
            <div className="drawer-section">
              <h4>Add comment</h4>
              {(() => {
                const tabStyle = (active) => ({
                  fontSize: 11.5, padding: '2px 10px', borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: active ? 'var(--accent)' : 'transparent',
                  color: active ? '#fff' : 'var(--text-muted)',
                  cursor: 'pointer', lineHeight: '20px',
                });
                return (
                  <>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                      <button style={tabStyle(!commentPreview)} onClick={() => setCommentPreview(false)}>Write</button>
                      <button style={tabStyle(commentPreview)} onClick={() => setCommentPreview(true)}>Preview</button>
                      <span style={{ marginLeft: 4, fontSize: 11, color: 'var(--text-subtle)', alignSelf: 'center' }}>
                        Markdown supported · Ctrl+Enter to post
                      </span>
                    </div>
                    {commentPreview ? (
                      <div
                        className="wi-html-content"
                        style={{
                          minHeight: 72, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8,
                          background: 'var(--surface-2)', fontSize: 13, lineHeight: 1.6,
                          color: comment.trim() ? 'var(--text)' : 'var(--text-subtle)', overflowWrap: 'break-word',
                        }}
                        dangerouslySetInnerHTML={{
                          __html: comment.trim() ? renderContent(comment) : '<em>Nothing to preview</em>',
                        }}
                      />
                    ) : (
                      <textarea
                        value={comment}
                        onChange={e => setComment(e.target.value)}
                        onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') postComment(); }}
                        rows={3}
                        placeholder="Write a comment… (Markdown supported)"
                        style={{ ...settInputStyle, resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 13 }}
                      />
                    )}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                      <button className="btn sm primary" onClick={postComment} disabled={posting || !comment.trim()}>
                        {posting ? 'Posting…' : 'Post comment'}
                      </button>
                      {commentStatus && (
                        <span style={{ fontSize: 12, color: commentStatus.startsWith('✗') ? 'var(--danger)' : 'var(--success)' }}>
                          {commentStatus}
                        </span>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {tab === 'commits' && <PRCommitsTab pr={{ ...pr, org: HelmData.ORG }} http={adoHttp}/>}
      {tab === 'files'   && <PRFilesTab pr={{ ...pr, org: HelmData.ORG }} http={adoHttp}/>}
    </div>
  );
}

function HelmApp() {
  return <ProfileProvider><AppShell /></ProfileProvider>;
}

// Server-side prefs sync removed — localStorage is the only persistence layer on Android.
// Supplies the shared @nexusmd/ui components (Avatar/usePersisted/NotificationBanner/
// MenuButton) with the app's data layer: profile-scoped keys via getProfileKey,
// HelmData for team/me, and the no-op helmPushPref.
const nexusDataValue = {
  data:          HelmData,
  api:           HelmApi,
  storage:       window.localStorage,
  getProfileKey,
  pushPref:      helmPushPref,
  namespace:     'helm',
  workItemSource,
};
// Subscribe to nexusmd:// deep links so cloud OAuth one-time codes are redeemed.
registerCloudDeepLink();

// Decrypt stored cloud tokens into the in-memory cache before the settings card
// reads connection state. A profile switch reloads the page (ui ProfileProvider),
// so this also covers re-hydration for the newly-active profile.
hydrateCloudTokens();

// Start continuous cloud sync (no-op until a passphrase + provider are set).
startAppAutoSync();

(async () => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <NexusDataProvider value={nexusDataValue}>
      <HelmApp/><ToastHost/>
    </NexusDataProvider>
  );
})();


