import React from 'react'
import ReactDOM from 'react-dom/client'
import '@nexusmd/ui/styles.css'

import {
  initCore, createNoOpAdapters, core, loadCachedAdoData, loadAdoData,
} from '@nexusmd/core'
import {
  Icon, CardFrame,
  NexusDataProvider, useNexusData, ToastHost,
  PRView, BuildsView, TestsView, TeamView, EMPTY_NEXUS_DATA,
  DashboardView, WorkItemsView, TriageView,
  VsProfiles, BackupRestoreCard, CloudSyncCard,
  IntegrationsView, VsRow, VsCard, VsFullRow, VsSeg, ThemeChipPicker,
  PlannerView, MarkdownViewer, plannerExportDocx,
  WorkItemDetail, Drawer, PlToggle,
  TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakButton,
} from '@nexusmd/ui'
import { ProfileProvider, useProfile, ensureDefaultProfileAndMigrate } from './profile-context.jsx'
import { getProfileKey } from './profile-keys.js'
import { desktopFileIO } from './file-io.js'
import { desktopCloudProviders, registerCloudDeepLink, makeDesktopOAuthService } from './cloud-auth.js'
import { desktopSync, startDesktopAutoSync } from './sync.js'
import {
  localStorageAdapter, networkAdapter, lifecycleAdapter, themeAdapter,
  clipboardAdapter, shareAdapter, notificationAdapter,
} from '@nexusmd/web-adapters'
import { createAdoHttpAdapter, getAdoConfig, saveAdoConfig, isAdoConfigured } from './ado-client.js'
import { navigationAdapter }    from './adapters/navigation.js'
import { authAdapter }          from './adapters/auth.js'
import { fileAdapter }          from './adapters/file.js'
import { pickerAdapter }        from './adapters/picker.js'
import { badgeAdapter }         from './adapters/badge.js'
import { trayAdapter }          from './adapters/tray.js'
import { deepLinkAdapter }      from './adapters/deepLink.js'
import { updateAdapter }        from './adapters/update.js'
import { secureStorageAdapter } from './adapters/secureStorage.js'

const adapters = {
  ...createNoOpAdapters(),
  storage:       localStorageAdapter,
  http:          createAdoHttpAdapter(),
  network:       networkAdapter,
  lifecycle:     lifecycleAdapter,
  theme:         themeAdapter,
  clipboard:     clipboardAdapter,
  share:         shareAdapter,
  notification:  notificationAdapter,
  navigation:    navigationAdapter,
  auth:          authAdapter,
  file:          fileAdapter,
  picker:        pickerAdapter,
  badge:         badgeAdapter,
  tray:          trayAdapter,
  deepLink:      deepLinkAdapter,
  update:        updateAdapter,
  secureStorage: secureStorageAdapter,
}

const NEXUSMD_THEMES = [
  { id: 'parchment', label: 'Parchment', swatch: ['#f4f1e8', '#ebe5d4', '#9a7e22'] },
  { id: 'dusk',      label: 'Dusk',      swatch: ['#e4e0d2', '#dbd5c2', '#9a7e22'] },
  { id: 'paper',     label: 'Paper',     swatch: ['#f5f5f5', '#e8e8e8', '#1d6fcc'] },
  { id: 'cobalt',    label: 'Cobalt',    swatch: ['#0d1620', '#1f2c3b', '#4a9eff'] },
  { id: 'noir',      label: 'Noir',      swatch: ['#171410', '#282420', '#e8a020'] },
  { id: 'slate',     label: 'Slate',     swatch: ['#1a1c20', '#2a2e38', '#8098e0'] },
  { id: 'forest',    label: 'Forest',    swatch: ['#0e1812', '#1c2a20', '#48b870'] },
]
window.NEXUSMD_THEMES = NEXUSMD_THEMES

const DASH_WIDGET_ORDER = ['sprint', 'review', 'blockers', 'team', 'triage', 'activity', 'resolvedme']

const DEFAULT_TWEAKS = {
  theme: 'light', lightTheme: 'parchment', darkTheme: 'cobalt',
  density: 'balanced', sidebar: 'labels', typeLabels: false,
  widgetOrder: DASH_WIDGET_ORDER,
}

function loadTweaks() {
  try { const s = localStorage.getItem('nexusmd.tweaks'); return s ? { ...DEFAULT_TWEAKS, ...JSON.parse(s) } : DEFAULT_TWEAKS } catch { return DEFAULT_TWEAKS }
}

