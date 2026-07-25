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
import { BuildDetail } from '@nexusmd/ui';
import './styles/nexusmd.css';
import './styles/nexusmd-planner-v2.css';

const adoTypeToNexusMD = adoTypeToHelm;

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

const DEFAULT_PROJECT_AREAS = [
  // ── DriveFurther.API ──────────────────────────────────────────────────────
  { id: 'api', name: 'DriveFurther.API', items: [], children: [
    { id: 'api-modules', name: 'Modules', items: [
      'Activities', 'Admin', 'Claims', 'Communication', 'Documents',
      'Finance', 'Integrations', 'Organisations', 'Policy', 'Products', 'Users', 'Vehicles',
    ], children: [] },
    { id: 'api-services', name: 'Services', items: [
      'BordereauReceipt', 'CreditLookup', 'DocumentProcessing', 'InsuredRisk',
      'Notification', 'PostcodeLookup', 'SagePay', 'SFTPService', 'SOA',
    ], children: [
      { id: 'api-svc-policy', name: 'PolicyManagement', items: ['Commissions'], children: [] },
      { id: 'api-svc-bdrx',   name: 'BordereauxImport',  items: ['PolicyImport', 'ClaimImport'], children: [] },
      { id: 'api-svc-client', name: 'Client',             items: ['FishInsurance'], children: [] },
      { id: 'api-svc-ext',    name: 'ExternalApi',        items: ['CAP', 'CreditSafe', 'DVLA', 'PremiumCredit', 'Sage'], children: [] },
      { id: 'api-svc-intg',   name: 'Integration',        items: ['BxIn'], children: [] },
      { id: 'api-svc-ms',     name: 'MSGraph',             items: ['Exchange', 'OneDrive'], children: [] },
      { id: 'api-svc-wf',     name: 'Workflow',            items: ['Feedback', 'Product'], children: [] },
      { id: 'api-svc-util',   name: 'Utility',             items: [
        'AgreementProcessor', 'FileStore', 'InboundEmailMatcher',
        'LeaseFinanceCalculator', 'ListExporter', 'TemplateProcessor',
      ], children: [] },
    ]},
    { id: 'api-infra', name: 'Infrastructure', items: [
      'Jobs (Hangfire background jobs)',
      'TimeRecorderService (SignalR activity timer)',
      'WindowsService',
    ], children: [] },
  ]},
  // ── DriveFurther.Nucleus ──────────────────────────────────────────────────
  { id: 'nucleus', name: 'DriveFurther.Nucleus', items: [], children: [
    { id: 'nucleus-modules', name: 'modules', items: [
      'vehicle-cap-valuations', 'temporary-vehicles',
      'group-inbox', 'group-calls', 'commission-statement',
      'user-activity', 'user-management',
      'puzzel (Puzzel telephony integration)', 'non-ate-cashbook',
    ], children: [
      { id: 'n-vehicles',   name: 'vehicles',           items: ['vehicle-detail', 'vehicle-dvla', 'vehicle-management'], children: [] },
      { id: 'n-v-leases',   name: 'vehicle-leases',     items: ['vehicle-lease-detail', 'vehicle-lease-financials', 'vehicle-lease-management'], children: [] },
      { id: 'n-v-invoices', name: 'vehicle-invoices',   items: ['lease-invoice-management'], children: [] },
      { id: 'n-v-costs',    name: 'vehicle-costs',      items: ['vehicle-cost-search'], children: [] },
      { id: 'n-v-mid',      name: 'vehicle-mid-entries',items: ['mid-search'], children: [] },
      { id: 'n-contacts',   name: 'contacts',           items: ['company-detail', 'company-region-list', 'contacts-detail'], children: [] },
      { id: 'n-tasks',      name: 'tasks',              items: ['task-status-summary'], children: [] },
      { id: 'n-products',   name: 'products',           items: ['product-detail', 'product-search'], children: [] },
    ]},
    { id: 'nucleus-config', name: 'configuration', items: [
      'scheme', 'coverage', 'activity-types', 'tax-rates', 'sectors',
      'parent-companies', 'policy-status-change-reasons', 'allegation-paragraphs',
      'claim-cost-types', 'vulnerability-types', 'database-audit', 'single-use-actions', 'resources',
    ], children: [
      { id: 'nc-divisions', name: 'divisions', items: ['division-details', 'division-variables'], children: [] },
      { id: 'nc-products',  name: 'products',  items: ['product-type-detail', 'product-category-detail', 'product-option-detail'], children: [] },
      { id: 'nc-docs',      name: 'documents', items: ['document-templates', 'document-types', 'document-pack-definitions', 'document-pack-types', 'email-template'], children: [] },
      { id: 'nc-users',     name: 'users',     items: ['user-list-page', 'user-permissions'], children: [] },
      { id: 'nc-time',      name: 'time',      items: ['time-provider', 'time-amendment-reasons'], children: [] },
      { id: 'nc-vehicles',  name: 'vehicles',  items: ['vehicle-manufacturers', 'vehicle-models', 'vehicle-variants', 'vehicle-colours'], children: [] },
    ]},
    { id: 'nucleus-shared', name: 'solution-shared', items: [
      'policies', 'policy-detail', 'case-activity', 'case-claim', 'claim-detail',
      'service-agreements', 'service-agreement-detail', 'service-agreement-fli-detail',
      'invoice', 'payment', 'note', 'rate-cards', 'non-ate-cashbook',
      'bordereaux-raw-values', 'feedback', 'contact-lookup', 'screen-pop', 'user-activity',
    ], children: [] },
  ]},
];

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
                <SettField label="Personal Access Token" hint="Stored server-side only. Needs WI/Code/Build read scopes.">
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

// ─── ProjectAreasModal ───────────────────────────────────────────────────────
// Tree helpers — operate on { id, name, items[], children[] } nodes
function _paMapCat(cats, id, fn) {
  return cats.map(c => {
    if (c.id === id) return fn(c);
    const ch = c.children || [];
    if (ch.length) return { ...c, children: _paMapCat(ch, id, fn) };
    return c;
  });
}
function _paRemoveCat(cats, id) {
  return cats
    .filter(c => c.id !== id)
    .map(c => { const ch = c.children || []; return ch.length ? { ...c, children: _paRemoveCat(ch, id) } : c; });
}
function _paFindCat(cats, id) {
  for (const c of cats) {
    if (c.id === id) return c;
    const found = _paFindCat(c.children || [], id);
    if (found) return found;
  }
  return null;
}
function _paGetPath(cats, id, acc = []) {
  for (const c of cats) {
    if (c.id === id) return [...acc, c.name];
    const found = _paGetPath(c.children || [], id, [...acc, c.name]);
    if (found) return found;
  }
  return null;
}
function _paCountAll(cats) {
  return cats.reduce((n, c) => n + (c.items || []).length + _paCountAll(c.children || []), 0);
}

function PACategoryTree({ cats, level = 0, selectedId, onSelect, expandedIds, toggleExpand }) {
  return cats.map(cat => {
    const children = cat.children || [];
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(cat.id);
    const isSelected = selectedId === cat.id;
    const indent = 10 + level * 14;
    return (
      <React.Fragment key={cat.id}>
        <div
          onClick={() => onSelect(cat.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            paddingLeft: indent, paddingRight: 10, paddingTop: 6, paddingBottom: 6,
            cursor: 'pointer', fontSize: level === 0 ? 13 : 12.5, fontWeight: level === 0 ? 600 : 500,
            background: isSelected ? 'var(--accent-soft)' : 'transparent',
            color: isSelected ? 'var(--accent)' : level === 0 ? 'var(--text)' : 'var(--text-muted)',
            borderRight: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
            transition: 'background .1s, color .1s',
          }}
          onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--surface-2)'; }}
          onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
        >
          <span
            style={{ width: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-subtle)' }}
            onClick={e => { if (hasChildren) { e.stopPropagation(); toggleExpand(cat.id); } }}
          >
            {hasChildren
              ? <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={11}/>
              : <span style={{ width: 11 }}/>}
          </span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat.name}</span>
          {(cat.items || []).length > 0 && (
            <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text-subtle)', flexShrink: 0 }}>
              {(cat.items || []).length}
            </span>
          )}
        </div>
        {hasChildren && isExpanded && (
          <PACategoryTree
            cats={children} level={level + 1}
            selectedId={selectedId} onSelect={onSelect}
            expandedIds={expandedIds} toggleExpand={toggleExpand}
          />
        )}
      </React.Fragment>
    );
  });
}

