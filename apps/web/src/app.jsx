// app.jsx — Shell: sidebar, topbar, view switcher, theme/density, tweaks, settings modal

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Icon } from './icons.jsx';
import {
  Avatar, Drawer, Prio, ProjectChip, TypeIcon, StateDot,
  nexusMDPushPref, usePersisted,
} from './components.jsx';
import { TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakButton, useTweaks } from './tweaks-panel.jsx';
import { toast, ToastHost } from './toast.jsx';
import { DashboardView } from './view-dashboard.jsx';
import { WorkItemDetail } from './work-item-detail.jsx';
import { WorkItemsView } from './view-workitems.jsx';
import { PRView } from './view-prs.jsx';
import { BuildsView } from './view-builds.jsx';
import { TestsView } from './view-tests.jsx';
import { CalendarView, OutlookService } from './view-calendar.jsx';
import { TeamView } from './view-team.jsx';
import {
  getIsoYearWeek, getMondayOfDate, getYearWeekForOffset,
  loadWeekPlanner, saveWeekPlanner,
} from './view-planner.jsx';
import { PlannerView, plannerExportDocx } from './view-planner.jsx';
import { TriageView } from './view-triage.jsx';
import { SettingsView } from './view-settings.jsx';
import { MarkdownViewer } from './MarkdownViewer.jsx';
import { ProfileProvider, useProfile } from './profile-context.jsx';
import { ProfileSetup } from './profile-setup.jsx';
import { runProfileMigration } from './profile-migration.js';
import { GoogleAuth } from './google-auth.js';
import { GitHubClient } from './github-client.js';
import { loadConfidentialConfig, hashPassword } from './confidential.jsx';
import { loadStoredPlanner, loadStoredThemes, NexusMDData, NexusMDApi } from './data.js';
import { isTerminalState, adoTypeToHelm, timeAgo, mergeTeamRoster } from '@nexusmd/core';
import {
  BuildDetail, PRCommitsTab, PRFilesTab, DEFAULT_PROJECT_AREAS,
  ProjectAreasModal, SettField, SetupScreen, LoadingScreen, ProfileMenu, WidgetOrderEditor, Mini,
  CreateWIModal, WIDetail, PersonDetail, DetailDrawer, settInputStyle,
} from '@nexusmd/ui';
import { createAdoHttpAdapter } from './ado-client.js';
import '@nexusmd/ui/styles.css';

const adoHttp = createAdoHttpAdapter();