// Seed a default profile and fold any pre-registry flat `nexusmd.*` data into
// its scope. Must run before initCore, which reads cached ADO data via the
// (now profile-scoped) getProfileKey.
ensureDefaultProfileAndMigrate()

// Subscribe to nexusmd:// deep links so cloud OAuth one-time codes are redeemed.
registerCloudDeepLink()

// Fire-and-forget: enables modules + inits adapters. The shell reads cached data
// and re-renders on core's 'data:updated' events.
initCore(adapters)

// Manual refresh for the views' Refresh buttons (api.load). Does a full load on
// first run (no cache) so team members are fetched from the ADO teams API. On
// subsequent calls, passes the cached team as priorData so isRefresh=true skips
// the expensive team API and reuses it.
async function refreshAdoData() {
  try {
    if (!isAdoConfigured()) return
    const priorData = loadCachedAdoData(getAdoConfig(), { storage: localStorageAdapter })
    await loadAdoData(
      getAdoConfig(),
      { http: createAdoHttpAdapter(), storage: localStorageAdapter },
      { isRefresh: !!priorData, priorData },
    )
  } catch { /* offline / not configured — keep cached */ }
  finally { core._emit?.('data:updated') }
}

// Direct-to-ADO work item source for the desktop (no ASP.NET proxy available).
// Mirrors the shape expected by the shared WorkItemDetail component.
const desktopWorkItemSource = {
  async loadDetail(id) {
    const adapter = createAdoHttpAdapter()
    const res = await adapter.fetch(`_apis/wit/workitems/${id}?$expand=all&api-version=7.0`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const f = data.fields || {}
    return {
      description:        f['System.Description']                       || null,
      acceptanceCriteria: f['Microsoft.VSTS.Common.AcceptanceCriteria'] || null,
      reproSteps:         f['Microsoft.VSTS.TCM.ReproSteps']            || null,
    }
  },
  async loadComments(id, project) {
    const adapter = createAdoHttpAdapter()
    const proj = project || (getAdoConfig().projects || [])[0] || ''
    if (!proj) return []
    const res = await adapter.fetch(`${encodeURIComponent(proj)}/_apis/wit/workitems/${id}/comments?api-version=7.1-preview.3`)
    if (!res.ok) return []
    const data = await res.json()
    return (data.comments || []).map(c => ({
      id:          c.id,
      author:      c.createdBy?.displayName || '',
      text:        c.text || c.renderedText || '',
      createdDate: c.createdDate || '',
    }))
  },
  async saveField(itemId, field, html) {
    const adapter = createAdoHttpAdapter()
    const res = await adapter.fetch(`_apis/wit/workitems/${itemId}?api-version=7.0`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json-patch+json' },
      body: JSON.stringify([{ op: 'add', path: `/fields/${field}`, value: html }]),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  },
  async addComment(id, project, html) {
    const adapter = createAdoHttpAdapter()
    const proj = encodeURIComponent(project || (getAdoConfig().projects || [])[0] || '')
    const res = await adapter.fetch(
      `${proj}/_apis/wit/workitems/${id}/comments?api-version=7.1-preview.3`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments: [{ parentCommentId: 0, content: html, commentType: 1 }], status: 1 }),
      },
    )
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return {
      id:          data.id,
      author:      data.createdBy?.displayName || '',
      text:        html,
      createdDate: data.createdDate || new Date().toISOString(),
    }
  },
  async loadRawFields(id) {
    const adapter = createAdoHttpAdapter()
    const res = await adapter.fetch(`_apis/wit/workitems/${id}?$expand=fields&api-version=7.0`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return data.fields || {}
  },
}

const NAV = [
  { id: 'dashboard',     label: 'Dashboard',     icon: 'dashboard' },
  { id: 'work',          label: 'Work Items',     icon: 'work' },
  { id: 'prs',           label: 'Pull Requests',  icon: 'pr' },
  { id: 'builds',        label: 'Builds',         icon: 'build' },
  { id: 'tests',         label: 'Tests',          icon: 'check' },
  { id: 'team',          label: 'Team',           icon: 'team' },
  { id: 'triage',        label: 'Triage',         icon: 'work' },
  { id: 'planner',       label: 'Planner',        icon: 'planner' },
  { id: 'markdown',      label: 'Notes',          icon: 'pin' },
  { id: 'integrations',  label: 'Integrations',   icon: 'lock' },
  { id: 'settings',      label: 'Settings',       icon: 'settings' },
]