function ProjectAreasModal({ open, onClose, areas, setAreas }) {
  const [selectedId, setSelectedId] = useState(null);
  const [expandedIds, setExpandedIds] = useState(() => new Set());

  // Auto-select + auto-expand root nodes on open
  useEffect(() => {
    if (open && areas.length > 0) {
      setSelectedId(s => s || areas[0].id);
      setExpandedIds(prev => {
        if (prev.size > 0) return prev;
        const s = new Set();
        areas.forEach(c => s.add(c.id));
        return s;
      });
    }
  }, [open]);

  if (!open) return null;

  const selected = _paFindCat(areas, selectedId) || areas[0] || null;
  const selectedPath = selected ? (_paGetPath(areas, selected.id) || []) : [];

  const toggleExpand = id => setExpandedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const updateCategoryName = (id, name) => setAreas(prev => _paMapCat(prev, id, c => ({ ...c, name })));

  const deleteCategory = (id) => {
    setAreas(prev => {
      const next = _paRemoveCat(prev, id);
      if (selectedId === id) setSelectedId(next[0]?.id || null);
      return next;
    });
  };

  const addRootCategory = () => {
    const id = 'cat-' + Date.now();
    setAreas(prev => [...prev, { id, name: 'New category', items: [], children: [] }]);
    setSelectedId(id);
  };

  const addChildCategory = (parentId) => {
    const id = 'cat-' + Date.now();
    setAreas(prev => _paMapCat(prev, parentId, c => ({
      ...c, children: [...(c.children || []), { id, name: 'New sub-category', items: [], children: [] }],
    })));
    setExpandedIds(prev => { const s = new Set(prev); s.add(parentId); return s; });
    setSelectedId(id);
  };

  const updateItem = (catId, idx, value) =>
    setAreas(prev => _paMapCat(prev, catId, c => ({ ...c, items: (c.items || []).map((it, i) => i === idx ? value : it) })));

  const deleteItem = (catId, idx) =>
    setAreas(prev => _paMapCat(prev, catId, c => ({ ...c, items: (c.items || []).filter((_, i) => i !== idx) })));

  const addItem = (catId) => {
    setAreas(prev => _paMapCat(prev, catId, c => ({ ...c, items: [...(c.items || []), ''] })));
    setTimeout(() => {
      const inputs = document.querySelectorAll('.proj-area-item-input');
      inputs[inputs.length - 1]?.focus();
    }, 30);
  };

  const totalItems = _paCountAll(areas);

  return (
    <div id="modal-project-areas" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16,
        boxShadow: 'var(--shadow-pop)', width: 800, maxWidth: '100%',
        height: 'min(88vh, 700px)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 24px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', flex: 1 }}>Project Areas</h2>
          <button className="btn sm ghost" onClick={addRootCategory}><Icon name="plus" size={12}/> Add category</button>
          <button className="btn icon ghost sm" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>

        {/* Two-panel body */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

          {/* Left: category tree */}
          <div style={{ width: 240, flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '8px 0' }}>
            <PACategoryTree
              cats={areas} level={0}
              selectedId={selectedId} onSelect={setSelectedId}
              expandedIds={expandedIds} toggleExpand={toggleExpand}
            />
          </div>

          {/* Right: items for selected node */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {selected ? (
              <>
                {/* Breadcrumb + name editor */}
                <div style={{ padding: '12px 20px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                  {selectedPath.length > 1 && (
                    <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 4, fontFamily: 'var(--mono)' }}>
                      {selectedPath.slice(0, -1).join(' / ')}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      value={selected.name}
                      onChange={e => updateCategoryName(selected.id, e.target.value)}
                      style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 15, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--sans)' }}
                      placeholder="Category name"
                    />
                    <button className="btn sm ghost" onClick={() => addChildCategory(selected.id)} title="Add a nested sub-category inside this one">
                      <Icon name="plus" size={12}/> Sub-category
                    </button>
                    <button className="btn sm ghost" style={{ color: 'var(--danger)' }} onClick={() => deleteCategory(selected.id)} title="Delete">
                      <Icon name="trash" size={13}/>
                    </button>
                  </div>
                </div>

                {/* Items list */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '10px 20px' }}>
                  {(selected.children || []).length > 0 && (selected.items || []).length === 0 && (
                    <div style={{ color: 'var(--text-subtle)', fontSize: 12.5, padding: '8px 0 12px', fontStyle: 'italic' }}>
                      This category has {selected.children.length} sub-categor{selected.children.length === 1 ? 'y' : 'ies'}. Add items here or use the sub-categories.
                    </div>
                  )}
                  {(selected.items || []).length === 0 && (selected.children || []).length === 0 && (
                    <div style={{ color: 'var(--text-subtle)', fontSize: 13, padding: '12px 0' }}>No areas yet — add one below.</div>
                  )}
                  {(selected.items || []).map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--border-strong)', flexShrink: 0 }}/>
                      <input
                        className="proj-area-item-input"
                        value={item}
                        onChange={e => updateItem(selected.id, idx, e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); addItem(selected.id); }
                          if (e.key === 'Backspace' && !item) { e.preventDefault(); deleteItem(selected.id, idx); }
                        }}
                        style={{ flex: 1, border: '1px solid transparent', background: 'transparent', outline: 'none', fontSize: 13, color: 'var(--text)', fontFamily: 'var(--sans)', padding: '4px 6px', borderRadius: 5 }}
                        onFocus={e => e.target.style.borderColor = 'var(--border)'}
                        onBlur={e => e.target.style.borderColor = 'transparent'}
                      />
                      <button className="btn icon ghost sm" style={{ opacity: 0, color: 'var(--danger)', flexShrink: 0 }}
                        onClick={() => deleteItem(selected.id, idx)}
                        onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                        onMouseLeave={e => e.currentTarget.style.opacity = '0'}
                        title="Remove"><Icon name="x" size={12}/></button>
                    </div>
                  ))}
                </div>

                {/* Add item */}
                <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
                  <button className="btn sm ghost" onClick={() => addItem(selected.id)}>
                    <Icon name="plus" size={12}/> Add area
                  </button>
                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
                Select a category or add one.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
            {areas.length} root categories · {totalItems} areas total · Enter to add, Backspace on empty to remove
          </span>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ─── TagInput ─────────────────────────────────────────────────────────────────
