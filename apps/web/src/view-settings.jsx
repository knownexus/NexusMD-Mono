// view-settings.jsx — Settings & profile page (planner-redesign port)
// Works with the app's existing infrastructure:
//   - tweaks / setTweak        → nexusmd.tweaks (theme, density, sidebar, typeLabels)
//   - onOpenConnection         → opens the existing SettingsModal (/api/config: org, PAT, SMTP…)
//   - NexusMDData.ME       → profile identity (name, email, org from Azure DevOps)
//   - nexusmd.planner.*        → planner view prefs (same keys the planner View menu writes)
//   - confidential.jsx           → password change (hashPassword/load/saveConfidentialConfig)
// Requires planner-ui.jsx (PlFld, PlModal) + @nexusmd/ui planner-v2.css.
import React, { useState as useStateVS, useEffect as useEffectVS, useRef as useRefVS, useCallback as useCallbackVS } from 'react'
import { NexusMDData, NexusMDApi } from './data.js';
import { Drawer, nexusMDPushPref } from './components.jsx'
import { Icon } from './icons.jsx'
import { PlFld, PlModal } from './planner-ui.jsx'
import { displayName } from './MarkdownViewer.jsx'
import { getProfileKey } from './profile-keys.js'
import { loadConfidentialConfig, saveConfidentialConfig, hashPassword } from './confidential.jsx'
import { useProfile } from './profile-context.jsx'
import { toast } from './toast.jsx'
import { GoogleAuth } from './google-auth.js'
import { GitHubClient } from './github-client.js'
import {
  PlToggle, VsRow, VsCard, VsFullRow, ThemeModeSettings, VsSeg, VsPasswordModal, VsProfiles, BackupRestoreCard, CloudSyncCard,
  IntegrationsView, CardsAndTablesSettings,
} from '@nexusmd/ui'
import { webFileIO } from './file-io.js'
import { webCloudProviders, makeWebOAuthService } from './cloud-auth.js'
import { webSync } from './sync.js'

// Local pref hook — persists to localStorage per-profile and pushes to server prefs.
function usePrefVS(key, fallback) {
  const [value, setValue] = useStateVS(() => {
    try {
      const stored = localStorage.getItem(getProfileKey(key));
      return stored !== null ? stored : fallback;
    } catch (_) {
      return fallback;
    }
  });
  const set = (v) => {
    setValue(v);
    try { localStorage.setItem(getProfileKey(key), v); } catch (_) {}
    nexusMDPushPref?.(key, v);
  };
  return [value, set];
}