// Cached ADO snapshot, shaped for the shared views, re-read on every data:updated.
function useNexusSnapshot() {
  const [snapshot, setSnapshot] = React.useState(EMPTY_NEXUS_DATA)
  const refresh = React.useCallback(() => {
    try {
      const cached = loadCachedAdoData(getAdoConfig(), { storage: localStorageAdapter })
      setSnapshot(cached ? { ...EMPTY_NEXUS_DATA, ...cached } : EMPTY_NEXUS_DATA)
    } catch { setSnapshot(EMPTY_NEXUS_DATA) }
  }, [])

  React.useEffect(() => {
    refresh()
    const onData = () => refresh()
    core.on('data:updated', onData)
    return () => core.off('data:updated', onData)
  }, [refresh])

  return snapshot
}

// Simple localStorage-backed state for the per-view "acknowledged" sets and
// PR criteria that the shared views expect their host to own. Keys are routed
// through getProfileKey so this state is scoped to the active profile.
function usePersistedState(key, initial) {
  const sk = getProfileKey(key)
  const [value, setValue] = React.useState(() => {
    try {
      const raw = window.localStorage.getItem(sk)
      return raw === null ? initial : JSON.parse(raw)
    } catch { return initial }
  })
  React.useEffect(() => {
    try { window.localStorage.setItem(sk, JSON.stringify(value)) } catch { /* ignore */ }
  }, [sk, value])
  return [value, setValue]
}

function NotConfigured() {
  return (
    <CardFrame title="Welcome to NexusMD" icon={<Icon name="dashboard" size={16} />}>
      <p style={{ color: 'var(--text-muted)', maxWidth: 520 }}>
        Connect your Azure DevOps organisation in <strong>Settings</strong> to populate your
        dashboard with work items, pull requests, builds and sprint metrics.
      </p>
    </CardFrame>
  )
}

function Placeholder({ label }) {
  return (
    <CardFrame title={label}>
      <p style={{ color: 'var(--text-muted)' }}>
        {label} is platform-specific (it depends on the web host's APIs / Google) and is not
        shared into <code>@nexusmd/ui</code> yet.
      </p>
    </CardFrame>
  )
}

const settInputStyle = {
  width: '100%', padding: '7px 10px',
  border: '1px solid var(--border)', borderRadius: 6,
  background: 'var(--surface-2)', outline: 'none', fontSize: 13,
  color: 'var(--text)', boxSizing: 'border-box',
}

function SettField({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)' }}>{label}</label>
      {children}
      {hint && <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{hint}</span>}
    </div>
  )
}