// Platform calls handed to the shared work-item components in @nexusmd/ui.
async function createWorkItem({ project, type, fields }) {
  const r = await fetch('/api/workitems', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, type, fields }),
  });
  if (!r.ok) throw new Error((await r.text()).slice(0, 160));
}
async function patchWorkItemFields(id, ops) {
  const r = await fetch(`/api/workitems/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ops),
  });
  if (!r.ok) throw new Error((await r.text()).slice(0, 120));
}
const confidential = { load: loadConfidentialConfig, hash: hashPassword };

// Shared file-download helper.  When running inside the Electron desktop app
// with an output folder configured it writes directly to disk via IPC; otherwise
// it falls back to the standard browser <a download> mechanism.
window.nexusMDDownload = async function nexusMDDownload(filename, content) {
  const folder = localStorage.getItem('nexusmd.outputPath') || null;
  if (window.electronAPI?.saveFile) {
    try {
      const saved = await window.electronAPI.saveFile(filename, content, folder);
      toast?.(`Saved to ${saved}`, 'success');
      return;
    } catch (e) {
      console.warn('[nexusMDDownload] Electron save failed, falling back to browser download:', e);
    }
  }
  const url = URL.createObjectURL(new Blob([content], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

// Apply stored team preferences (hidden members, custom members) to a raw team list.
// Called on init and on every data reload so dropdowns always reflect Team page selections
// even before the Team page has been visited.
function applyTeamPrefs(baseTeam) {
  let removedIds = [];
  let customMembers = [];
  try { removedIds = JSON.parse(localStorage.getItem('nexusmd.team.removed') || '[]'); } catch (_) {}
  try { customMembers = JSON.parse(localStorage.getItem('nexusmd.team.custom') || '[]'); } catch (_) {}
  return mergeTeamRoster(baseTeam, { removedIds, customMembers });
}

const NEXUSMD_THEMES = [
  { id: 'parchment', label: 'Parchment', swatch: ['#f4f1e8', '#ebe5d4', '#9a7e22'] },
  { id: 'dusk',      label: 'Dusk',      swatch: ['#e4e0d2', '#dbd5c2', '#9a7e22'] },
  { id: 'paper',     label: 'Paper',     swatch: ['#f5f5f5', '#e8e8e8', '#1d6fcc'] },
  { id: 'cobalt',    label: 'Cobalt',    swatch: ['#0d1620', '#1f2c3b', '#4a9eff'] },
  { id: 'noir',      label: 'Noir',      swatch: ['#171410', '#282420', '#e8a020'] },
  { id: 'slate',     label: 'Slate',     swatch: ['#1a1c20', '#2a2e38', '#8098e0'] },
  { id: 'forest',    label: 'Forest',    swatch: ['#0e1812', '#1c2a20', '#48b870'] },
];
window.NEXUSMD_THEMES = NEXUSMD_THEMES;

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
  "quickLinks": [
    { "label": "UAT Testing", "url": "https://cirrus.uat.msl.co.uk/", "color": "var(--info)" },
    { "label": "Dev Testing", "url": "https://cirrus.dev.msl.co.uk/", "color": "var(--success)" },
    { "label": "Cirrus HR",   "url": "https://cirrushr.co.uk",        "color": "var(--violet)" }
  ]
}/*EDITMODE-END*/;


const NAV_PRIMARY = [
  { id: 'dashboard', label: 'Dashboard',     icon: 'dashboard' },
  { id: 'work',      label: 'Work items',    icon: 'work'      },
  { id: 'pr',        label: 'Pull requests', icon: 'pr'        },
  { id: 'builds',    label: 'Builds',        icon: 'build'     },
  { id: 'tests',     label: 'Tests',         icon: 'check-circle' },
  { id: 'calendar',  label: 'Calendar',      icon: 'planner'   },
];
const NAV_SECONDARY = [
  { id: 'triage',    label: 'Triage',    icon: 'inbox'    },
  { id: 'team',      label: 'Team',      icon: 'team'     },
  { id: 'planner',   label: 'Planner',   icon: 'planner'  },
  { id: 'settings',  label: 'Settings',  icon: 'settings' },
  { id: 'markdown', label: 'Markdown', icon: 'doc'     },
];

// ─── Settings modal (bridges existing /api/config) ────────────────────────────
function SettingsModal({ open, onClose, onSaved }) {
  const [org, setOrg]         = useState('');
  const [pat, setPat]         = useState('');
  const [projects, setProjects] = useState('');
  const [interval, setInterval] = useState(30);
  const [testProject, setTestProject] = useState('');
  const [uatProject, setUatProject] = useState('');
  const [uatPipelineId, setUatPipelineId] = useState('');
  const [uatBranch, setUatBranch] = useState('');
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
    fetch('/api/config').then(r => r.ok ? r.json() : null).then(c => {
      if (!c) return;
      setOrg(c.org || '');
      setProjects((c.projects || []).join(', '));
      setInterval(c.refreshSecs || 30);
      setTestProject(c.testProject || '');
      setUatProject(c.uatProject || '');
      setUatPipelineId(c.uatPipelineId || '');
      setUatBranch(c.uatBranch || '');
      setEmailEnabled(!!c.emailEnabled);
      setSmtpHost(c.smtpHost || '');
      setSmtpPort(c.smtpPort || '');
      setSmtpUser('');
      setSmtpPass('');
      setEmailFrom(c.emailFrom || '');
      setEmailTo(c.emailTo || '');
      setDigestHour(c.digestHour || '');
      setStatus('');
      const stored = localStorage.getItem('nexusmd.tweaks');
      let tweaks = {};
      try { tweaks = stored ? JSON.parse(stored) : {}; } catch (_) {}
      setQuickLinks(tweaks.quickLinks || DEFAULT_TWEAKS.quickLinks);
    }).catch(() => {});
  }, [open]);

  const save = async () => {
    // Validate required fields before sending
    const orgTrimmed = org.trim();
    const patTrimmed = pat.trim();
    const projList   = projects.split(/[,\n]+/).map(p => p.trim()).filter(Boolean);
    if (!orgTrimmed) { setStatus('Error: Organisation is required.'); return; }
    if (!projList.length) { setStatus('Error: At least one project is required.'); return; }
    if (patTrimmed && !/^[A-Za-z0-9+/=]{20,}$/.test(patTrimmed)) { setStatus('Error: PAT looks invalid — paste the full token.'); return; }

    setSaving(true); setStatus('Saving…');
    try {
      const body = {
        Organisation: orgTrimmed,
        Pat: pat.trim() || undefined,
        Projects: projects.split(/[,\n]+/).map(p => p.trim()).filter(Boolean),
        RefreshSecs: parseInt(interval, 10) || 30,
        TestProject: testProject.trim() || undefined,
        UatProject: uatProject.trim() || undefined,
        UatPipelineId: parseInt(uatPipelineId, 10) || undefined,
        UatBranch: uatBranch.trim() || undefined,
        EmailEnabled: !!emailEnabled,
        SmtpHost: smtpHost.trim() || undefined,
        SmtpPort: parseInt(smtpPort, 10) || undefined,
        SmtpUser: smtpUser.trim() || undefined,
        SmtpPass: smtpPass.trim() || undefined,
        EmailFrom: emailFrom.trim() || undefined,
        EmailTo: emailTo.trim() || undefined,
        DigestHour: parseInt(digestHour, 10) || undefined,
      };
      const r = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) { const e = await r.text(); setStatus('Error: ' + e.slice(0, 120)); return; }
      setStatus('Saved! Reloading data…');
      setPat('');
      onSaved?.();
      const stored2 = localStorage.getItem('nexusmd.tweaks');
      let tweaks2 = {};
      try { tweaks2 = stored2 ? JSON.parse(stored2) : {}; } catch (_) {}
      localStorage.setItem('nexusmd.tweaks', JSON.stringify({ ...tweaks2, quickLinks }));
      try { document.dispatchEvent(new CustomEvent('nexusmd:data-changed', { detail: { collId: 'tweaks' } })); } catch (_) {}
      setTimeout(onClose, 1200);
    } catch (e) {
      setStatus('Error: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const discoverProjects = async () => {
    setDiscovering(true);
    try {
      const r = await fetch('/api/ado/_apis/projects?api-version=7.0');
      if (!r.ok) { setStatus('Error: Discover failed'); return; }
      const j = await r.json();
      const names = (j.value || []).map(p => p.name).filter(Boolean);
      if (!names.length) { setStatus('No projects returned.'); return; }
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

          {/* Email digest */}
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

// ─── Brand org label — reads per-profile orgLabel, falls back to ADO org ──────
function BrandOrg() {
  const { activeProfile } = useProfile?.() || {};
  const org = activeProfile?.orgLabel || NexusMDData.ME?.org || 'msl-cirrus';
  return <span className="org">{org}</span>;
}

// ─── Profile Switcher ─────────────────────────────────────────────────────────
function ProfileSwitcher() {
  const { profiles, activeProfile, switchProfile } = useProfile();
  const [open, setOpen] = useState(false);

  if (!activeProfile) return null;

  return (
    <div className="profile-switcher" style={{ position: 'relative' }}>
      <button
        className="profile-switcher__chip"
        style={{ background: activeProfile.color }}
        onClick={() => setOpen(o => !o)}
        title={`Active profile: ${activeProfile.name}`}
      >{activeProfile.initials}</button>
      {open && (
        <div className="profile-switcher__dropdown">
          {profiles.map(p => (
            <button
              key={p.id}
              className={'profile-switcher__option' + (p.id === activeProfile.id ? ' active' : '')}
              onClick={() => { setOpen(false); if (p.id !== activeProfile.id) switchProfile(p.id); }}
            >
              <span className="profile-switcher__dot" style={{ background: p.color }}/>
              <span>{p.name}</span>
            </button>
          ))}
          <hr style={{ margin: '0.25rem 0', border: 'none', borderTop: '1px solid var(--border)' }}/>
          <button className="profile-switcher__option" onClick={() => { setOpen(false); document.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: { view: 'settings', tab: 'profiles' } })); }}>
            + Add / manage profiles
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Error boundary ───────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('ErrorBoundary caught:', error, info?.componentStack); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, padding: 48, textAlign: 'center' }}>
          <div style={{ fontSize: 32 }}>⚠️</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Something went wrong in this panel</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', maxWidth: 360 }}>{String(this.state.error.message || this.state.error)}</div>
          <button className="btn sm ghost" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Token expiry banner ──────────────────────────────────────────────────────
function TokenExpiryBanner() {
  const [notices, setNotices] = useState([]);

  useEffect(() => {
    const handler = (e) => {
      const service = e.detail?.service || 'unknown';
      setNotices(prev => prev.find(n => n.service === service) ? prev : [...prev, { service, id: Date.now() }]);
    };
    document.addEventListener('nexusmd:token-expired', handler);
    return () => document.removeEventListener('nexusmd:token-expired', handler);
  }, []);

  if (!notices.length) return null;

  const dismiss = (service) => setNotices(prev => prev.filter(n => n.service !== service));

  const reauth = (service) => {
    dismiss(service);
    if (service === 'google') GoogleAuth?.connect();
    if (service === 'github') GitHubClient?.startOAuth();
  };

  return (
    <div style={{ position: 'fixed', top: 52, left: '50%', transform: 'translateX(-50%)', zIndex: 500, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
      {notices.map(n => (
        <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--warning)', borderRadius: 10, boxShadow: '0 4px 20px rgba(0,0,0,.12)', pointerEvents: 'all', fontSize: 13 }}>
          <Icon name="warning" size={14} style={{ color: 'var(--warning)', flexShrink: 0 }}/>
          <span style={{ color: 'var(--text)' }}>{n.service === 'google' ? 'Google' : 'GitHub'} session expired.</span>
          <button className="btn sm ghost" style={{ marginLeft: 4 }} onClick={() => reauth(n.service)}>Re-connect</button>
          <button className="btn sm ghost" style={{ padding: '0 6px' }} onClick={() => dismiss(n.service)}><Icon name="x" size={12}/></button>
        </div>
      ))}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
function App() {
  const storedTweaks = (() => {
    try { const s = localStorage.getItem('nexusmd.tweaks'); return s ? { ...DEFAULT_TWEAKS, ...JSON.parse(s) } : DEFAULT_TWEAKS; } catch { return DEFAULT_TWEAKS; }
  })();
  const [tweaks, setTweak] = useTweaks(storedTweaks);

  // Sync render-time globals so child components can read them without prop drilling
  window.nexusMDTypeLabels = tweaks.typeLabels || false;

  useEffect(() => {
    const palette = tweaks.theme === 'dark'
      ? (tweaks.darkTheme || 'cobalt')
      : (tweaks.lightTheme || 'parchment');
    document.body.dataset.theme = palette;
  }, [tweaks.theme, tweaks.darkTheme, tweaks.lightTheme]);

  useEffect(() => {
    try { localStorage.setItem('nexusmd.tweaks', JSON.stringify(tweaks)); } catch (_) {}
    nexusMDPushPref?.('nexusmd.tweaks', JSON.stringify(tweaks));
    try { document.dispatchEvent(new CustomEvent('nexusmd:data-changed', { detail: { collId: 'tweaks' } })); } catch (_) {}
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
  const [projectAreasOpen, setProjectAreasOpen] = useState(false);
  const [projectAreas, setProjectAreas] = useState(() => {
    try {
      const s = localStorage.getItem('nexusmd.projectAreas.v3');
      const data = s ? JSON.parse(s) : DEFAULT_PROJECT_AREAS;
      NexusMDData.PROJECT_AREAS = data;
      return data;
    } catch { NexusMDData.PROJECT_AREAS = DEFAULT_PROJECT_AREAS; return DEFAULT_PROJECT_AREAS; }
  });
  useEffect(() => {
    try {
      localStorage.setItem('nexusmd.projectAreas.v3', JSON.stringify(projectAreas));
      nexusMDPushPref?.('nexusmd.projectAreas.v3', JSON.stringify(projectAreas));
      NexusMDData.PROJECT_AREAS = projectAreas;
    } catch {}
  }, [projectAreas]);

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const v = localStorage.getItem('nexusmd-sidebar-w');
      return v ? Math.max(160, Math.min(700, parseInt(v, 10))) : 232;
    } catch { return 232; }
  });
  const appRef  = useRef(null);
  const dragRef = useRef(null); // { startX, startW, currentW }

  const startResize = useCallback((e) => {
    if (tweaks.sidebar === 'icons') return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: sidebarWidth, currentW: sidebarWidth };
    document.body.classList.add('resizing-sidebar');
  }, [sidebarWidth, tweaks.sidebar]);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return;
      const newW = Math.max(160, Math.min(400, dragRef.current.startW + e.clientX - dragRef.current.startX));
      dragRef.current.currentW = newW;
      if (appRef.current) appRef.current.style.setProperty('--side-w', newW + 'px');
    };
    const onUp = () => {
      if (!dragRef.current) return;
      const newW = dragRef.current.currentW;
      dragRef.current = null;
      document.body.classList.remove('resizing-sidebar');
      setSidebarWidth(newW);
      try { localStorage.setItem('nexusmd-sidebar-w', newW); } catch {}
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);
  const [createOpen, setCreateOpen] = useState(false);
  const [createPrefill, setCreatePrefill] = useState(null);
  const [dataVersion, setDataVersion]   = useState(0);   // bump to force re-render after data load
  const [dataLoaded, setDataLoaded]     = useState(NexusMDData.loaded);
  const [changeBadges, setChangeBadges] = useState({ work: 0, pr: 0, builds: 0, tests: 0 });
  const [autoRefreshPaused, setAutoRefreshPaused] = useState(false);
  const [autoRefreshLeft, setAutoRefreshLeft] = useState(NexusMDData.REFRESH_SECS || 30);

  // Listen for async data load
  useEffect(() => {
    const handler = () => { setDataLoaded(true); setDataVersion(v => v + 1); };
    window.addEventListener('nexusMDdata:loaded', handler);
    return () => window.removeEventListener('nexusMDdata:loaded', handler);
  }, []);

  // Re-hydrate open views after a cloud sync writes merged data to localStorage.
  // Covers team roster (team-custom / team-removed) via the existing dataVersion lever,
  // and tweaks by reading the fresh value and pushing it into React state.
  // Planner / notes are handled inside PlannerView which listens to the same event.
  useEffect(() => {
    const handler = (e) => {
      const collId = e.detail?.collId;
      if (collId === 'team-custom' || collId === 'team-removed') {
        setDataVersion(v => v + 1);
      } else if (collId === 'tweaks') {
        try {
          const s = localStorage.getItem('nexusmd.tweaks');
          const fresh = s ? { ...DEFAULT_TWEAKS, ...JSON.parse(s) } : DEFAULT_TWEAKS;
          setTweak(fresh);
        } catch (_) {}
      }
    };
    document.addEventListener('nexusmd:sync-applied', handler);
    return () => document.removeEventListener('nexusmd:sync-applied', handler);
  }, [setTweak]);

  // Work items state (live editable)
  const [workItems, setWorkItems] = useState(() => NexusMDData.WORK_ITEMS);
  const [prs, setPrs] = useState(() => NexusMDData.PRS);
  const [builds] = useState(() => NexusMDData.BUILDS);
  const [calendarEvents, setCalendarEvents] = usePersisted('nexusmd.calendar.events', []);
  const [acknowledgedBuilds, setAcknowledgedBuilds] = usePersisted('nexusmd.builds.acknowledged', [], { sync: true });
  const acknowledgedSet = useMemo(() => new Set(acknowledgedBuilds), [acknowledgedBuilds]);
  const [acknowledgedTests, setAcknowledgedTests] = usePersisted('nexusmd.tests.acknowledged', [], { sync: true });
  const acknowledgedTestsSet = useMemo(() => new Set(acknowledgedTests), [acknowledgedTests]);
  const [needsMeCriteria, setNeedsMeCriteria] = usePersisted('nexusmd.pr.needsMeCriteria', { votes: [0], includeDrafts: false }, { sync: true });
  const [newItemIds, setNewItemIds] = useState({ builds: new Set(), tests: new Set(), pr: new Set(), work: new Set() });

  // Team state — kept in sync with TeamView mutations and data reloads.
  // applyTeamPrefs filters out hidden members and merges custom members from
  // localStorage so dropdowns are correct even before the Team page is visited.
  const [team, setTeam] = useState(() => {
    const filtered = applyTeamPrefs(NexusMDData.TEAM);
    NexusMDData.TEAM = filtered;
    return filtered;
  });

  // Re-sync when data loads
  useEffect(() => {
    setWorkItems(NexusMDData.WORK_ITEMS);
    setPrs(NexusMDData.PRS);
    const filtered = applyTeamPrefs(NexusMDData.TEAM);
    // Mirror what TeamView.useEffect does on mount — keep the global in sync so
    // every direct read of NexusMDData.TEAM (Avatar, sub-widgets, etc.) also
    // sees the filtered list without needing the Team page to be visited first.
    NexusMDData.TEAM = filtered;
    setTeam(filtered);
  }, [dataVersion]);

  useEffect(() => {
    const keyMap = { work: 'nexusmd_seen_work', pr: 'nexusmd_seen_pr', builds: 'nexusmd_seen_builds', tests: 'nexusmd_seen_tests' };
    const dataMap = {
      work:   NexusMDData.WORK_ITEMS || [],
      pr:     NexusMDData.PRS || [],
      builds: NexusMDData.BUILDS || [],
      tests:  NexusMDData.TESTS || [],
    };
    // Stable fingerprints — no relative-time strings that change every refresh
    const fp = {
      work:   x => `${x.id}|${x.state}`,
      pr:     x => `${x.id}|${x.status}`,
      builds: x => `${x.id}|${x.status}`,
      tests:  x => `${x.id}|${x.result}|${x.failedTests || 0}`,
    };
    const next      = { work: 0, pr: 0, builds: 0, tests: 0 };
    const newBuilds = new Set();
    const newTests  = new Set();
    const newPrs  = new Set();
    const newWork = new Set();
    Object.keys(dataMap).forEach(k => {
      const cur = {};
      dataMap[k].forEach(i => { cur[i.id] = fp[k](i); });
      const old = JSON.parse(localStorage.getItem(keyMap[k]) || '{}');
      let changed = 0;
      dataMap[k].forEach(i => {
        if (!old[i.id] || old[i.id] !== cur[i.id]) {
          changed++;
          if (k === 'builds') newBuilds.add(i.id);
          if (k === 'tests')  newTests.add(i.id);
          if (k === 'pr')   newPrs.add(i.id);
          if (k === 'work') newWork.add(i.id);
        }
      });
      next[k] = changed;
      if (view === k) localStorage.setItem(keyMap[k], JSON.stringify(cur));
    });
    setChangeBadges(view === 'work' || view === 'pr' || view === 'builds' || view === 'tests' ? { ...next, [view]: 0 } : next);
    // Preserve existing highlights when there are no new items; clear when tab is active
    setNewItemIds(prev => ({
      builds: view === 'builds' ? new Set() : (newBuilds.size ? newBuilds : prev.builds),
      tests:  view === 'tests'  ? new Set() : (newTests.size  ? newTests  : prev.tests),
      pr:     view === 'pr'     ? new Set() : (newPrs.size    ? newPrs    : prev.pr),
      work:   view === 'work'   ? new Set() : (newWork.size   ? newWork   : prev.work),
    }));
  }, [dataVersion, view, workItems]);

  // Clear row highlights the moment the user opens the relevant tab
  useEffect(() => {
    if (view === 'builds') setNewItemIds(prev => ({ ...prev, builds: new Set() }));
    if (view === 'tests')  setNewItemIds(prev => ({ ...prev, tests:  new Set() }));
    if (view === 'pr')     setNewItemIds(prev => ({ ...prev, pr:     new Set() }));
    if (view === 'work')   setNewItemIds(prev => ({ ...prev, work:   new Set() }));
  }, [view]);

  // Pause auto-refresh when tab is hidden; resume when visible again
  useEffect(() => {
    const handler = () => setAutoRefreshPaused(document.hidden);
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  useEffect(() => { setAutoRefreshLeft(NexusMDData.REFRESH_SECS || 30); }, [dataVersion]);
  useEffect(() => {
    if (!dataLoaded || autoRefreshPaused) return;
    const t = setInterval(() => {
      setAutoRefreshLeft(v => {
        if (v <= 1) {
          NexusMDApi?.load().catch(() => {});
          return NexusMDData.REFRESH_SECS || 30;
        }
        return v - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [dataLoaded, autoRefreshPaused, dataVersion]);

  // Planner + themes persisted to localStorage
  const [plannerData, setPlannerData] = useState(() => NexusMDData.PLANNER_NOW);
  const [themes, setThemes]           = useState(() => NexusMDData.THEMES);

  useEffect(() => {
    const s = JSON.stringify(plannerData);
    try { localStorage.setItem('nexusmd.planner', s); } catch (_) {}
    nexusMDPushPref?.('nexusmd.planner', s);
  }, [plannerData]);
  useEffect(() => {
    const s = JSON.stringify(themes);
    try { localStorage.setItem('nexusmd.themes', s); } catch (_) {}
    nexusMDPushPref?.('nexusmd.themes', s);
  }, [themes]);

  // After settings saved → reload live data
  const handleSettingsSaved = useCallback(() => {
    setDataLoaded(false);
    NexusMDApi?.load().catch(() => {});
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
    if (OutlookService?.isConnected()) {
      OutlookService.createEvent({
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

  // Electron tray navigation (e.g. "Settings" tray menu item)
  useEffect(() => {
    if (!window.electronAPI?.onNavigate) return;
    const handler = (route) => {
      const viewId = route.replace(/^\//, '') || 'dashboard';
      const validIds = [...NAV_PRIMARY, ...NAV_SECONDARY].map(n => n.id);
      validIds.push('settings');
      navigate(validIds.includes(viewId) ? viewId : 'dashboard');
    };
    window.electronAPI.onNavigate(handler);
    return () => window.electronAPI.removeNavigateListener?.();
  }, [navigate]);

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
    pr:      (NexusMDData.PRS||[]).filter(p=>p.status==='active').length,
    builds:  (NexusMDData.BUILDS||[]).filter(b=>b.status==='failed'&&!acknowledgedSet.has(b.id)).length,
    tests:   (NexusMDData.TESTS||[]).filter(t=>t.result==='failed'&&!acknowledgedTestsSet.has(t.id)).length,
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
    window.addEventListener('nexusmd:create-wi', h);
    return () => window.removeEventListener('nexusmd:create-wi', h);
  }, []);

  useEffect(() => {
    const h = (e) => {
      const target = e.detail?.view;
      if (!target) return;
      window.NexusMDNav = { pendingFilter: e.detail.filter || null, view: target };
      navigate(target);
    };
    window.addEventListener('nexusmd:navigate', h);
    return () => window.removeEventListener('nexusmd:navigate', h);
  }, [navigate]);

  const navItems   = [...NAV_PRIMARY, ...NAV_SECONDARY];
  const currentNav = navItems.find(n => n.id === view)
    || (view === 'settings'
      ? { id: 'settings', label: 'Settings', icon: 'settings' }
      : NAV_PRIMARY[0]);

  const configured = NexusMDData.configured;

  return (
    <div ref={appRef} className="app" data-sidebar={tweaks.sidebar} data-density={tweaks.density}
      style={{ '--side-w': tweaks.sidebar !== 'icons' ? sidebarWidth + 'px' : undefined }}>
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
              <circle cx="32" cy="32" r="27" stroke="currentColor" strokeWidth="1.5" opacity="0.55"/>
              <line x1="32" y1="14" x2="32" y2="32" stroke="currentColor" strokeWidth="1.8"/>
              <line x1="16" y1="42" x2="32" y2="32" stroke="currentColor" strokeWidth="1.8"/>
              <line x1="48" y1="42" x2="32" y2="32" stroke="currentColor" strokeWidth="1.8"/>
              <circle cx="32" cy="14" r="3.2" fill="currentColor"/>
              <circle cx="16" cy="42" r="3.2" fill="currentColor"/>
              <circle cx="48" cy="42" r="3.2" fill="currentColor"/>
              <circle cx="32" cy="32" r="5.4" fill="currentColor"/>
              <circle cx="32" cy="32" r="9" stroke="currentColor" strokeWidth="1.2" opacity="0.45"/>
            </svg>
          </div>
          <div className="brand-name">
            NexusMD
            <BrandOrg/>
          </div>
        </div>

        <nav className="nav">
          <div className="nav-section">
            <div className="nav-section-label">Work</div>
            {NAV_PRIMARY.map(n => (
              <NavItem key={n.id} item={n} active={view===n.id} onClick={()=>navigate(n.id)} count={counts[n.id==='work'?'work':n.id]} changed={changeBadges[n.id] || 0}/>
            ))}
          </div>
          <div className="nav-section">
            <div className="nav-section-label">Manage</div>
            {NAV_SECONDARY.map(n => (
              <NavItem key={n.id} item={n} active={view===n.id} onClick={()=>navigate(n.id)} count={counts[n.id]}/>
            ))}
          </div>
        </nav>

        <ProfileMenu
          name={NexusMDData.ME?.name||'Loading…'}
          role="Eng Manager"
          tweaks={tweaks}
          setTweak={setTweak}
          onOpenSettings={()=>navigate('settings')}
          onOpenProjectAreas={()=>setProjectAreasOpen(true)}
        />
        {tweaks.sidebar !== 'icons' && (
          <div className="sidebar-resizer" onMouseDown={startResize} title="Drag to resize" />
        )}
      </aside>

      <TokenExpiryBanner/>

      {/* ── Main ── */}
      <div className="main">
        <div className="topbar">
          <span className="topbar-title">{currentNav.label}</span>
          <div className="search">
            <Icon name="search" size={14} className="search-icon"/>
            <input placeholder="Search work items, PRs, people…"/>
            <span className="kbd">⌘K</span>
          </div>
          <div className="top-actions">
            <span className="muted mono" style={{ fontSize: 11.5, marginRight: 4 }}>
              {autoRefreshPaused ? 'Paused' : `${autoRefreshLeft}s`}
            </span>
            <button className="btn icon ghost sm" title={autoRefreshPaused ? 'Resume auto-refresh' : 'Pause auto-refresh'}
              onClick={() => setAutoRefreshPaused(v => !v)}>
              <Icon name={autoRefreshPaused ? 'play' : 'pause'} size={14}/>
            </button>
            <button className="btn icon ghost sm" title="Toggle light/dark mode"
              onClick={()=>setTweak('theme', tweaks.theme==='light'?'dark':'light')}>
              <Icon name={tweaks.theme==='light'?'moon':'sun'} size={15}/>
            </button>
            <button className="btn icon ghost sm" title="Refresh data"
              onClick={()=>{ NexusMDApi?.load().catch(()=>{}); }}>
              <Icon name="refresh" size={15}/>
            </button>
            <div style={{width:1,height:18,background:'var(--border)',margin:'0 4px'}}/>
            <button className="btn sm primary" onClick={()=>{ setCreatePrefill(null); setCreateOpen(true); }}><Icon name="plus" size={13}/> New</button>
            <ProfileSwitcher/>
          </div>
        </div>

        {!dataLoaded ? <LoadingScreen/> :
         (!configured && view !== 'settings') ? (
           <div className="page">
             <SetupScreen onOpenSettings={()=>setSettingsOpen(true)}/>
           </div>
         ) : (
          <div className="page">
            <ErrorBoundary key={view}>
            {view==='dashboard' && (
              <DashboardView onOpenItem={openWI} onOpenPR={openPR}
                widgetOrder={tweaks.widgetOrder} setWidgetOrder={arr=>setTweak('widgetOrder',arr)}
                quickLinks={tweaks.quickLinks || DEFAULT_TWEAKS.quickLinks}
                density={tweaks.density} team={team} acknowledgedSet={acknowledgedSet} needsMeCriteria={needsMeCriteria}
                setPlannerData={setPlannerData}
                widgetWidths={tweaks.widgetWidths || {}} setWidgetWidths={ww=>setTweak('widgetWidths',ww)}
                widgetHeights={tweaks.widgetHeights || {}} setWidgetHeights={wh=>setTweak('widgetHeights',wh)}/>
            )}
            {view==='work' && (
              <WorkItemsView items={workItems} setItems={setWorkItems} onOpen={openWI} onCreate={()=>{ setCreatePrefill(null); setCreateOpen(true); }} team={team} newItemIds={newItemIds.work}/>
            )}
            {view==='pr' && (
              <PRView prs={prs} onOpen={openPR} needsMeCriteria={needsMeCriteria} setNeedsMeCriteria={setNeedsMeCriteria} newItemIds={newItemIds.pr}/>
            )}
            {view==='builds' && (
              <BuildsView builds={NexusMDData.BUILDS||[]} acknowledgedBuilds={acknowledgedBuilds} setAcknowledgedBuilds={setAcknowledgedBuilds} newItemIds={newItemIds.builds} onOpenBuild={b => setDrawer({ kind: 'build', data: b })}/>
            )}
            {view==='tests' && (
              <TestsView tests={NexusMDData.TESTS||[]} acknowledgedTests={acknowledgedTests} setAcknowledgedTests={setAcknowledgedTests} newItemIds={newItemIds.tests}/>
            )}
            {view==='calendar' && (
              <CalendarView
                calendarEvents={calendarEvents}
                onNavigatePlanner={navigateToPlanner}
                onUpdateEvent={updateCalendarEvent}
                onDeleteEvent={deleteCalendarEvent}
                onMoveEvent={moveCalendarEvent}
              />
            )}
            {view==='triage' && (
              <TriageView/>
            )}
            {view==='team' && (
              <TeamView team={team} workItems={workItems} prs={NexusMDData.PRS||[]}
                onOpenItem={openWI} onOpenPerson={openPerson} onTeamChange={setTeam}
                onAddNote={addTeamNote}
                onScheduleOneOnOne={scheduleOneOnOne}/>
            )}
            {view==='planner' && (
              <PlannerView data={plannerData} setData={setPlannerData} themes={themes} setThemes={setThemes} onExportDocx={plannerExportDocx}/>
            )}
            {view==='markdown' && <MarkdownViewer/>}
            {view==='settings' && (
              <SettingsView
                tweaks={tweaks}
                setTweak={setTweak}
                onOpenConnection={()=>setSettingsOpen(true)}
                onOpenProjectAreas={()=>setProjectAreasOpen(true)}
                onGoPlanner={()=>navigate('planner')}
              />
            )}
            </ErrorBoundary>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      <DetailDrawer drawer={drawer} onClose={()=>setDrawer(null)} setWorkItems={setWorkItems} team={team} plannerData={plannerData}
        patchFields={patchWorkItemFields} confidential={confidential} PRDetail={PRDetail}/>

      {/* Tweaks panel */}
      <TweaksPanel title="Display">
        <TweakSection title="Appearance">
          <TweakRadio label="Theme" value={tweaks.theme} onChange={v=>setTweak('theme',v)}
            options={[{label:'Light',value:'light'},{label:'Dark',value:'dark'}]}/>
          <TweakRadio label="Density" value={tweaks.density} onChange={v=>setTweak('density',v)}
            options={[{label:'Compact',value:'compact'},{label:'Balanced',value:'balanced'},{label:'Cozy',value:'cozy'}]}/>
          <TweakRadio label="Sidebar" value={tweaks.sidebar} onChange={v=>setTweak('sidebar',v)}
            options={[{label:'Labels',value:'labels'},{label:'Icons',value:'icons'}]}/>
          <TweakToggle label="Show type labels" value={tweaks.typeLabels||false} onChange={v=>setTweak('typeLabels',v)}/>
        </TweakSection>
        <TweakSection title="Dashboard">
          <div style={{fontSize:11.5,color:'var(--text-subtle)',padding:'4px 0 8px'}}>Drag to reorder widgets:</div>
          <WidgetOrderEditor order={tweaks.widgetOrder} onChange={arr=>setTweak('widgetOrder',arr)}/>
          <button className="btn sm ghost" onClick={()=>setTweak('widgetOrder',DEFAULT_TWEAKS.widgetOrder)}
            style={{marginTop:6,width:'100%'}}>Reset default order</button>
        </TweakSection>
        <TweakSection title="Connection">
          <TweakButton label="Open settings" onClick={()=>setSettingsOpen(true)}/>
        </TweakSection>
        <TweakSection title="Data">
          <TweakButton label="Export preferences" onClick={async () => {
            try {
              const r = await fetch('/api/prefs');
              if (!r.ok) { alert('Export failed.'); return; }
              const data = await r.json();
              await window.nexusMDDownload('nexusmd-prefs.json', JSON.stringify(data, null, 2));
            } catch { alert('Export failed.'); }
          }}/>
          <TweakButton label="Import preferences" secondary onClick={() => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = '.json,application/json';
            input.onchange = async (e) => {
              const file = e.target.files?.[0]; if (!file) return;
              try {
                const text = await file.text();
                const data = JSON.parse(text);
                const r = await fetch('/api/prefs', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(data),
                });
                if (!r.ok) { alert('Import failed.'); return; }
                window.location.reload();
              } catch { alert('Import failed — invalid file.'); }
            };
            input.click();
          }}/>
        </TweakSection>
      </TweaksPanel>

      {/* Settings modal */}
      <SettingsModal
        open={settingsOpen}
        onClose={()=>setSettingsOpen(false)}
        onSaved={handleSettingsSaved}
      />
      <ProjectAreasModal
        open={projectAreasOpen}
        onClose={()=>setProjectAreasOpen(false)}
        areas={projectAreas}
        setAreas={setProjectAreas}
      />
      <CreateWIModal
        open={createOpen}
        onClose={()=>setCreateOpen(false)}
        onCreated={handleSettingsSaved}
        onSubmit={createWorkItem}
        prefill={createPrefill}
        team={team}
      />
    </div>
  );
}

// ─── NavItem ──────────────────────────────────────────────────────────────────
function NavItem({ item, active, onClick, count, changed }) {
  const href = item.id === 'dashboard' ? '/' : '/' + item.id;
  return (
    <a href={href} className={`nav-item ${active?'active':''}`} onClick={e => { e.preventDefault(); onClick(); }} title={item.label}>
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
    </a>
  );
}

function PRDetail({ pr, onClose }) {
  const { TEAM, ME } = NexusMDData;
  const [tab, setTab] = useState('overview');
  const [comment, setComment] = useState('');
  const [voting, setVoting] = useState(false);
  const [commentStatus, setCommentStatus] = useState('');
  const [posting, setPosting] = useState(false);
  const [uatPushing, setUatPushing] = useState(false);
  const [uatStatus, setUatStatus] = useState('');

  const isActive = pr.status === 'active' && !pr.draft;
  const canVote  = isActive && pr.repoId && pr.project && ME?.adoId;

  const voteLabels = { 10:'Approved', 5:'Approved with suggestions', '-5':'Waiting for author', '-10':'Rejected', 0:'Reset vote' };
  const voteColors = { 10:'var(--success)', 5:'var(--info)', '-5':'var(--warning)', '-10':'var(--danger)', 0:'var(--text-muted)' };

  const vote = async (v) => {
    if (!canVote) return;
    if (!window.confirm(`Submit vote: "${voteLabels[String(v)]}" on PR #${pr.id}?`)) return;
    setVoting(true);
    try {
      const r = await fetch(`/api/pullrequests/${encodeURIComponent(pr.project)}/${pr.repoId}/${pr.id}/vote`, {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ vote: v, userId: ME.adoId }),
      });
      if (!r.ok) throw new Error(await r.text());
    } catch(e) { window.alert('Vote failed: ' + e.message); }
    finally { setVoting(false); }
  };

  const uatBranch = (NexusMDData.UAT_BRANCH || '').trim();

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
      const r = await fetch(
        `/api/pullrequests/${encodeURIComponent(pr.project)}/${pr.repoId}/promote-to-uat`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceBranch }) }
      );
      if (!r.ok) {
        const errText = await r.text();
        let msg = errText;
        try { msg = JSON.parse(errText)?.error || errText; } catch (_) {}
        setUatStatus('✗ ' + msg.slice(0, 120));
      } else {
        setUatStatus(`✓ UAT updated to ${sourceBranch}`);
        setTimeout(() => setUatStatus(''), 4000);
      }
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
      const r = await fetch(`/api/pullrequests/${encodeURIComponent(pr.project)}/${pr.repoId}/${pr.id}/threads`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ content: comment.trim() }),
      });
      if (!r.ok) throw new Error(await r.text());
      setComment(''); setCommentStatus('Posted!');
      setTimeout(() => setCommentStatus(''), 2000);
    } catch(e) { setCommentStatus('✗ ' + e.message.slice(0,60)); }
    finally { setPosting(false); }
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
          {(pr.threads||[]).length > 0 && (
            <div className="drawer-section">
              <h4>Comments ({pr.comments}{pr.unresolvedComments > 0 ? ` · ${pr.unresolvedComments} unresolved` : ''})</h4>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {(pr.threads||[]).map(t => {
                  const isOpen = t.status === 'active';
                  return (
                    <div key={t.id} style={{
                      padding:'8px 10px', background:'var(--surface-2)', borderRadius:6,
                      borderLeft:`3px solid ${isOpen ? 'var(--warning)' : 'var(--border)'}`,
                    }}>
                      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                        <span style={{
                          fontSize:10, padding:'1px 5px', borderRadius:3, fontWeight:600,
                          background: isOpen ? 'rgba(234,179,8,0.15)' : 'var(--success-soft)',
                          color: isOpen ? 'var(--warning)' : 'var(--success)',
                        }}>{isOpen ? 'Open' : t.status}</span>
                        {t.isCode && t.filePath
                          ? <span className="mono muted truncate" style={{fontSize:10.5,flex:1}}>{t.filePath}</span>
                          : <span className="muted" style={{fontSize:10.5}}>General</span>}
                        {t.commentCount > 1 && <span className="muted" style={{fontSize:10.5,flexShrink:0}}>{t.commentCount} replies</span>}
                      </div>
                      <div style={{fontSize:12.5,color:'var(--text)',marginBottom:3}}>{t.firstComment}</div>
                      <div className="muted" style={{fontSize:11}}>
                        {t.firstCommentBy}{t.firstCommentDate ? ` · ${timeAgo(t.firstCommentDate)}` : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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
              <textarea value={comment} onChange={e=>setComment(e.target.value)} rows={3} placeholder="Write a comment…"
                style={{...settInputStyle, resize:'vertical'}}/>
              <div style={{display:'flex',gap:8,alignItems:'center',marginTop:8}}>
                <button className="btn sm primary" onClick={postComment} disabled={posting||!comment.trim()}>
                  {posting?'Posting…':'Post comment'}
                </button>
                {commentStatus && <span style={{fontSize:12,color:commentStatus.startsWith('✗')?'var(--danger)':'var(--success)'}}>{commentStatus}</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'commits' && <PRCommitsTab pr={{ ...pr, org: NexusMDData.ORG }} http={adoHttp}/>}
      {tab === 'files'   && <PRFilesTab pr={{ ...pr, org: NexusMDData.ORG }} http={adoHttp}/>}
    </div>
  );
}

// ── AppRoot: profile gate wrapper so App never violates rules-of-hooks ───────
function AppRoot() {
  const { profiles, loading: profilesLoading } = useProfile();
  if (profilesLoading) {
    return <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--text-subtle)', fontSize: 14 }}>Loading…</div>;
  }
  if (!profiles || profiles.length === 0) {
    return <ProfileSetup onComplete={() => window.location.reload()} />;
  }
  return <App />;
}

// ── NexusMDApp: bootstrap (server prefs sync + profile migration) then mount ─
export default function NexusMDApp() {
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/prefs');
        if (r.ok) {
          const raw = await r.json();
          for (const [k, v] of Object.entries(raw)) {
            if (k === 'nexusmd.planner.confidential') {
              // Keep encrypted blob separate; don't overwrite the plaintext local config
              try { localStorage.setItem('nexusmd.planner.confidential.remote', v); } catch (_) {}
            } else {
              try { localStorage.setItem(k, v); } catch (_) {}
            }
          }
          // Refresh synchronous NexusMDData reads that already ran from localStorage
          NexusMDData.PLANNER_NOW = loadStoredPlanner();
          NexusMDData.THEMES      = loadStoredThemes();
        }
      } catch (_) {}
      await runProfileMigration();
      setBootstrapped(true);
    })();
  }, []);

  if (!bootstrapped) return null;

  return (
    <ProfileProvider>
      <AppRoot/>
      <ToastHost/>
    </ProfileProvider>
  );
}