// value: semicolon-separated string  onChange(newString)
function TagInput({ value, onChange, style }) {
  const selected = (value || '').split(';').map(t => t.trim()).filter(Boolean);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  const knownTags = useMemo(() => {
    const s = new Set();
    (NexusMDData.WORK_ITEMS || []).forEach(wi => {
      const raw = wi.fields?.['System.Tags'] || wi.tags || '';
      const parts = Array.isArray(raw) ? raw : String(raw).split(';');
      parts.forEach(t => { const tr = t.trim(); if (tr) s.add(tr); });
    });
    return [...s].sort((a, b) => a.localeCompare(b));
  }, []);

  const filtered = knownTags.filter(t =>
    !selected.includes(t) && (!query || t.toLowerCase().includes(query.toLowerCase()))
  );
  const canCreate = query.trim() && !knownTags.some(t => t.toLowerCase() === query.trim().toLowerCase()) && !selected.includes(query.trim());

  const add = (tag) => {
    const tr = tag.trim();
    if (!tr || selected.includes(tr)) return;
    onChange([...selected, tr].join('; '));
    setQuery('');
    inputRef.current?.focus();
  };

  const remove = (tag) => {
    onChange(selected.filter(t => t !== tag).join('; '));
  };

  const onKeyDown = (e) => {
    if ((e.key === 'Enter' || e.key === ',') && query.trim()) {
      e.preventDefault();
      add(query.trim());
      setOpen(false);
    } else if (e.key === 'Backspace' && !query && selected.length) {
      remove(selected[selected.length - 1]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  useEffect(() => {
    const handler = (e) => { if (!containerRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const baseStyle = {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4,
    minHeight: 32, padding: '3px 8px', cursor: 'text',
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
    ...(style || {}),
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div style={baseStyle} onClick={() => { setOpen(true); inputRef.current?.focus(); }}>
        {selected.map(t => (
          <span key={t} style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            background: 'var(--accent-soft, rgba(99,102,241,0.12))', color: 'var(--accent, #6366f1)',
            borderRadius: 5, padding: '1px 6px', fontSize: 11.5, fontWeight: 500, lineHeight: '18px',
          }}>
            {t}
            <span onMouseDown={e => { e.stopPropagation(); e.preventDefault(); remove(t); }}
              style={{ cursor: 'pointer', opacity: 0.6, fontSize: 13, lineHeight: 1 }}>×</span>
          </span>
        ))}
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={selected.length ? '' : 'Add tags…'}
          style={{
            border: 'none', outline: 'none', background: 'transparent',
            color: 'var(--text)', fontSize: 12.5, fontFamily: 'var(--sans)',
            flex: '1 1 80px', minWidth: 80, height: 24, padding: 0,
          }}
        />
      </div>
      {open && (filtered.length > 0 || canCreate) && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300, marginTop: 2,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
          boxShadow: 'var(--shadow-pop)', maxHeight: 180, overflowY: 'auto',
        }}>
          {filtered.map(t => (
            <div key={t} onMouseDown={e => { e.preventDefault(); add(t); setOpen(false); }}
              style={{ padding: '6px 12px', fontSize: 12.5, cursor: 'pointer', color: 'var(--text)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--hover)'}
              onMouseLeave={e => e.currentTarget.style.background = ''}>
              {t}
            </div>
          ))}
          {canCreate && (
            <div onMouseDown={e => { e.preventDefault(); add(query.trim()); setOpen(false); }}
              style={{ padding: '6px 12px', fontSize: 12.5, cursor: 'pointer', color: 'var(--accent, #6366f1)', borderTop: filtered.length ? '1px solid var(--border)' : 'none' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--hover)'}
              onMouseLeave={e => e.currentTarget.style.background = ''}>
              + Create "{query.trim()}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CreateWIModal({ open, onClose, onCreated, prefill, team: teamProp }) {
  const [project,             setProject]             = useState('');
  const [type,                setType]                = useState('Task');
  const [title,               setTitle]               = useState('');
  const [assignee,            setAssignee]            = useState('');
  const [state,               setState]               = useState('');
  const [priority,            setPriority]            = useState('');
  const [tags,                setTags]                = useState('');
  const [description,         setDescription]         = useState('');
  const [acceptanceCriteria,  setAcceptanceCriteria]  = useState('');
  const [reproSteps,          setReproSteps]          = useState('');
  const [systemInfo,          setSystemInfo]          = useState('');
  const [storyPoints,         setStoryPoints]         = useState('');
  const [remainingWork,       setRemainingWork]       = useState('');
  const [activity,            setActivity]            = useState('');
  const [status,              setStatus]              = useState('');
  const [saving,              setSaving]              = useState(false);

  const team     = teamProp || NexusMDData.TEAM || [];
  const STATES   = NexusMDData.STATES || [];
  const projects = ((NexusMDData.CONFIG_PROJECTS || []).length
    ? NexusMDData.CONFIG_PROJECTS.map(p => ({ id: p, name: p }))
    : (NexusMDData.PROJECTS || []).map(p => ({ id: p.id, name: p.name }))
  );

  const isBug      = type === 'Bug';
  const isTask     = type === 'Task';
  const isStory    = type === 'User Story';
  const isFeature  = type === 'Feature';
  const showAC     = isStory || isFeature;
  const nexusMDType   = adoTypeToNexusMD(type);
  const hasNumeric = isTask || isStory;

  const resetFields = () => {
    setTitle(''); setAssignee(''); setState(''); setPriority(''); setTags('');
    setDescription(''); setAcceptanceCriteria(''); setReproSteps('');
    setSystemInfo(''); setStoryPoints(''); setRemainingWork(''); setActivity('');
    setStatus(''); setSaving(false);
  };

  useEffect(() => {
    if (!open) return;
    setProject(projects[0]?.name || '');
    setType('Task');
    resetFields();
  }, [open]);

  useEffect(() => {
    if (!open || !prefill) return;
    if (prefill.project)     setProject(prefill.project);
    if (prefill.type)        setType(prefill.type);
    if (prefill.title)       setTitle(prefill.title);
    if (prefill.description) setDescription(prefill.description);
    if (prefill.tags)        setTags(prefill.tags);
  }, [open, prefill]);

  const submit = async () => {
    if (!title.trim())   { setStatus('Title is required.');   return; }
    if (!project.trim()) { setStatus('Project is required.'); return; }
    setSaving(true); setStatus('Creating…');
    try {
      const fields = { 'System.Title': title.trim() };
      if (assignee)                  fields['System.AssignedTo']                          = assignee;
      if (state)                     fields['System.State']                               = state;
      if (priority)                  fields['Microsoft.VSTS.Common.Priority']             = parseInt(priority, 10);
      if (tags.trim())               fields['System.Tags']                                = tags.trim();
      if (description.trim())        fields['System.Description']                         = description.trim();
      if (acceptanceCriteria.trim()) fields['Microsoft.VSTS.Common.AcceptanceCriteria']   = acceptanceCriteria.trim();
      if (reproSteps.trim())         fields['Microsoft.VSTS.TCM.ReproSteps']              = reproSteps.trim();
      if (systemInfo.trim())         fields['Microsoft.VSTS.TCM.SystemInfo']              = systemInfo.trim();
      if (storyPoints)               fields['Microsoft.VSTS.Scheduling.StoryPoints']      = parseFloat(storyPoints);
      if (remainingWork)             fields['Microsoft.VSTS.Scheduling.RemainingWork']    = parseFloat(remainingWork);
      if (activity)                  fields['Microsoft.VSTS.Common.Activity']             = activity;
      const r = await fetch('/api/workitems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: project.trim(), type, fields }),
      });
      if (!r.ok) { setStatus('Error: ' + (await r.text()).slice(0, 160)); return; }
      setStatus('Created.');
      onCreated?.();
      setTimeout(onClose, 600);
    } catch (e) {
      setStatus('Error: ' + e.message);
    } finally { setSaving(false); }
  };

  if (!open) return null;
  return (
    <div id="modal-create-workitem" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16,
        boxShadow: 'var(--shadow-pop)', width: 580, maxWidth: '100%',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 24px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <TypeIcon type={nexusMDType}/>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, flex: 1 }}>New {type}</h2>
          <button className="btn icon ghost sm" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Project + Type */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <SettField label="Project">
              <select value={project} onChange={e => setProject(e.target.value)} style={settInputStyle}>
                {projects.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
            </SettField>
            <SettField label="Type">
              <select value={type} onChange={e => setType(e.target.value)} style={settInputStyle}>
                {['Bug', 'Task', 'User Story', 'Feature', 'Epic'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </SettField>
          </div>

          {/* Title */}
          <SettField label="Title">
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder={`Short, descriptive ${type.toLowerCase()} title…`}
              style={settInputStyle} autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) submit(); }} />
          </SettField>

          {/* Assignee + State */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <SettField label="Assigned To">
              <select value={assignee} onChange={e => setAssignee(e.target.value)} style={settInputStyle}>
                <option value="">Unassigned</option>
                {team.map(t => <option key={t.id} value={t.name || t.displayName}>{t.name || t.displayName}</option>)}
              </select>
            </SettField>
            <SettField label="State">
              {STATES.length > 0 ? (
                <select value={state} onChange={e => setState(e.target.value)} style={settInputStyle}>
                  <option value="">Default</option>
                  {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <input value={state} onChange={e => setState(e.target.value)} placeholder="Default" style={settInputStyle} />
              )}
            </SettField>
          </div>

          {/* Priority + Tags + numeric (Story Points / Remaining Work) */}
          <div style={{ display: 'grid', gridTemplateColumns: hasNumeric ? '1fr 1fr 1fr' : '1fr 1fr', gap: 10 }}>
            <SettField label="Priority">
              <select value={priority} onChange={e => setPriority(e.target.value)} style={settInputStyle}>
                <option value="">None</option>
                <option value="1">1 – Critical</option>
                <option value="2">2 – High</option>
                <option value="3">3 – Medium</option>
                <option value="4">4 – Low</option>
              </select>
            </SettField>
            <SettField label="Tags">
              <TagInput value={tags} onChange={setTags} style={settInputStyle} />
            </SettField>
            {isStory && (
              <SettField label="Story Points">
                <input type="number" min="0" step="0.5" value={storyPoints}
                  onChange={e => setStoryPoints(e.target.value)} placeholder="—" style={settInputStyle} />
              </SettField>
            )}
            {isTask && (
              <SettField label="Remaining Work (h)">
                <input type="number" min="0" step="0.5" value={remainingWork}
                  onChange={e => setRemainingWork(e.target.value)} placeholder="—" style={settInputStyle} />
              </SettField>
            )}
          </div>

          {/* Activity — Task only */}
          {isTask && (
            <SettField label="Activity">
              <select value={activity} onChange={e => setActivity(e.target.value)} style={settInputStyle}>
                <option value="">None</option>
                {['Development', 'Testing', 'Requirements', 'Documentation', 'Deployment', 'Design'].map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </SettField>
          )}

          {/* ── Divider before content fields ── */}
          <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />

          {/* Description — all types */}
          <SettField label="Description">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              style={{ ...settInputStyle, resize: 'vertical', paddingTop: 8, paddingBottom: 8 }} />
          </SettField>

          {/* Acceptance Criteria — User Story / Feature */}
          {showAC && (
            <SettField label="Acceptance Criteria" hint="Given… When… Then…">
              <textarea value={acceptanceCriteria} onChange={e => setAcceptanceCriteria(e.target.value)} rows={4}
                style={{ ...settInputStyle, resize: 'vertical', paddingTop: 8, paddingBottom: 8 }} />
            </SettField>
          )}

          {/* Repro Steps — Bug */}
          {isBug && (
            <SettField label="Repro Steps">
              <textarea value={reproSteps} onChange={e => setReproSteps(e.target.value)} rows={4}
                placeholder={'1. Open…\n2. Click…\n3. Observe…'}
                style={{ ...settInputStyle, resize: 'vertical', paddingTop: 8, paddingBottom: 8 }} />
            </SettField>
          )}

          {/* System Info — Bug */}
          {isBug && (
            <SettField label="System Info" hint="Browser, OS, app version, environment">
              <textarea value={systemInfo} onChange={e => setSystemInfo(e.target.value)} rows={2}
                style={{ ...settInputStyle, resize: 'vertical', paddingTop: 8, paddingBottom: 8 }} />
            </SettField>
          )}

        </div>

        {/* ── Footer ── */}
        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {status && <div className="muted" style={{ fontSize: 12.5 }}>{status}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={submit} disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
          </div>
        </div>

      </div>
    </div>
  );
}

const settInputStyle = {
  width: '100%', padding: '8px 12px',
  border: '1px solid var(--border)', borderRadius: 6,
  background: 'var(--surface-2)', outline: 'none', fontSize: 13, boxSizing: 'border-box',
};

function SettField({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)' }}>{label}</label>
      {children}
      {hint && <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{hint}</span>}
    </div>
  );
}

// ─── AreaTreePicker ───────────────────────────────────────────────────────────
// Multi-select tree picker. value is a semicolon-separated string of paths.
function AreaTreePicker({ value, onChange, compact = false }) {
  const selected = React.useMemo(
    () => new Set((value || '').split(';').map(s => s.trim()).filter(Boolean)),
    [value]
  );

  const [open, setOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState(() => {
    const s = new Set();
    (NexusMDData.PROJECT_AREAS || []).forEach(n => s.add(n.id));
    return s;
  });
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggleExpand = (e, id) => {
    e.stopPropagation(); e.preventDefault();
    setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };

  const togglePath = (path) => {
    const next = new Set(selected);
    next.has(path) ? next.delete(path) : next.add(path);
    onChange([...next].join('; '));
  };

  const removePath = (path) => {
    const next = new Set(selected);
    next.delete(path);
    onChange([...next].join('; '));
  };

  const renderNodes = (nodes, prefix) => nodes.map(n => {
    const path = prefix ? `${prefix}\\${n.name}` : n.name;
    const children = n.children || [];
    const items    = n.items    || [];
    const hasContent = children.length > 0 || items.length > 0;
    const isExpanded = expanded.has(n.id);
    const isSelected = selected.has(path);
    const depth = prefix ? prefix.split('\\').length : 0;

    return (
      <React.Fragment key={n.id}>
        <button
          onMouseDown={e => { e.preventDefault(); togglePath(path); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, width: '100%',
            textAlign: 'left', border: 'none', borderRadius: 6,
            background: isSelected ? 'var(--accent-soft)' : 'transparent',
            color: isSelected ? 'var(--accent)' : depth === 0 ? 'var(--text)' : 'var(--text-muted)',
            fontWeight: depth === 0 ? 600 : 500,
            padding: `5px 8px 5px ${8 + depth * 14}px`,
            cursor: 'pointer', fontSize: 12.5, fontFamily: 'var(--sans)',
          }}
          onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--surface-2)'; }}
          onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = isSelected ? 'var(--accent-soft)' : 'transparent'; }}
        >
          <span
            style={{ width: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-subtle)' }}
            onMouseDown={e => hasContent && toggleExpand(e, n.id)}
          >
            {hasContent ? <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={10}/> : null}
          </span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>
          {isSelected && <Icon name="check" size={10} style={{ color: 'var(--accent)', flexShrink: 0 }}/>}
        </button>
        {hasContent && isExpanded && (
          <React.Fragment>
            {renderNodes(children, path)}
            {items.map((item, i) => {
              const itemPath = `${path}\\${item}`;
              const itemSel  = selected.has(itemPath);
              const itemDepth = depth + 1;
              return (
                <button key={i}
                  onMouseDown={e => { e.preventDefault(); togglePath(itemPath); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4, width: '100%',
                    textAlign: 'left', border: 'none', borderRadius: 6,
                    background: itemSel ? 'var(--accent-soft)' : 'transparent',
                    color: itemSel ? 'var(--accent)' : 'var(--text-muted)',
                    fontWeight: 400,
                    padding: `4px 8px 4px ${8 + itemDepth * 14}px`,
                    cursor: 'pointer', fontSize: 12, fontFamily: 'var(--sans)',
                  }}
                  onMouseEnter={e => { if (!itemSel) e.currentTarget.style.background = 'var(--surface-2)'; }}
                  onMouseLeave={e => { if (!itemSel) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ width: 14, flexShrink: 0 }}/>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item}</span>
                  {itemSel && <Icon name="check" size={10} style={{ color: 'var(--accent)', flexShrink: 0 }}/>}
                </button>
              );
            })}
          </React.Fragment>
        )}
      </React.Fragment>
    );
  });

  const areas = NexusMDData.PROJECT_AREAS || [];
  const selectedArr = [...selected];

  const triggerBase = compact ? {
    background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6,
    padding: '3px 6px', fontFamily: 'var(--sans)', cursor: 'pointer',
    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4,
    width: '100%', boxSizing: 'border-box', minHeight: 28, textAlign: 'left',
  } : {
    ...settInputStyle, display: 'flex', alignItems: 'center', flexWrap: 'wrap',
    gap: 4, cursor: 'pointer', minHeight: 36,
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div onClick={() => setOpen(v => !v)} style={triggerBase}>
        {selectedArr.length > 0
          ? selectedArr.map(path => {
              const label = path.split('\\').pop();
              return (
                <span key={path} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  background: 'var(--accent-soft)', color: 'var(--accent)',
                  borderRadius: 5, padding: '1px 6px', fontSize: 11.5, fontWeight: 500, lineHeight: '18px',
                }}>
                  {label}
                  <span
                    onMouseDown={e => { e.stopPropagation(); e.preventDefault(); removePath(path); }}
                    style={{ cursor: 'pointer', opacity: 0.6, fontSize: 13, lineHeight: 1 }}
                  >×</span>
                </span>
              );
            })
          : <span style={{ fontSize: 13, color: 'var(--text-subtle)', flex: 1 }}>— None —</span>
        }
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={11} style={{ marginLeft: 'auto', flexShrink: 0, color: 'var(--text-subtle)' }}/>
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, minWidth: 260,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: 'var(--shadow-pop)',
          maxHeight: 280, overflowY: 'auto', padding: 4, zIndex: 300,
        }}>
          {selectedArr.length > 0 && (
            <button
              onMouseDown={e => { e.preventDefault(); onChange(''); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, width: '100%', border: 'none', borderRadius: 6,
                background: 'transparent', color: 'var(--danger)',
                padding: '5px 8px', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--sans)', marginBottom: 2,
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--danger-soft)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ width: 14 }}/>
              Clear all
            </button>
          )}
          {renderNodes(areas, '')}
        </div>
      )}
    </div>
  );
}