function AdoConnectionCard() {
  const [org, setOrg]           = React.useState('')
  const [pat, setPat]           = React.useState('')
  const [projects, setProjects] = React.useState('')
  const [status, setStatus]     = React.useState('')
  const [saving, setSaving]     = React.useState(false)
  const [discovering, setDiscovering] = React.useState(false)

  React.useEffect(() => {
    const c = getAdoConfig()
    setOrg(c.org || '')
    setProjects((c.projects || []).join(', '))
  }, [])

  const save = async () => {
    setSaving(true)
    setStatus('Saving…')
    try {
      const projectList = projects.split(/[,\n]+/).map(p => p.trim()).filter(Boolean)
      saveAdoConfig({
        org: org.trim(),
        ...(pat.trim() ? { pat: pat.trim() } : {}),
        projects: projectList,
      })
      setStatus('Saved! Loading data…')
      setPat('')
      refreshAdoData().catch(() => {})
      setTimeout(() => setStatus(''), 3000)
    } catch (e) {
      setStatus('Error: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const discoverProjects = async () => {
    const currentOrg = org.trim()
    const currentPat = pat.trim() || getAdoConfig().pat
    if (!currentOrg || !currentPat) { setStatus('Enter org and PAT first.'); return }
    setDiscovering(true)
    setStatus('Discovering…')
    try {
      saveAdoConfig({ org: currentOrg, pat: currentPat })
      const adapter = createAdoHttpAdapter()
      const res = await adapter.fetch('_apis/projects?api-version=7.0')
      const j   = await res.json()
      const names = (j.value || []).map(p => p.name).filter(Boolean)
      if (!names.length) { setStatus('No projects returned.'); return }
      setProjects(names.join(', '))
      setStatus(`Discovered ${names.length} project${names.length === 1 ? '' : 's'}.`)
    } catch (e) {
      setStatus('Error: ' + e.message)
    } finally {
      setDiscovering(false)
    }
  }

  const isError = status.startsWith('Error')

  return (
    <CardFrame title="Azure DevOps Connection" icon={<Icon name="settings" size={16} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SettField label="Organisation" hint="The subdomain from dev.azure.com/your-org">
          <input value={org} onChange={e => setOrg(e.target.value)}
            placeholder="your-org-name" style={settInputStyle} />
        </SettField>
        <SettField label="Personal Access Token" hint="Needs Work Items, Code, and Build (Read) scopes. Leave blank to keep existing.">
          <input type="password" value={pat} onChange={e => setPat(e.target.value)}
            placeholder="Leave blank to keep existing PAT" style={settInputStyle} />
        </SettField>
        <SettField label="Projects" hint="Comma-separated project names.">
          <textarea value={projects} onChange={e => setProjects(e.target.value)}
            placeholder="Project1, Project2" rows={2}
            style={{ ...settInputStyle, resize: 'vertical', paddingTop: 8, paddingBottom: 8 }} />
        </SettField>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn sm ghost" onClick={discoverProjects} disabled={discovering || saving}>
            {discovering ? 'Discovering…' : 'Discover projects'}
          </button>
          <button className="btn primary" onClick={save} disabled={saving || discovering}>
            {saving ? 'Saving…' : 'Save & connect'}
          </button>
          {status && (
            <span style={{ fontSize: 12.5, color: isError ? 'var(--danger)' : 'var(--success)' }}>
              {status}
            </span>
          )}
        </div>
      </div>
    </CardFrame>
  )
}

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.48)',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
  zIndex: 900, padding: '32px 16px', overflowY: 'auto',
}

function ItemDetailModal({ item, onClose }) {
  if (!item) return null
  const { org } = getAdoConfig()
  const projectRaw = (item.project || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const adoUrl = org
    ? `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projectRaw)}/_workitems/edit/${item.id}`
    : null
  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: 'var(--surface)', borderRadius: 12, width: '100%', maxWidth: 800,
        boxShadow: '0 8px 40px rgba(0,0,0,0.28)', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px',
          borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text-muted)' }}>#{item.id}</span>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</h2>
          {adoUrl && (
            <button className="btn sm ghost" onClick={() => window.open(adoUrl, '_blank', 'noopener')}>
              <Icon name="link" size={12}/> Open in browser
            </button>
          )}
          <button className="btn sm ghost" style={{ padding: '4px 8px' }} onClick={onClose}>
            <Icon name="x" size={14}/>
          </button>
        </div>
        <div style={{ padding: '4px 20px 24px', overflowY: 'auto' }}>
          <WorkItemDetail id={item.id} project={item.project} />
        </div>
      </div>
    </div>
  )
}