// ── Time-zone options ─────────────────────────────────────────
function vsTimeZones() {
  let zones;
  try {
    zones = typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : null;
  } catch (_) {
    zones = null;
  }
  const fallback = ['Europe/London', 'Europe/Amsterdam', 'Europe/Paris', 'UTC', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Asia/Kolkata', 'Asia/Singapore', 'Australia/Sydney'];
  return zones || fallback;
}


// ── Google connection card ────────────────────────────────────
function GoogleConnectionCard() {
  const [connected,    setConnected]    = useStateVS(() => Boolean(GoogleAuth?.isConnected()));
  const [working,      setWorking]      = useStateVS(false);
  const [reminderMins, setReminderMins] = useStateVS(() => parseInt(localStorage.getItem('nexusmd.calendar.reminderMins') || '10', 10));

  useEffectVS(() => {
    const handler = (e) => setConnected(Boolean(e.detail?.connected));
    document.addEventListener('google:auth:changed', handler);
    return () => document.removeEventListener('google:auth:changed', handler);
  }, []);

  const connect = async () => {
    setWorking(true);
    await GoogleAuth?.connect();
    // connect() redirects the page, so this line is only reached on error
    setWorking(false);
  };

  const disconnect = () => {
    GoogleAuth?.disconnect();
    setConnected(false);
    toast?.('Google account disconnected.', 'success');
  };

  return (
    <VsCard title="Google Workspace" icon="mail">
      <VsRow title="Google Account" desc="Calendar, Gmail highlights, and Drive backup">
        {connected ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="pill success"><span className="dot"></span>Connected</span>
            <button className="btn sm ghost danger" onClick={disconnect}>Disconnect</button>
          </div>
        ) : (
          <button className="btn sm ghost" onClick={connect} disabled={working}>
            {working ? 'Redirecting…' : 'Connect Google Account'}
          </button>
        )}
      </VsRow>
      {connected && (
        <VsRow title="Permissions" desc="Calendar read/write · Gmail read + send · Drive app folder">
          <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>OAuth 2.0</span>
        </VsRow>
      )}
      {connected && (
        <VsRow title="Event reminders" desc="Browser notification before each calendar event">
          <select
            value={reminderMins}
            onChange={e => {
              const v = Number(e.target.value);
              setReminderMins(v);
              localStorage.setItem('nexusmd.calendar.reminderMins', String(v));
            }}
            style={{ height: 30, padding: '0 8px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface-2)', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}>
            <option value="5">5 minutes before</option>
            <option value="10">10 minutes before</option>
            <option value="15">15 minutes before</option>
            <option value="30">30 minutes before</option>
          </select>
        </VsRow>
      )}
    </VsCard>
  );
}

// ── GitHub connection sub-tab ─────────────────────────────────
function GitHubConnectionTab({ activeProfile }) {
  const loadCfg = () => {
    try { return JSON.parse(localStorage.getItem(`nexusmd.p.${activeProfile.id}.github.config`) || '{}'); }
    catch (_) { return {}; }
  };
  const cfg = loadCfg();
  const [pat,        setPat]        = useStateVS(cfg.pat   || '');
  const [repos,      setRepos]      = useStateVS((cfg.repos || []).join(', '));
  const [saving,     setSaving]     = useStateVS(false);
  const [repoBrowse, setRepoBrowse] = useStateVS([]);

  const [validationErr, setValidationErr] = useStateVS(null);

  const save = async () => {
    setValidationErr(null);
    const patTrimmed   = pat.trim();
    const repoList     = repos.split(',').map(s => s.trim()).filter(Boolean);

    if (!patTrimmed) { setValidationErr('Personal Access Token is required.'); return; }
    if (!/^gh[ps]_[A-Za-z0-9_]{30,}$/.test(patTrimmed) && !/^github_pat_[A-Za-z0-9_]{80,}$/.test(patTrimmed)) {
      setValidationErr('PAT looks invalid — expected format: ghp_… or github_pat_…');
      return;
    }
    const badRepo = repoList.find(r => !/^[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+$/.test(r));
    if (badRepo) { setValidationErr(`Invalid repo format: "${badRepo}" — expected owner/name`); return; }

    setSaving(true);
    const config = JSON.stringify({ pat: patTrimmed, repos: repoList });
    localStorage.setItem(`nexusmd.p.${activeProfile.id}.github.config`, config);
    await fetch(`/api/profiles/${activeProfile.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    }).catch(() => {});
    toast?.('GitHub connection saved.', 'success');
    setSaving(false);
    NexusMDApi?.load(true);
  };

  const browseRepos = async () => {
    if (!pat.trim()) { toast?.('Enter a PAT first.', 'error'); return; }
    try {
      const list = await GitHubClient?.getRepos();
      setRepoBrowse(list || []);
    } catch (_) { toast?.('Could not fetch repos. Check your PAT.', 'error'); }
  };

  return (
    <VsCard title="GitHub Connection" icon="pr">
      <VsRow title="Personal Access Token" desc="Scopes needed: repo, read:org">
        <input type="password" value={pat} onChange={e => setPat(e.target.value)}
          placeholder="ghp_…"
          style={{ width: 240, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', font: 'inherit', fontSize: 13, color: 'var(--text)' }}/>
      </VsRow>
      <VsFullRow title="Repositories" desc="owner/repo pairs, comma-separated">
        <input value={repos} onChange={e => setRepos(e.target.value)}
          placeholder="myorg/backend, myorg/frontend"
          style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', font: 'inherit', fontSize: 13, color: 'var(--text)' }}/>
      </VsFullRow>
      {repoBrowse.length > 0 && (
        <VsFullRow title="Select from your repos" desc="">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {repoBrowse.map(r => (
              <button key={r} type="button" className="pill" style={{ cursor: 'pointer' }}
                onClick={() => setRepos(v => v.trim() ? v.trim() + ', ' + r : r)}>
                {r}
              </button>
            ))}
          </div>
        </VsFullRow>
      )}
      {validationErr && (
        <div style={{ padding: '8px 14px', fontSize: 12.5, color: 'var(--danger)', background: 'color-mix(in srgb,var(--danger) 8%,var(--surface-2))', borderTop: '1px solid color-mix(in srgb,var(--danger) 20%,transparent)' }}>
          {validationErr}
        </div>
      )}
      <div className="set-row" style={{ gap: 8 }}>
        <button className="btn sm ghost" onClick={browseRepos}>Browse repos…</button>
        <button className="btn sm ghost" onClick={() => GitHubClient?.startOAuth()}>Connect with OAuth</button>
        <span style={{ flex: 1 }}/>
        <button className="btn sm primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </VsCard>
  );
}

// ── Settings page ─────────────────────────────────────────────
function SettingsView({ tweaks, setTweak, onOpenConnection, onOpenProjectAreas, onGoPlanner }) {
  const [subPage, setSubPage] = useStateVS('profile');
  const [pwOpen, setPwOpen] = useStateVS(false);
  const isManual = useProfile?.()?.activeProfile?.type === 'manual';
  const photoInputRef = useRefVS(null);

  // Navigate to a specific tab when nexusmd:navigate event fires
  useEffectVS(() => {
    const handler = (e) => {
      if (e.detail?.view === 'settings') setSubPage(e.detail.tab || 'profile');
    };
    document.addEventListener('nexusmd:navigate', handler);
    return () => document.removeEventListener('nexusmd:navigate', handler);
  }, []);

  const toggleDashWidget = (id, shown) => {
    const current = tweaks.hiddenDashWidgets || [];
    setTweak('hiddenDashWidgets', shown
      ? current.filter(x => x !== id)
      : [...current, id]
    );
  };

  // Profile fields (persisted locally per-profile; identity defaults come from Azure DevOps)
  const me = NexusMDData?.ME || {};
  const browserTz = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_) { return 'UTC'; }
  })();
  const [displayNameVal, setDisplayName] = usePrefVS('nexusmd.profile.displayName', me.name || '');
  const [profRole, setProfRole] = usePrefVS('nexusmd.profile.role', me.role || 'Engineering Manager');
  const [profTeam, setProfTeam] = usePrefVS('nexusmd.profile.team', '');
  const [profTz, setProfTz] = usePrefVS('nexusmd.profile.timeZone', browserTz);
  // Photo stays localStorage-only (data URL — too large for the pref sync endpoint)
  const [photo, setPhoto] = useStateVS(() => {
    try { return localStorage.getItem(getProfileKey('nexusmd.profile.photo')) || ''; } catch (_) { return ''; }
  });

  // Planner prefs (same keys the planner header View menu writes)
  const [plLanding, setPlLanding] = usePrefVS('nexusmd.planner.landing', 'glance');
  const [plNav, setPlNav] = usePrefVS('nexusmd.planner.nav', 'rail');
  const [plEntry, setPlEntry] = usePrefVS('nexusmd.planner.entry', 'inline');
  const [carryPrompt, setCarryPrompt] = usePrefVS('nexusmd.planner.carryPrompt', '1');

  // Notifications
  const [notifWeekly, setNotifWeekly] = usePrefVS('nexusmd.notif.weekly', '1');
  const [notifOneOnOne, setNotifOneOnOne] = usePrefVS('nexusmd.notif.oneOnOne', '1');
  const [notifDigest, setNotifDigest] = usePrefVS('nexusmd.notif.digest', '0');

  // Confidential
  const [autoRelock, setAutoRelock] = usePrefVS('nexusmd.confidential.autoRelock', '0');
  const confCfg = loadConfidentialConfig() || { sections: [], hash: null };

  const [storageBump, setStorageBump] = useStateVS(0);
  const storage = React.useMemo(() => {
    let weeks = 0, bytes = 0, versions = 0, gNotes = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const activeId = localStorage.getItem('nexusmd.activeProfileId') || '';
        const plannerPrefix = activeId ? `nexusmd.p.${activeId}.planner` : 'nexusmd.planner';
        if (!k || !k.startsWith(plannerPrefix)) continue;
        const v = localStorage.getItem(k) || '';
        bytes += k.length + v.length;
        if (k.startsWith(plannerPrefix + '.week.')) weeks++;
        if (k === plannerPrefix + '.versions') { try { versions = JSON.parse(v).length; } catch {} }
        if (k === plannerPrefix + '.globalNotes') { try { gNotes = JSON.parse(v).length; } catch {} }
      }
    } catch {}
    return { weeks, kb: Math.round(bytes / 102.4) / 10, versions, gNotes };
  }, [subPage, storageBump]);

  const choosePhoto = () => photoInputRef.current?.click();
  const onPhotoPicked = (e) => {
    const file = e.target.files?.[0];
    if (!file) { return; }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      setPhoto(url);
      try { localStorage.setItem(getProfileKey('nexusmd.profile.photo'), url); } catch (_) {
        toast?.('Image too large to store locally.', 'error');
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const clearLocalData = () => {
    const sure = window.confirm('Clear all locally stored planner data (weeks, versions, notes)? Server copies are not affected.');
    if (!sure) { return; }
    try {
      const activeId = localStorage.getItem('nexusmd.activeProfileId') || '';
      const plannerPrefix = activeId ? `nexusmd.p.${activeId}.planner` : 'nexusmd.planner';
      const doomed = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(plannerPrefix)) { doomed.push(k); }
      }
      doomed.forEach(k => localStorage.removeItem(k));
      toast?.('Local planner data cleared.', 'success');
    } catch (_) {
      toast?.('Could not clear local data.', 'error');
    }
    setStorageBump(n => n + 1);
  };

  // Desktop app (Electron only)
  const [loginItemEnabled, setLoginItemEnabled] = useStateVS(false);
  const [outputPath, setOutputPath] = useStateVS(() => localStorage.getItem('nexusmd.outputPath') || '');

  useEffectVS(() => {
    if (!window.electronAPI) return;
    window.electronAPI.getLoginItemEnabled().then(setLoginItemEnabled).catch(() => {});
  }, []);

  const onLoginItemChange = (val) => {
    setLoginItemEnabled(val);
    window.electronAPI?.setLoginItemEnabled(val).catch(() => {});
  };

  const [closeToTray, setCloseToTray] = useStateVS(true);

  useEffectVS(() => {
    if (!window.electronAPI) return;
    window.electronAPI.getCloseToTray().then(setCloseToTray).catch(() => {});
  }, []);

  const onCloseToTrayChange = (val) => {
    setCloseToTray(val);
    window.electronAPI?.setCloseToTray(val).catch(() => {});
  };

  const pickOutputFolder = async () => {
    const picked = await window.electronAPI?.pickOutputFolder();
    if (picked) {
      setOutputPath(picked);
      localStorage.setItem('nexusmd.outputPath', picked);
      toast?.('Output folder updated.', 'success');
    }
  };

  const clearOutputPath = () => {
    setOutputPath('');
    localStorage.removeItem('nexusmd.outputPath');
    toast?.('Output folder cleared — using system Downloads.', 'success');
  };

  // OAuth integration service descriptors — one per service, passed to IntegrationsView.
  const adoOAuth = useStateVS(() => makeWebOAuthService('ado'))[0];
  const msOAuth  = useStateVS(() => makeWebOAuthService('microsoft'))[0];
  const ghOAuth  = useStateVS(() => makeWebOAuthService('github'))[0];

  const [ghRepos, setGhRepos] = useStateVS(() => {
    try {
      const k = getProfileKey('nexusmd.github.config');
      return k ? (JSON.parse(localStorage.getItem(k) || '{}').repos?.join(', ') || '') : '';
    } catch (_) { return ''; }
  });
  const [ghRepoBrowse, setGhRepoBrowse] = useStateVS([]);

  const saveGhRepos = () => {
    try {
      const k = getProfileKey('nexusmd.github.config');
      if (!k) return;
      const existing = (() => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } })();
      const repoList = ghRepos.split(',').map(s => s.trim()).filter(Boolean);
      localStorage.setItem(k, JSON.stringify({ ...existing, repos: repoList }));
      toast?.('GitHub repos saved.', 'success');
    } catch (_) {}
  };

  const browseGhRepos = async () => {
    try { const list = await GitHubClient?.getRepos(); setGhRepoBrowse(list || []); }
    catch (_) { toast?.('Could not fetch repos. Check your connection.', 'error'); }
  };

  const oauthServices = [
    {
      id: 'ado',
      label: 'Azure DevOps',
      icon: 'inbox',
      desc: 'OAuth 2.0 — work items, PRs, pipelines',
      ...adoOAuth,
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
      ...msOAuth,
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
      ...ghOAuth,
      credFields: [
        { key: 'clientId', label: 'Client ID', hint: 'From GitHub → Settings → Developer settings → OAuth Apps' },
        { key: 'clientSecret', label: 'Client Secret', secret: true },
      ],
      children: (
        <React.Fragment>
          <VsRow title="Repositories" desc="owner/repo pairs, comma-separated">
            <input
              value={ghRepos}
              onChange={e => setGhRepos(e.target.value)}
              placeholder="myorg/backend, myorg/frontend"
              style={{ width: 240, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', font: 'inherit', fontSize: 13, color: 'var(--text)' }}
            />
          </VsRow>
          {ghRepoBrowse.length > 0 && (
            <VsRow title="Select from your repos" desc="">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {ghRepoBrowse.map(r => (
                  <button key={r} type="button" className="pill" style={{ cursor: 'pointer' }}
                    onClick={() => setGhRepos(v => v.trim() ? v.trim() + ', ' + r : r)}>
                    {r}
                  </button>
                ))}
              </div>
            </VsRow>
          )}
          <div className="set-row" style={{ gap: 8 }}>
            <button className="btn sm ghost" onClick={browseGhRepos}>Browse repos…</button>
            <span style={{ flex: 1 }}/>
            <button className="btn sm primary" onClick={saveGhRepos}>Save repos</button>
          </div>
        </React.Fragment>
      ),
    },
  ];

  const NAV = [
    { id: 'profile', label: 'Profile', icon: 'team' },
    { id: 'appearance', label: 'Appearance', icon: 'sun' },
    { id: 'planner', label: 'Planner', icon: 'planner' },
    { id: 'cards', label: 'Cards & Tables', icon: 'board' },
    { id: 'profiles', label: 'Profiles', icon: 'more' },
    { id: 'privacy', label: 'Confidential', icon: 'lock' },
    { id: 'data', label: 'Data & sync', icon: 'inbox' },
    { id: 'integrations', label: 'Integrations', icon: 'lock' },
    ...(window.electronAPI ? [{ id: 'desktop', label: 'Desktop app', icon: 'more' }] : []),
  ];

  const shownName = displayNameVal || me.name || '—';
  const initials = (shownName === '—' ? (me.name || '?') : shownName)
    .split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  const tzOptions = React.useMemo(() => vsTimeZones(), []);

  return (
    <div data-screen-label="Settings">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="sub">Profile, appearance, and planner preferences</div>
        </div>
      </div>
      <div className="set-layout">
        <div className="pl-rail" style={{ top: 16 }}>
          {NAV.map(n => (
            <button key={n.id} className={`pl-rail-item ${subPage === n.id ? 'active' : ''}`} onClick={() => setSubPage(n.id)}>
              <span className="ic"><Icon name={n.icon} size={14}/></span>{n.label}
            </button>
          ))}
        </div>
        <div style={{ minWidth: 0 }}>
          {subPage === 'profile' && (
            <VsCard title="Profile" icon="team">
              <div className="set-row" style={{ gap: 16 }}>
                {photo
                  ? <img className="set-avatar" src={photo} alt="" style={{ objectFit: 'cover' }}/>
                  : <span className="set-avatar">{initials}</span>}
                <div className="info">
                  <div className="t" style={{ fontSize: 15 }}>{shownName}</div>
                  <div className="d">{[me.email, profRole].filter(Boolean).join(' · ') || 'Identity from Azure DevOps'}</div>
                </div>
                <input ref={photoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPhotoPicked}/>
                <button className="btn sm" onClick={choosePhoto}>Change photo</button>
              </div>
              <div className="set-row">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, flex: 1 }}>
                  <PlFld label="Display name">
                    <input value={displayNameVal} placeholder={me.name || ''} onChange={e => setDisplayName(e.target.value)}/>
                  </PlFld>
                  <PlFld label="Role">
                    <input value={profRole} onChange={e => setProfRole(e.target.value)}/>
                  </PlFld>
                  <PlFld label="Team">
                    <input value={profTeam} placeholder="e.g. Platform & Billing" onChange={e => setProfTeam(e.target.value)}/>
                  </PlFld>
                  <PlFld label="Time zone">
                    <select value={profTz} onChange={e => setProfTz(e.target.value)}>
                      {!tzOptions.includes(profTz) && <option value={profTz}>{profTz}</option>}
                      {tzOptions.map(z => <option key={z} value={z}>{z}</option>)}
                    </select>
                  </PlFld>
                </div>
              </div>
              {!isManual && (
                <VsRow title="Azure DevOps account"
                  desc={me.email
                    ? `Connected as ${me.email}${me.org ? ` — ${me.org}` : ''}`
                    : 'Organisation, PAT, projects, email digest'}>
                  <span className="pill success"><span className="dot"></span>Connected</span>
                  <button className="btn sm ghost" onClick={onOpenConnection}>Manage</button>
                </VsRow>
              )}
              {!isManual && onOpenProjectAreas && (
                <VsRow title="Project areas" desc="The area tree used for triage and work-item classification">
                  <button className="btn sm ghost" onClick={onOpenProjectAreas}>Edit project areas</button>
                </VsRow>
              )}
            </VsCard>
          )}

          {subPage === 'appearance' && (
            <VsCard title="Appearance" icon="sun">
              <ThemeModeSettings tweaks={tweaks} setTweak={setTweak}/>
              <VsRow title="Density" desc="Row height and padding everywhere">
                <VsSeg value={tweaks.density}
                  options={[['compact', 'Compact'], ['balanced', 'Balanced'], ['cozy', 'Cozy']]}
                  onChange={v => setTweak('density', v)}/>
              </VsRow>
              <VsRow title="Sidebar" desc="Full labels or icons only">
                <VsSeg value={tweaks.sidebar}
                  options={[['labels', 'Labels'], ['icons', 'Icons']]}
                  onChange={v => setTweak('sidebar', v)}/>
              </VsRow>
              <VsRow title="Work-item type labels" desc="Show type names next to type icons in lists">
                <PlToggle checked={tweaks.typeLabels} onChange={v => setTweak('typeLabels', v)}/>
              </VsRow>
              <VsRow title="Markdown tab" desc="Show the Markdown viewer in the navigation">
                <PlToggle
                  checked={tweaks.showMarkdown !== false}
                  onChange={v => setTweak('showMarkdown', v)}
                />
              </VsRow>
              <VsRow title="Sprint progress" desc="Show the sprint burndown widget on the home page">
                <PlToggle
                  checked={!(tweaks.hiddenDashWidgets || []).includes('sprint')}
                  onChange={v => toggleDashWidget('sprint', v)}
                />
              </VsRow>
              <VsRow title="Blockers widget" desc="Show blocked work items on the home page">
                <PlToggle
                  checked={!(tweaks.hiddenDashWidgets || []).includes('blockers')}
                  onChange={v => toggleDashWidget('blockers', v)}
                />
              </VsRow>
              <VsRow title="PRs needing review" desc="Show pull requests waiting for your review on the home page">
                <PlToggle
                  checked={!(tweaks.hiddenDashWidgets || []).includes('needsme')}
                  onChange={v => toggleDashWidget('needsme', v)}
                />
              </VsRow>
              <VsRow title="Recent activity" desc="Show the team activity feed on the home page">
                <PlToggle
                  checked={!(tweaks.hiddenDashWidgets || []).includes('activity')}
                  onChange={v => toggleDashWidget('activity', v)}
                />
              </VsRow>
            </VsCard>
          )}

          {subPage === 'planner' && (
            <VsCard title="Planner preferences" icon="planner">
              <VsRow title="Landing view" desc="What you see when opening the Planner">
                <VsSeg value={plLanding}
                  options={[['glance', 'Week at a glance'], ['sections', 'Straight to sections']]}
                  onChange={setPlLanding}/>
              </VsRow>
              <VsRow title="Section navigation" desc="How planner sections are arranged on the page">
                <VsSeg value={plNav}
                  options={[['rail', 'Rail'], ['scroll', 'Scroll'], ['tabs', 'Tabs']]}
                  onChange={setPlNav}/>
              </VsRow>
              <VsRow title="Entry style" desc="How you add and edit rows in planner tables">
                <VsSeg value={plEntry}
                  options={[['inline', 'Inline'], ['quickadd', 'Quick-add'], ['drawer', 'Drawer']]}
                  onChange={setPlEntry}/>
              </VsRow>
              <VsRow title="Carry-over prompt" desc="Offer to pull unfinished items into a new week">
                <PlToggle checked={carryPrompt === '1'} onChange={v => setCarryPrompt(v ? '1' : '0')}/>
              </VsRow>
              <VsRow title="Notifications" desc="Weekly planning reminder, Monday 09:00">
                <PlToggle checked={notifWeekly === '1'} onChange={v => setNotifWeekly(v ? '1' : '0')}/>
              </VsRow>
              <VsRow title="1:1 reminders" desc="Nudge 30 minutes before a scheduled 1:1">
                <PlToggle checked={notifOneOnOne === '1'} onChange={v => setNotifOneOnOne(v ? '1' : '0')}/>
              </VsRow>
              <VsRow title="Friday digest" desc="End-of-week summary email of open items">
                <PlToggle checked={notifDigest === '1'} onChange={v => setNotifDigest(v ? '1' : '0')}/>
              </VsRow>
              <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-subtle)' }}>
                Navigation and entry style are also available from the <strong>View</strong> menu in the planner header. Changes apply next time the planner opens.
              </div>
            </VsCard>
          )}

          {subPage === 'cards' && <CardsAndTablesSettings />}

          {subPage === 'profiles' && (
            <>
              <VsProfiles profileApi={useProfile()} />
              <BackupRestoreCard fileIO={webFileIO} cloudProviders={webCloudProviders} />
              <CloudSyncCard controller={webSync} providers={webCloudProviders} fileIO={webFileIO} />
            </>
          )}

          {subPage === 'privacy' && (
            <VsCard title="Confidential sections" icon="lock">
              <VsRow title="Password" desc={confCfg.hash ? 'Set — protects confidential sections and rows' : 'Not set yet — created on first lock'}>
                <button className="btn sm" onClick={() => setPwOpen(true)}>{confCfg.hash ? 'Change password' : 'Set password'}</button>
              </VsRow>
              <VsRow title="Locked sections" desc="Marked confidential in the planner">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {confCfg.sections.length === 0
                    ? <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>None</span>
                    : confCfg.sections.map(id => <span key={id} className="pill"><Icon name="lock" size={10}/>&nbsp;{id}</span>)}
                </div>
              </VsRow>
              <VsRow title="Auto re-lock" desc="Lock confidential sections again after 15 minutes idle">
                <PlToggle checked={autoRelock === '1'} onChange={v => setAutoRelock(v ? '1' : '0')}/>
              </VsRow>
              <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-subtle)' }}>
                The password hash never leaves your browser; the locked-section list syncs to the server AES-encrypted with it.
              </div>
            </VsCard>
          )}

          {subPage === 'data' && (<>
            <VsCard title="Data & sync" icon="inbox">
              <VsRow title="Export this week" desc="Download as JSON or Word (.docx) from the planner header">
                <button className="btn sm" onClick={() => {
                  onGoPlanner?.();
                  toast?.('Open the Data menu in the planner header to export.', 'info');
                }}><Icon name="send" size={12}/> Open planner</button>
              </VsRow>
              <VsRow title="Versions" desc={`${storage.versions} snapshot${storage.versions !== 1 ? 's' : ''} of the current week, kept on this device`}>
                <button className="btn sm" onClick={() => {
                  onGoPlanner?.();
                  toast?.('Open the Data menu → Versions in the planner header.', 'info');
                }}>Manage versions</button>
              </VsRow>
              <VsRow title="Server sync" desc="Planner weeks and preferences sync via your signed-in session">
                <span className="pill success"><span className="dot"></span>Enabled</span>
              </VsRow>
              <VsRow title="Local storage" desc={`${storage.weeks} week${storage.weeks !== 1 ? 's' : ''} of planner data · ${storage.gNotes} note${storage.gNotes !== 1 ? 's' : ''} · ${storage.kb} KB`}>
                <button className="btn sm ghost danger" onClick={clearLocalData}>Clear local data</button>
              </VsRow>
            </VsCard>
          </>)}
          {subPage === 'desktop' && window.electronAPI && (
            <VsCard title="Desktop app" icon="more">
              <VsRow title="Start on login" desc="Launch Management Dashboard automatically when you log in">
                <PlToggle checked={loginItemEnabled} onChange={onLoginItemChange} />
              </VsRow>
              <VsRow title="Close to system tray" desc="Minimise to the system tray instead of exiting when you close the window">
                <PlToggle checked={closeToTray} onChange={onCloseToTrayChange} />
              </VsRow>
              <VsRow
                title="Output folder"
                desc={outputPath
                  ? outputPath
                  : 'Files are saved to your system Downloads folder'}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn sm ghost" onClick={pickOutputFolder}>Browse…</button>
                  {outputPath && (
                    <button className="btn sm ghost danger" onClick={clearOutputPath}>Clear</button>
                  )}
                </div>
              </VsRow>
            </VsCard>
          )}

          {subPage === 'integrations' && (
            <>
              <IntegrationsView services={oauthServices} />
              <GoogleConnectionCard />
            </>
          )}
        </div>
      </div>
      <VsPasswordModal open={pwOpen} onClose={() => setPwOpen(false)}/>
    </div>
  );
}

export { SettingsView }