// ─── Setup screen (not yet configured) ───────────────────────────────────────
function SetupScreen({ onOpenSettings }) {
  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
      gap: 16, color: 'var(--text-muted)',
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: 14, background: 'var(--surface-2)',
        border: '1px solid var(--border)', display: 'grid', placeItems: 'center', fontSize: 26,
      }}>🔌</div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
          Connect to Azure DevOps
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-subtle)', maxWidth: 360 }}>
          Enter your organisation name, a Personal Access Token, and project names to get started.
        </div>
      </div>
      <button className="btn primary" onClick={onOpenSettings}>
        <Icon name="settings" size={14}/> Configure connection
      </button>
    </div>
  );
}

// ─── Loading screen ───────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
      gap: 14, color: 'var(--text-subtle)',
    }}>
      <div style={{ fontSize: 13 }}>Loading data from Azure DevOps…</div>
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
      <DetailDrawer drawer={drawer} onClose={()=>setDrawer(null)} setWorkItems={setWorkItems} team={team} plannerData={plannerData}/>

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
        prefill={createPrefill}
        team={team}
      />
    </div>
  );
}

// ─── ProfileMenu ─────────────────────────────────────────────────────────────
function ProfileMenuItem({ icon, label, onClick, meta }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 12px', borderRadius: 7, width: '100%',
        background: 'transparent', border: 0, cursor: 'pointer',
        color: 'var(--text)', fontSize: 13, textAlign: 'left',
        fontFamily: 'var(--sans)',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <span style={{ color: 'var(--text-subtle)', display: 'grid', placeItems: 'center', width: 18, flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {meta && <span style={{ fontSize: 11, color: 'var(--text-subtle)', fontFamily: 'var(--mono)' }}>{meta}</span>}
    </button>
  );
}

function ProfileMenu({ name, role, tweaks, setTweak, onOpenSettings, onOpenProjectAreas }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const isDark = tweaks.theme === 'dark';
  const initials = (name || '?').split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {open && (
        <div style={{
          position: 'absolute',
          bottom: 'calc(100% + 6px)',
          left: 6,
          width: 'max(calc(100% - 12px), 200px)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-pop)',
          zIndex: 200,
          overflow: 'hidden',
        }}>
          {/* Profile header */}
          <div style={{
            padding: '14px 14px 12px',
            background: 'var(--surface-2)',
            borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{
              width: 38, height: 38, borderRadius: '50%',
              background: 'var(--accent)', color: 'var(--accent-fg)',
              display: 'grid', placeItems: 'center',
              fontWeight: 700, fontSize: 14, flexShrink: 0, letterSpacing: 0,
            }}>
              {initials}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text)' }}>{name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 1 }}>{role}</div>
            </div>
          </div>

          <div style={{ padding: 4 }}>
            <ProfileMenuItem
              icon={<Icon name={isDark ? 'sun' : 'moon'} size={14}/>}
              label={isDark ? 'Light mode' : 'Dark mode'}
              onClick={() => setTweak('theme', isDark ? 'light' : 'dark')}
            />
            <ProfileMenuItem
              icon={<Icon name="list" size={14}/>}
              label="Project Areas"
              onClick={() => { setOpen(false); onOpenProjectAreas(); }}
            />
            <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }}/>
            <ProfileMenuItem
              icon={<Icon name="settings" size={14}/>}
              label="Settings"
              onClick={() => { setOpen(false); onOpenSettings(); }}
            />
          </div>
        </div>
      )}

      <div
        className={`sidebar-foot profile-trigger${open ? ' profile-trigger--open' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="Profile & settings"
      >
        <Avatar who="me"/>
        <div className="user-meta">
          <div className="user-name">{name}</div>
          <div className="user-role">{role}</div>
        </div>
        <span className="profile-trigger-caret">
          <Icon name="chevron-up" size={13}/>
        </span>
      </div>
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

// ─── WidgetOrderEditor ────────────────────────────────────────────────────────
function WidgetOrderEditor({ order, onChange }) {
  const labels = { sprint:'Sprint progress', review:'Needs your review', blockers:'Blockers & risks', team:'Team — working on now', triage:'Triage queue', activity:'Recent activity', resolvedme:'Resolved by me' };
  const [drag, setDrag] = useState(null);
  return (
    <div style={{display:'flex',flexDirection:'column',gap:4}}>
      {order.map((id,i)=>(
        <div key={id} draggable
          onDragStart={()=>setDrag(id)} onDragOver={e=>e.preventDefault()}
          onDrop={e=>{e.preventDefault();if(!drag||drag===id)return;const arr=order.slice();const fi=arr.indexOf(drag),ti=arr.indexOf(id);arr.splice(fi,1);arr.splice(ti,0,drag);onChange(arr);setDrag(null);}}
          style={{display:'flex',alignItems:'center',gap:8,padding:'6px 8px',background:'var(--surface-2)',border:'1px solid var(--border)',borderRadius:6,fontSize:12,cursor:'grab',opacity:drag===id?0.4:1}}>
          <Icon name="grip" size={12} style={{color:'var(--text-subtle)'}}/>
          <span style={{flex:1}}>{labels[id]||id}</span>
          <span className="muted mono" style={{fontSize:10}}>{i+1}</span>
        </div>
      ))}
    </div>
  );
}

// ─── DetailDrawer ─────────────────────────────────────────────────────────────
function DetailDrawer({ drawer, onClose, setWorkItems, team: teamProp, plannerData }) {
  const open = drawer!=null;
  const kind = drawer?.kind;
  const d    = drawer?.data;
  const TEAM = teamProp || NexusMDData.TEAM || [];

  const title = !d?'': kind==='wi'?d.title: kind==='pr'?d.title: kind==='person'?d.name: kind==='build'?`${d.pipeline} #${d.id}`:'';

  return (
    <Drawer open={open} onClose={onClose} title={title}
      badges={d&&kind==='wi'?(
        <span style={{display:'inline-flex',alignItems:'center',gap:6}}>
          {NexusMDData.ORG && d.project
            ? <a href={`https://dev.azure.com/${encodeURIComponent(NexusMDData.ORG)}/${encodeURIComponent(d.project.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase()))}/_workitems/edit/${d.id}`}
                 target="_blank" rel="noopener"
                 className="mono muted" style={{fontSize:11.5,color:'var(--accent)',textDecoration:'none'}}>#{d.id}</a>
            : <span className="mono muted" style={{fontSize:11.5}}>#{d.id}</span>}
          <TypeIcon type={d.type}/><Prio p={d.priority}/>
        </span>
      ):d&&kind==='pr'?(
        <span style={{display:'inline-flex',alignItems:'center',gap:6}}>
          <span className="mono muted" style={{fontSize:11.5}}>#{d.id}</span>
          {d.draft&&<span className="pill" style={{fontSize:10}}>DRAFT</span>}
        </span>
      ):null}
      actions={d&&kind==='wi'?(
        <button className="btn sm ghost" onClick={()=>{setWorkItems(arr=>arr.map(w=>w.id===d.id?{...w,state:'Done'}:w));onClose();}}>
          <Icon name="check" size={13}/> Mark done
        </button>
      ):null}>
      {kind==='wi'&&d&&<WIDetail item={d} setWorkItems={setWorkItems} team={TEAM}/>}
      {kind==='pr'&&d&&<PRDetail pr={d} onClose={onClose}/>}
      {kind==='person'&&d&&<PersonDetail dev={d} plannerData={plannerData}/>}
      {kind==='build'&&d&&<BuildDetail build={d}/>}
    </Drawer>
  );
}

function WIDetail({ item, setWorkItems, team: teamProp }) {
  const { STATES } = NexusMDData;
  const TEAM = teamProp || NexusMDData.TEAM || [];

  // Local copy for optimistic updates — resets only when a different item is opened
  const [local, setLocal] = useState(item);
  useEffect(() => { setLocal(item); }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const org = NexusMDData.ORG || '';
  const adoWIUrl = org && item.project
    ? `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(item.project.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase()))}/_workitems/edit/${item.id}`
    : null;

  const nexusMDStateMap = { 'Active':'In Progress','New':'To Do','Resolved':'Done','Closed':'Done' };

  const patch = async (fieldOps, localPatch) => {
    const prev = local;
    setLocal(l => ({ ...l, ...localPatch }));
    try {
      const r = await fetch(`/api/workitems/${item.id}`, {
        method:'PATCH', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(fieldOps.map(([path, value]) => ({ op:'add', path, value }))),
      });
      if (!r.ok) throw new Error((await r.text()).slice(0, 120));
      setWorkItems?.(arr => arr.map(w => w.id===item.id ? { ...w, ...localPatch } : w));
      toast?.('Saved', 'success');
    } catch(e) {
      setLocal(prev);
      toast?.('✗ ' + e.message, 'error');
    }
  };

  const assignee = TEAM.find(t => t.id === local.assignee);

  // Inline select style — transparent until interacted with
  const sel = {
    background:'transparent', border:'1px solid transparent', borderRadius:5,
    padding:'1px 18px 1px 3px', fontSize:13, color:'var(--text)',
    cursor:'pointer', appearance:'none',
    backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%238a857d' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
    backgroundRepeat:'no-repeat', backgroundPosition:'right 3px center',
    outline:'none', fontFamily:'var(--sans)', maxWidth:'100%',
  };

  return (
    <div>
      <div className="drawer-section">
        <div style={{display:'flex',gap:8,marginBottom:4,flexWrap:'wrap',alignItems:'center'}}>
          <ProjectChip id={item.project}/>
          {adoWIUrl && <a href={adoWIUrl} target="_blank" rel="noopener" className="btn sm ghost" style={{marginLeft:'auto',textDecoration:'none'}}><Icon name="link" size={12}/> ADO</a>}
        </div>
        {local.blocker&&(
          <div style={{background:'var(--danger-soft)',color:'var(--danger)',padding:12,borderRadius:8,marginTop:8}}>
            <div style={{fontWeight:600,fontSize:12,display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
              <Icon name="alert" size={12}/> Blocked
            </div>
            <div style={{fontSize:13}}>{local.blocker}</div>
          </div>
        )}
      </div>
      <div className="drawer-section">
        <h4>Details</h4>
        <dl className="kv">
          <dt>State</dt>
          <dd>
            <select value={local.state||''} style={sel}
              onChange={e => { const v=e.target.value; patch([['/fields/System.State',v]],{state:nexusMDStateMap[v]||v}); }}>
              {(STATES||[]).map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </dd>

          <dt>Assignee</dt>
          <dd>
            <select value={assignee?.name||''} style={sel}
              onChange={e => {
                const name=e.target.value;
                const member=TEAM.find(t=>t.name===name);
                patch([['/fields/System.AssignedTo',name||'']],{assignee:member?.id||null});
              }}>
              <option value="">Unassigned</option>
              {TEAM.map(t=><option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
          </dd>

          <dt>Priority</dt>
          <dd>
            <select value={String(local.priority||3)} style={sel}
              onChange={e => { const v=parseInt(e.target.value,10); patch([['/fields/Microsoft.VSTS.Common.Priority',v]],{priority:v}); }}>
              <option value="1">1 – Critical</option>
              <option value="2">2 – High</option>
              <option value="3">3 – Medium</option>
              <option value="4">4 – Low</option>
            </select>
          </dd>

          <dt>Area</dt>
          <dd>
            <AreaTreePicker compact value={local.area||''}
              onChange={val => patch([['/fields/Custom.Area',val]],{area:val})}/>
          </dd>

          <dt>Tags</dt>
          <dd>
            <TagInput
              value={(local.tags||[]).join('; ')}
              onChange={str => {
                const tags=str.split(';').map(t=>t.trim()).filter(Boolean);
                patch([['/fields/System.Tags',str.trim()]],{tags});
              }}
              style={{background:'var(--surface-2)',border:'1px solid var(--border)',borderRadius:6,minHeight:28,padding:'1px 6px'}}
            />
          </dd>

          <dt>Points</dt><dd className="mono">{local.points||'—'}</dd>
          <dt>Sprint</dt><dd>{local.sprint?'Current Sprint':'—'}</dd>
          <dt>Updated</dt><dd>
            {local.updated} ago
            {local.changedMs && <span style={{display:'block',fontSize:11,color:'var(--text-subtle)',marginTop:1}}>{new Date(local.changedMs).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</span>}
          </dd>
        </dl>
      </div>
      {typeof WorkItemDetail !== 'undefined' && (
        <WorkItemDetail id={item.id} project={item.project}/>
      )}
    </div>
  );
}

// ── Simple line diff (LCS-based) ─────────────────────────────────────────────
function diffLines(oldLines, newLines) {
  const N = oldLines.length, M = newLines.length;
  const MAX = 400;
  if (N > MAX || M > MAX) return null; // too large to diff in-browser
  const lcs = new Int32Array((N + 1) * (M + 1));
  for (let i = N - 1; i >= 0; i--) {
    for (let j = M - 1; j >= 0; j--) {
      const idx = i * (M + 1) + j;
      if (oldLines[i] === newLines[j]) lcs[idx] = 1 + lcs[(i + 1) * (M + 1) + (j + 1)];
      else lcs[idx] = Math.max(lcs[(i + 1) * (M + 1) + j], lcs[i * (M + 1) + (j + 1)]);
    }
  }
  const result = [];
  let i = 0, j = 0;
  while (i < N || j < M) {
    if (i < N && j < M && oldLines[i] === newLines[j]) {
      result.push({ t: '=', v: oldLines[i] }); i++; j++;
    } else if (j < M && (i >= N || lcs[(i + 1) * (M + 1) + j] >= lcs[i * (M + 1) + (j + 1)])) {
      result.push({ t: '+', v: newLines[j] }); j++;
    } else {
      result.push({ t: '-', v: oldLines[i] }); i++;
    }
  }
  return result;
}

// ── PRCommitsTab ──────────────────────────────────────────────────────────────
function PRCommitsTab({ pr }) {
  const [state, setState] = useState({ status: 'idle', commits: [], error: null });

  useEffect(() => {
    if (!pr.repoId || !pr.project) { setState({ status: 'error', commits: [], error: 'Missing repo or project info.' }); return; }
    setState({ status: 'loading', commits: [], error: null });
    fetch(`/api/ado/${encodeURIComponent(pr.project)}/_apis/git/repositories/${pr.repoId}/pullRequests/${pr.id}/commits?api-version=7.0`)
      .then(r => r.ok ? r.json() : r.text().then(t => { throw new Error(t); }))
      .then(data => setState({ status: 'ok', commits: data.value || [], error: null }))
      .catch(e => setState({ status: 'error', commits: [], error: e.message }));
  }, [pr.id, pr.repoId, pr.project]);

  if (state.status === 'loading') return <div className="drawer-section" style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Loading commits…</div>;
  if (state.status === 'error')   return <div className="drawer-section" style={{ color: 'var(--danger)', fontSize: 13 }}>{state.error}</div>;

  if (!state.commits.length) return <div className="drawer-section empty">No commits found.</div>;

  return (
    <div className="drawer-section">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {state.commits.map(c => {
          const shortId = (c.commitId || '').slice(0, 7);
          const adoUrl = NexusMDData.ORG && pr.project
            ? `https://dev.azure.com/${encodeURIComponent(NexusMDData.ORG)}/${encodeURIComponent(pr.project)}/_git/${pr.repo || pr.repoId}/commit/${c.commitId}`
            : null;
          const authorName = c.author?.name || c.committer?.name || '';
          const authorDate = c.author?.date || c.committer?.date || null;
          const message = (c.comment || '').split('\n')[0];
          return (
            <div key={c.commitId} style={{ padding: '9px 12px', background: 'var(--surface-2)', borderRadius: 6, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 13, color: 'var(--text)', flex: 1, minWidth: 0, lineHeight: 1.4 }}>{message || '(no message)'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {adoUrl
                  ? <a href={adoUrl} target="_blank" rel="noopener" className="mono muted" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>{shortId}</a>
                  : <span className="mono muted" style={{ fontSize: 11 }}>{shortId}</span>}
                {authorName && <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{authorName}</span>}
                {authorDate && <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{timeAgo(authorDate)} ago</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── PRFilesTab ────────────────────────────────────────────────────────────────
function PRFilesTab({ pr }) {
  const [state, setState] = useState({ status: 'idle', files: [], srcCommit: null, baseCommit: null, error: null });
  const [expanded, setExpanded] = useState({});
  const [fileContents, setFileContents] = useState({});

  useEffect(() => {
    if (!pr.repoId || !pr.project) { setState({ status: 'error', files: [], srcCommit: null, baseCommit: null, error: 'Missing repo or project info.' }); return; }
    setState({ status: 'loading', files: [], srcCommit: null, baseCommit: null, error: null });

    const projEnc = encodeURIComponent(pr.project);
    fetch(`/api/ado/${projEnc}/_apis/git/repositories/${pr.repoId}/pullRequests/${pr.id}/iterations?api-version=7.0`)
      .then(r => r.ok ? r.json() : r.text().then(t => { throw new Error(t); }))
      .then(iData => {
        const iterations = iData.value || [];
        if (!iterations.length) throw new Error('No PR iterations found.');
        const latest = iterations[iterations.length - 1];
        const srcCommit  = latest.sourceRefCommit?.commitId || null;
        const baseCommit = latest.targetRefCommit?.commitId || null;
        return fetch(`/api/ado/${projEnc}/_apis/git/repositories/${pr.repoId}/pullRequests/${pr.id}/iterations/${latest.id}/changes?$top=200&api-version=7.0`)
          .then(r => r.ok ? r.json() : r.text().then(t => { throw new Error(t); }))
          .then(cData => ({ files: cData.changeEntries || [], srcCommit, baseCommit }));
      })
      .then(({ files, srcCommit, baseCommit }) => setState({ status: 'ok', files, srcCommit, baseCommit, error: null }))
      .catch(e => setState({ status: 'error', files: [], srcCommit: null, baseCommit: null, error: e.message }));
  }, [pr.id, pr.repoId, pr.project]);

  const toggleFile = async (file) => {
    const path = file.item?.path;
    if (!path) return;
    const key = path;
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

    if (fileContents[key] || !state.srcCommit) return;
    const changeType = (file.changeType || '').toLowerCase();
    const projEnc = encodeURIComponent(pr.project);

    const fetchContent = async (commitId) => {
      if (!commitId) return '';
      const url = `/api/ado/${projEnc}/_apis/git/repositories/${pr.repoId}/items?path=${encodeURIComponent(path)}&versionDescriptor[versionType]=commit&versionDescriptor[version]=${commitId}&$format=text&api-version=7.0`;
      const r = await fetch(url);
      if (!r.ok) return null;
      return r.text();
    };

    try {
      let oldText = '', newText = '';
      if (changeType === 'add') {
        newText = (await fetchContent(state.srcCommit)) ?? '';
      } else if (changeType === 'delete') {
        oldText = (await fetchContent(state.baseCommit)) ?? '';
      } else {
        [oldText, newText] = await Promise.all([
          fetchContent(state.baseCommit).then(t => t ?? ''),
          fetchContent(state.srcCommit).then(t => t ?? ''),
        ]);
      }
      setFileContents(prev => ({ ...prev, [key]: { oldText, newText, changeType } }));
    } catch (e) {
      setFileContents(prev => ({ ...prev, [key]: { error: e.message } }));
    }
  };

  if (state.status === 'loading') return <div className="drawer-section" style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Loading files…</div>;
  if (state.status === 'error')   return <div className="drawer-section" style={{ color: 'var(--danger)', fontSize: 13 }}>{state.error}</div>;
  if (!state.files.length)        return <div className="drawer-section empty">No file changes found.</div>;

  const changeIcon = { add: { icon: '+', color: 'var(--success)' }, delete: { icon: '−', color: 'var(--danger)' }, edit: { icon: '~', color: 'var(--info)' }, rename: { icon: 'R', color: 'var(--warning)' } };

  return (
    <div className="drawer-section">
      <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-subtle)' }}>
        {state.files.length} file{state.files.length !== 1 ? 's' : ''} changed
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {state.files.map((file, idx) => {
          const path = file.item?.path || '';
          const ct = (file.changeType || 'edit').toLowerCase();
          const ind = changeIcon[ct] || changeIcon.edit;
          const isOpen = expanded[path];
          const contents = fileContents[path];
          const filename = path.split('/').pop();
          const dir = path.slice(0, path.lastIndexOf('/') + 1);

          return (
            <div key={idx} style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'var(--surface-2)', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => toggleFile(file)}>
                <span style={{ fontSize: 11, fontWeight: 700, color: ind.color, minWidth: 12, textAlign: 'center' }}>{ind.icon}</span>
                <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span className="muted" style={{ fontSize: 11 }}>{dir}</span><span style={{ fontWeight: 600 }}>{filename}</span>
                </span>
                <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={11} style={{ color: 'var(--text-subtle)', flexShrink: 0 }}/>
              </div>

              {isOpen && (
                <div style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', overflow: 'auto', maxHeight: 480 }}>
                  {!contents && <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-subtle)' }}>Loading diff…</div>}
                  {contents?.error && <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--danger)' }}>{contents.error}</div>}
                  {contents && !contents.error && (() => {
                    const oldLines = (contents.oldText || '').split('\n');
                    const newLines = (contents.newText || '').split('\n');
                    const diff = diffLines(oldLines, newLines);
                    if (!diff) {
                      return (
                        <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-subtle)' }}>
                          File too large to diff inline.{' '}
                          {NexusMDData.ORG && pr.project
                            ? <a href={`https://dev.azure.com/${encodeURIComponent(NexusMDData.ORG)}/${encodeURIComponent(pr.project)}/_git/${pr.repo || pr.repoId}/pullrequest/${pr.id}?_a=files`} target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>View in ADO</a>
                            : null}
                        </div>
                      );
                    }
                    // Collapse unchanged runs to ±3 context lines
                    const ctx = 3;
                    const visible = [];
                    let sameRun = [], lastPushedEnd = -1;
                    const flush = (end) => {
                      if (!sameRun.length) return;
                      const start = visible.length - sameRun.length;
                      if (sameRun.length <= ctx * 2 + 1) { visible.push(...sameRun); sameRun = []; return; }
                      const keep = sameRun.slice(0, ctx).concat([{ t: '…', v: `… ${sameRun.length - ctx * 2} unchanged lines …` }]).concat(sameRun.slice(-ctx));
                      visible.length = start;
                      visible.push(...keep);
                      sameRun = [];
                    };
                    diff.forEach(line => {
                      if (line.t === '=') { sameRun.push(line); }
                      else { flush(); visible.push(line); }
                    });
                    flush();

                    return (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                        <tbody>
                          {visible.map((line, i) => {
                            if (line.t === '…') return (
                              <tr key={i} style={{ background: 'var(--surface-2)' }}>
                                <td colSpan={2} style={{ padding: '3px 12px', color: 'var(--text-subtle)', fontSize: 11, textAlign: 'center' }}>{line.v}</td>
                              </tr>
                            );
                            const bg = line.t === '+' ? 'rgba(34,197,94,0.12)' : line.t === '-' ? 'rgba(239,68,68,0.12)' : 'transparent';
                            const fg = line.t === '+' ? 'rgba(34,197,94,0.8)' : line.t === '-' ? 'rgba(239,68,68,0.8)' : 'var(--text-subtle)';
                            return (
                              <tr key={i} style={{ background: bg }}>
                                <td style={{ padding: '1px 8px', color: fg, userSelect: 'none', minWidth: 16, textAlign: 'center', borderRight: '1px solid var(--border)', fontSize: 11 }}>
                                  {line.t === '+' ? '+' : line.t === '-' ? '−' : ''}
                                </td>
                                <td style={{ padding: '1px 10px', color: 'var(--text)', whiteSpace: 'pre', overflowWrap: 'normal' }}>{line.v || ' '}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
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

      {tab === 'commits' && <PRCommitsTab pr={pr}/>}
      {tab === 'files'   && <PRFilesTab   pr={pr}/>}
    </div>
  );
}

function PersonDetail({ dev, plannerData }) {
  const { WORK_ITEMS, PRS, PLANNER_NOW } = NexusMDData;
  const wis  = (WORK_ITEMS||[]).filter(w=>w.assignee===dev.id);
  const myPRs = (PRS||[]).filter(p=>p.author===dev.id);
  const myOneOnOne = (PLANNER_NOW?.oneOnOnes||[]).find(o=>o.person?.toLowerCase().includes((dev.name||'').split(' ')[0].toLowerCase()));
  const myNotes = ((plannerData?.teamNotes) || []).filter(n =>
    n.person?.toLowerCase() === (dev.name || '').toLowerCase()
  );

  // 'locked' | 'prompting' | 'revealed'
  const [notesState, setNotesState] = React.useState('locked');
  const [pwInput, setPwInput]       = React.useState('');
  const [pwErr, setPwErr]           = React.useState('');
  const [pwBusy, setPwBusy]         = React.useState(false);

  // Reset lock when switching between team members
  React.useEffect(() => {
    setNotesState('locked');
    setPwInput('');
    setPwErr('');
  }, [dev.id]);

  const confCfg    = loadConfidentialConfig() || { hash: null };
  const hasPassword = !!confCfg.hash;

  const handleRevealClick = () => {
    if (!hasPassword) { setNotesState('revealed'); return; }
    setNotesState('prompting');
  };

  const handlePasswordSubmit = async () => {
    if (!pwInput) { setPwErr('Enter your password.'); return; }
    setPwBusy(true);
    try {
      const hash = await hashPassword(pwInput);
      if (hash === confCfg.hash) {
        setNotesState('revealed');
        setPwErr('');
      } else {
        setPwErr('Incorrect password.');
      }
    } finally {
      setPwBusy(false);
    }
  };

  const inputStyle = { width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:8, background:'var(--surface)', fontSize:13, outline:'none', color:'var(--text)', boxSizing:'border-box' };

  return (
    <div>
      <div className="drawer-section" style={{display:'flex',alignItems:'center',gap:14}}>
        <Avatar who={dev.id} size="lg"/>
        <div>
          <div style={{fontWeight:600,fontSize:16}}>{dev.name}</div>
          <div className="muted" style={{fontSize:12.5}}>{dev.role} · {dev.tz}</div>
          <div style={{marginTop:4,fontSize:12,color:'var(--text-muted)'}}>{dev.focus}</div>
        </div>
      </div>
      <div className="drawer-section">
        <h4>Active work ({wis.filter(w=>!isTerminalState(w.state)).length})</h4>
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          {wis.filter(w=>!isTerminalState(w.state)).map(w=>(
            <div key={w.id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',background:'var(--surface-2)',borderRadius:6,fontSize:12.5}}>
              <TypeIcon type={w.type}/>
              <span className="mono muted" style={{fontSize:11}}>#{w.id}</span>
              <span style={{flex:1,minWidth:0}} className="truncate">{w.title}</span>
              <StateDot state={w.state}/>
            </div>
          ))}
          {wis.filter(w=>!isTerminalState(w.state)).length===0&&<div className="empty">No active work</div>}
        </div>
      </div>
      <div className="drawer-section">
        <h4>Open PRs ({myPRs.filter(p=>p.status==='active').length})</h4>
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          {myPRs.filter(p=>p.status==='active').map(p=>(
            <div key={p.id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',background:'var(--surface-2)',borderRadius:6,fontSize:12.5}}>
              <Icon name="pr" size={13} style={{color:'var(--success)'}}/>
              <span className="mono muted" style={{fontSize:11}}>#{p.id}</span>
              <span style={{flex:1,minWidth:0}} className="truncate">{p.title}</span>
            </div>
          ))}
          {myPRs.filter(p=>p.status==='active').length===0&&<div className="empty">No open PRs</div>}
        </div>
      </div>
      <div className="drawer-section">
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
          <h4 style={{ margin:0 }}>Notes ({myNotes.length})</h4>
          {myNotes.length > 0 && notesState === 'revealed' && (
            <button className="btn sm ghost" style={{ fontSize:11 }} onClick={() => setNotesState('locked')}>
              <Icon name="lock" size={11}/> Lock
            </button>
          )}
        </div>

        {myNotes.length === 0 ? (
          <div className="empty">No notes yet — use + Note on the Team page to add one.</div>

        ) : notesState === 'locked' ? (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 12px', background:'var(--surface-2)', borderRadius:8, color:'var(--text-subtle)', fontSize:13 }}>
              <Icon name="lock" size={13}/>
              <span>{myNotes.length} confidential note{myNotes.length !== 1 ? 's' : ''}</span>
            </div>
            <button className="btn sm ghost" style={{ alignSelf:'flex-start', gap:6 }} onClick={handleRevealClick}>
              <Icon name="lock" size={11}/> {hasPassword ? 'Unlock to view' : 'Reveal'}
            </button>
          </div>

        ) : notesState === 'prompting' ? (
          <div style={{ display:'flex', flexDirection:'column', gap:10, padding:'14px', background:'var(--surface-2)', borderRadius:10, border:'1px solid var(--border)' }}>
            <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', display:'flex', alignItems:'center', gap:7 }}>
              <Icon name="lock" size={13}/> Enter confidential password
            </div>
            <input
              type="password"
              value={pwInput}
              autoFocus
              onChange={e => { setPwInput(e.target.value); setPwErr(''); }}
              onKeyDown={e => { if (e.key === 'Enter') handlePasswordSubmit(); if (e.key === 'Escape') setNotesState('locked'); }}
              placeholder="Password"
              style={inputStyle}
            />
            {pwErr && <div style={{ fontSize:12, color:'var(--danger)', padding:'5px 8px', background:'var(--danger-soft)', borderRadius:6 }}>{pwErr}</div>}
            <div style={{ display:'flex', gap:8 }}>
              <button className="btn sm primary" onClick={handlePasswordSubmit} disabled={pwBusy} style={{ flex:1 }}>
                {pwBusy ? 'Checking…' : 'Unlock'}
              </button>
              <button className="btn sm ghost" onClick={() => { setNotesState('locked'); setPwInput(''); setPwErr(''); }}>Cancel</button>
            </div>
          </div>

        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {[...myNotes].reverse().map((n, i) => (
              <div key={i} style={{ padding:'8px 10px', background:'var(--surface-2)', borderRadius:6, borderLeft:'3px solid var(--accent)' }}>
                <div style={{ fontSize:13, color:'var(--text)', marginBottom:4 }}>{n.note}</div>
                <div className="muted" style={{ fontSize:11 }}>{n.date}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Mini({ label, value, color }) {
  return (
    <div style={{background:'var(--surface-2)',padding:10,borderRadius:6}}>
      <div className="muted" style={{fontSize:10.5,textTransform:'uppercase',letterSpacing:'0.04em'}}>{label}</div>
      <div className="mono" style={{fontSize:16,fontWeight:600,color:color||'var(--text)'}}>{value}</div>
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