function PRDetailModal({ pr, onClose }) {
  if (!pr) return null
  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: 'var(--surface)', borderRadius: 12, width: '100%', maxWidth: 680,
        boxShadow: '0 8px 40px rgba(0,0,0,0.28)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px',
          borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text-muted)' }}>#{pr.id}</span>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pr.title}</h2>
          {pr.url && (
            <button className="btn sm ghost" onClick={() => window.open(pr.url, '_blank', 'noopener')}>
              <Icon name="link" size={12}/> Open in browser
            </button>
          )}
          <button className="btn sm ghost" style={{ padding: '4px 8px' }} onClick={onClose}>
            <Icon name="x" size={14}/>
          </button>
        </div>
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <span className={`pill ${pr.status}`} style={{ textTransform: 'capitalize' }}>{pr.status}</span>
            {pr.draft && <span className="pill">Draft</span>}
            {pr.hasConflicts && <span className="pill danger"><Icon name="alert" size={9}/> Conflicts</span>}
            {pr.ciStatus === 'success' && <span className="pill success">CI passing</span>}
            {pr.ciStatus === 'failed'  && <span className="pill danger">CI failing</span>}
            {pr.ciStatus === 'running' && <span className="pill info">CI running</span>}
            {pr.ciStatus === 'partial' && <span className="pill warning">CI partial</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Icon name="git-branch" size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }}/>
              <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>{pr.branch}</span>
            </div>
            <div style={{ color: 'var(--text-muted)' }}>
              <strong>Author:</strong> {pr.authorName || pr.author}
              {' · '}
              <strong>Opened:</strong> {pr.age} ago
              {pr.repo && <>{' · '}<strong>Repo:</strong> {pr.repo}</>}
            </div>
            <div>
              <span style={{ color: 'var(--success)', fontWeight: 500 }}>+{pr.additions}</span>
              {' '}
              <span style={{ color: 'var(--danger)', fontWeight: 500 }}>−{pr.deletions}</span>
              {pr.comments > 0 && (
                <span style={{ color: 'var(--text-muted)', marginLeft: 10 }}>
                  <Icon name="comment" size={11}/> {pr.comments} comment{pr.comments !== 1 ? 's' : ''}
                  {pr.unresolvedComments > 0 && ` (${pr.unresolvedComments} unresolved)`}
                </span>
              )}
            </div>
          </div>
          {(pr.reviewerDetails || []).length > 0 && (
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Reviewers</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {pr.reviewerDetails.map((r, i) => {
                  const v = r.vote
                  const label = v === 10 || v === 5 ? 'Approved' : v === -10 ? 'Rejected' : v === -5 ? 'Waiting for author' : 'Pending'
                  const color = v === 10 || v === 5 ? 'var(--success)' : v === -10 ? 'var(--danger)' : v === -5 ? 'var(--warning)' : 'var(--text-subtle)'
                  return (
                    <div key={`${r.id}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      <span style={{ flex: 1, color: 'var(--text)' }}>{r.name || r.id}</span>
                      <span style={{ fontSize: 12, color, fontWeight: 500 }}>{label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {(pr.linkedWorkItems || []).length > 0 && (
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Linked Work Items</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {pr.linkedWorkItems.map(wi => (
                  <span key={wi.id} className="pill" style={{ fontSize: 11, color: 'var(--accent)', background: 'var(--accent-soft)', border: '1px solid var(--accent-border)' }}>#{wi.id}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CreateWorkItemModal({ open, title: initialTitle, onClose }) {
  const cfg = getAdoConfig()
  const projects = cfg.projects || []
  const types = ['Task', 'Bug', 'User Story', 'Feature']

  const [project, setProject] = React.useState('')
  const [type, setType]       = React.useState('Task')
  const [title, setTitle]     = React.useState('')
  const [status, setStatus]   = React.useState('')
  const [saving, setSaving]   = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setTitle(initialTitle || '')
      setProject(projects[0] || '')
      setType('Task')
      setStatus('')
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const create = async () => {
    if (!project) { setStatus('Select a project.'); return }
    if (!title.trim()) { setStatus('Enter a title.'); return }
    setSaving(true)
    setStatus('Creating…')
    try {
      const adapter = createAdoHttpAdapter()
      const res = await adapter.fetch(
        `${encodeURIComponent(project)}/_apis/wit/workitems/$${encodeURIComponent(type)}?api-version=7.0`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json-patch+json' },
          body: JSON.stringify([{ op: 'add', path: '/fields/System.Title', value: title.trim() }]),
        },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setStatus('Created!')
      setTimeout(() => onClose(), 1200)
    } catch (e) {
      setStatus('Error: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const isError = status.startsWith('Error')

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: 10, padding: 24, width: 440,
        boxShadow: '0 8px 32px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Create Work Item</h2>
        <SettField label="Title">
          <input value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Work item title" style={settInputStyle} autoFocus />
        </SettField>
        <SettField label="Project">
          <select value={project} onChange={e => setProject(e.target.value)} style={settInputStyle}>
            {projects.length === 0 && <option value="">No projects configured</option>}
            {projects.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </SettField>
        <SettField label="Type">
          <select value={type} onChange={e => setType(e.target.value)} style={settInputStyle}>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </SettField>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn primary" onClick={create} disabled={saving || !projects.length}>
            {saving ? 'Creating…' : 'Create'}
          </button>
          <button className="btn sm ghost" onClick={onClose} disabled={saving}>Cancel</button>
          {status && (
            <span style={{ fontSize: 12.5, color: isError ? 'var(--danger)' : 'var(--success)' }}>
              {status}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// Settings — ADO connection, profile registry, backup & restore, cloud sync.
function DesktopSettings({ tweaks, setTweak }) {
  const profileApi = useProfile()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      <VsCard title="Appearance" icon="sun">
        <VsRow title="Mode" desc="Toggle between your assigned light and dark themes">
          <VsSeg value={tweaks.theme}
            options={[['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']]}
            onChange={v => setTweak('theme', v)} />
        </VsRow>
        <VsFullRow title="Light mode theme" desc="Palette used when light mode is active">
          <ThemeChipPicker value={tweaks.lightTheme || 'parchment'} onChange={v => setTweak('lightTheme', v)} />
        </VsFullRow>
        <VsFullRow title="Dark mode theme" desc="Palette used when dark mode is active">
          <ThemeChipPicker value={tweaks.darkTheme || 'cobalt'} onChange={v => setTweak('darkTheme', v)} />
        </VsFullRow>
      </VsCard>
      <AdoConnectionCard />
      <VsProfiles profileApi={profileApi} />
      <BackupRestoreCard fileIO={desktopFileIO} cloudProviders={desktopCloudProviders} />
      <CloudSyncCard controller={desktopSync} providers={desktopCloudProviders} fileIO={desktopFileIO} />
    </div>
  )
}

function IntegrationsPanel() {
  const [ghRepos, setGhRepos] = React.useState(() => {
    try {
      const k = getProfileKey('nexusmd.github.repos')
      return k ? (localStorage.getItem(k) || '') : ''
    } catch { return '' }
  })

  const saveGhRepos = () => {
    try {
      const k = getProfileKey('nexusmd.github.repos')
      if (k) localStorage.setItem(k, ghRepos)
    } catch {}
  }

  const oauthServices = React.useMemo(() => [
    {
      id: 'ado',
      label: 'Azure DevOps',
      icon: 'inbox',
      desc: 'OAuth 2.0 — work items, PRs, pipelines',
      ...makeDesktopOAuthService('ado'),
      credFields: [
        { key: 'clientId', label: 'Client ID', hint: 'From your Azure DevOps OAuth application' },
        { key: 'clientSecret', label: 'Client Secret', secret: true },
      ],
    },
    {
      id: 'microsoft',
      label: 'Microsoft / Entra ID',
      icon: 'mail',
      desc: 'Sign in with Microsoft — OneDrive, Teams, Calendar',
      ...makeDesktopOAuthService('microsoft'),
      credFields: [
        { key: 'clientId', label: 'Client ID (Application ID)', hint: 'From Azure portal → App registrations' },
        { key: 'clientSecret', label: 'Client Secret', secret: true },
      ],
    },
    {
      id: 'github',
      label: 'GitHub',
      icon: 'pr',
      desc: 'GitHub OAuth App — pull requests and repo access',
      ...makeDesktopOAuthService('github'),
      credFields: [
        { key: 'clientId', label: 'Client ID', hint: 'From GitHub → Settings → Developer settings → OAuth Apps' },
        { key: 'clientSecret', label: 'Client Secret', secret: true },
      ],
      children: (
        <VsRow title="Repositories" desc="owner/repo pairs, comma-separated">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={ghRepos}
              onChange={e => setGhRepos(e.target.value)}
              placeholder="myorg/backend, myorg/frontend"
              style={{ width: 200, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', font: 'inherit', fontSize: 13, color: 'var(--text)' }}
            />
            <button className="btn sm" onClick={saveGhRepos}>Save</button>
          </div>
        </VsRow>
      ),
    },
  ], [ghRepos])

  return (
    <div style={{ padding: '24px 0' }}>
      <IntegrationsView services={oauthServices} />
    </div>
  )
}

// The view body — reads the snapshot from context and wires per-view host state.
function ViewBody({ view, onOpenItem, onOpenPR, tweaks = DEFAULT_TWEAKS, setTweak = () => {} }) {
  const { data } = useNexusData()
  const { activeProfile } = useProfile() || {}
  // manual profiles don't require ADO config
  const configured = activeProfile?.type === 'manual' || (() => { try { return isAdoConfigured() } catch { return false } })()
  const openExternal = (item) => { if (item?.url) window.open(item.url, '_blank', 'noopener') }

  const [needsMeCriteria, setNeedsMeCriteria] = usePersistedState('nexusmd.pr.needsMeCriteria', { votes: [0], includeDrafts: false })
  const [acknowledgedBuilds, setAcknowledgedBuilds] = usePersistedState('nexusmd.builds.acknowledged', [])
  const [acknowledgedTests, setAcknowledgedTests]   = usePersistedState('nexusmd.tests.acknowledged', [])
  const [widgetWidths, setWidgetWidths] = usePersistedState('nexusmd.dash.widgetWidths', {})
  const [widgetHeights, setWidgetHeights] = usePersistedState('nexusmd.dash.widgetHeights', {})
  const [plannerData, setPlannerData]     = React.useState({})
  const [plannerThemes, setPlannerThemes] = React.useState({})

  switch (view) {
    case 'dashboard':
      if (!configured) return <NotConfigured />
      return (
        <DashboardView
          onOpenItem={onOpenItem} onOpenPR={onOpenPR}
          widgetOrder={tweaks.widgetOrder || DASH_WIDGET_ORDER} setWidgetOrder={arr => setTweak('widgetOrder', arr)}
          widgetWidths={widgetWidths} setWidgetWidths={setWidgetWidths}
          widgetHeights={widgetHeights} setWidgetHeights={setWidgetHeights}
          needsMeCriteria={needsMeCriteria} setPlannerData={() => {}}
          quickLinks={[]}
        />
      )
    case 'work':
      return (
        <WorkItemsView items={data.WORK_ITEMS || []} setItems={() => {}}
          onOpen={onOpenItem} onCreate={() => {}} />
      )
    case 'prs':
      return (
        <PRView prs={data.PRS || []} onOpen={onOpenPR}
          needsMeCriteria={needsMeCriteria} setNeedsMeCriteria={setNeedsMeCriteria} />
      )
    case 'builds':
      return (
        <BuildsView builds={data.BUILDS || []}
          acknowledgedBuilds={acknowledgedBuilds} setAcknowledgedBuilds={setAcknowledgedBuilds} />
      )
    case 'tests':
      return (
        <TestsView tests={data.TESTS || []}
          acknowledgedTests={acknowledgedTests} setAcknowledgedTests={setAcknowledgedTests} />
      )
    case 'team':
      return (
        <TeamView team={data.TEAM || []} workItems={data.WORK_ITEMS || []} prs={data.PRS || []}
          onOpenItem={openExternal} onOpenPerson={() => {}} />
      )
    case 'triage':
      return <TriageView />
    case 'planner':
      return <PlannerView data={plannerData} setData={setPlannerData} themes={plannerThemes} setThemes={setPlannerThemes} onExportDocx={plannerExportDocx} />
    case 'markdown':
      return <MarkdownViewer />
    case 'integrations':
      return <IntegrationsPanel />
    case 'settings':
      return <DesktopSettings tweaks={tweaks} setTweak={setTweak} />
    default:
      return <Placeholder label={(NAV.find(n => n.id === view) || NAV[0]).label} />
  }
}

function WindowControls() {
  if (window.electronAPI?.platform === 'darwin') return null;
  const win = window.electronAPI?.window;
  return (
    <div style={{ display: 'flex', alignSelf: 'stretch', marginLeft: 'auto', marginTop: -10, marginBottom: -10 }}>
      <button className="wc-btn" onClick={() => win?.minimize()} title="Minimize">
        <svg width="10" height="1" viewBox="0 0 10 1" aria-hidden="true">
          <rect width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      <button className="wc-btn" onClick={() => win?.maximize()} title="Maximize">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 0h10v10H0V0zm1 1v8h8V1H1z" fill="currentColor" />
        </svg>
      </button>
      <button className="wc-btn wc-close" onClick={() => win?.close()} title="Close">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
          <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}

function App() {
  const [view, setView]         = React.useState('dashboard')
  const [createWI, setCreateWI] = React.useState(null)
  const [openedItem, setOpenedItem] = React.useState(null)
  const [openedPR, setOpenedPR]     = React.useState(null)
  const [tweaks, setTweaksState] = React.useState(loadTweaks)

  const setTweak = React.useCallback((key, value) => {
    setTweaksState(prev => {
      const next = { ...prev, [key]: value }
      try { localStorage.setItem('nexusmd.tweaks', JSON.stringify(next)) } catch (_) {}
      return next
    })
  }, [])

  React.useEffect(() => {
    const palette = tweaks.theme === 'dark' ? (tweaks.darkTheme || 'cobalt') : (tweaks.lightTheme || 'parchment')
    document.body.dataset.theme = palette
  }, [tweaks.theme, tweaks.darkTheme, tweaks.lightTheme])

  React.useEffect(() => {
    window.nexusMDTypeLabels = tweaks.typeLabels || false
  }, [tweaks.typeLabels])

  const active = NAV.find(n => n.id === view) || NAV[0]
  const snapshot = useNexusSnapshot()

  React.useEffect(() => {
    const handler = (e) => setCreateWI(e.detail || {})
    window.addEventListener('nexusmd:create-wi', handler)
    return () => window.removeEventListener('nexusmd:create-wi', handler)
  }, [])

  const nexusDataValue = React.useMemo(() => ({
    data:           snapshot,
    api:            { load: refreshAdoData },
    storage:        window.localStorage,
    getProfileKey,
    pushPref:       () => {},
    workItemSource: desktopWorkItemSource,
  }), [snapshot])

  return (
    <NexusDataProvider value={nexusDataValue}>
      <div data-density={tweaks.density} data-sidebar={tweaks.sidebar}
        style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        <aside style={{
          width: 220, flexShrink: 0, borderRight: '1px solid var(--border)',
          padding: '14px 10px', display: 'flex', flexDirection: 'column', gap: 2,
          background: 'var(--surface, transparent)',
        }}>
          <div className="sidebar-brand" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 14px' }}>
            <Icon name="dashboard" size={18} />
            <strong style={{ fontSize: 14 }}>NexusMD</strong>
          </div>
          {NAV.map(item => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`nav-item ${view === item.id ? 'active' : ''}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                background: view === item.id ? 'var(--accent-soft, rgba(127,127,127,0.12))' : 'transparent',
                color: view === item.id ? 'var(--accent)' : 'var(--text-muted)',
                font: 'inherit', fontSize: 13,
              }}
            >
              <Icon name={item.icon} size={16} />
              {item.label}
            </button>
          ))}
        </aside>

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <header className="topbar" style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0 10px 18px',
            borderBottom: '1px solid var(--border)',
          }}>
            <Icon name={active.icon} size={16} />
            <h1 style={{ fontSize: 15, margin: 0 }}>{active.label}</h1>
            <WindowControls />
          </header>
          <section style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: view === 'markdown' ? 'hidden' : 'auto',
            padding: view === 'markdown' ? 0 : 18,
          }}>
            <ViewBody view={view} onOpenItem={setOpenedItem} onOpenPR={setOpenedPR} tweaks={tweaks} setTweak={setTweak} />
          </section>
        </main>
      </div>
      <ToastHost />
      <TweaksPanel title="Display">
        <TweakSection title="Appearance">
          <TweakRadio label="Theme" value={tweaks.theme}
            onChange={v => setTweak('theme', v)}
            options={[{label:'Light',value:'light'},{label:'Dark',value:'dark'}]}/>
          <TweakRadio label="Density" value={tweaks.density}
            onChange={v => setTweak('density', v)}
            options={[{label:'Compact',value:'compact'},{label:'Balanced',value:'balanced'},{label:'Cozy',value:'cozy'}]}/>
          <TweakRadio label="Sidebar" value={tweaks.sidebar}
            onChange={v => setTweak('sidebar', v)}
            options={[{label:'Labels',value:'labels'},{label:'Icons',value:'icons'}]}/>
          <TweakToggle label="Show type labels" value={tweaks.typeLabels || false}
            onChange={v => setTweak('typeLabels', v)}/>
        </TweakSection>
        <TweakSection title="Dashboard">
          <TweakButton label="Reset widget order"
            onClick={() => setTweak('widgetOrder', DASH_WIDGET_ORDER)}/>
        </TweakSection>
      </TweaksPanel>
      <ItemDetailModal item={openedItem} onClose={() => setOpenedItem(null)} />
      <PRDetailModal pr={openedPR} onClose={() => setOpenedPR(null)} />
      <CreateWorkItemModal open={!!createWI} title={createWI?.title} onClose={() => setCreateWI(null)} />
    </NexusDataProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ProfileProvider>
      <App />
    </ProfileProvider>
  </React.StrictMode>
)

startDesktopAutoSync()
