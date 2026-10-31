import React from 'react';
import { toast } from '../toast.jsx';
import { helmPushPref } from '../components.jsx';
import { HelmData } from '../data.jsx';
import { getProfileKey } from '../profile-keys.js';
import { Icon } from '../icons.jsx';
import { useProfile } from '../profile-context.jsx';
import { marked } from 'marked';
import { WORK_SCREENS, useOffScreens, setOffScreens } from '../work-screens.js';
import {
  PlToggle, VsRow, VsCard, VsFullRow, ThemeModeSettings, VsSeg, VsPasswordModal, VsProfiles, BackupRestoreCard, CloudSyncCard,
  IntegrationsView,
} from '@nexusmd/ui';
import { appFileIO } from '../file-io.js';
import { appCloudProviders, makeAppOAuthService } from '../cloud-auth.js';
import { appSync } from '../sync.js';
import { getAdoConfig } from '../ado-client.js';
import { getJiraConfig } from '../jira-client.js';
import { getGithubConfig } from '../github-client.js';
import { appQueue } from '../offline-queue-app.js';
import { syncLabel } from '../sync-status.js';
import { connectionsSummary, privacySummary, dataSummary } from '../settings-summary.js';
// view-settings.jsx — Settings & profile page (planner-redesign port)
// Works with the app's existing infrastructure:
//   - tweaks / setTweak        → helm.tweaks (theme, density, sidebar, typeLabels)
//   - onOpenConnection         → opens the existing SettingsModal (/api/config: org, PAT, SMTP…)
//   - HelmData.ME       → profile identity (name, email, org from Azure DevOps)
//   - helm.planner.*           → planner view prefs (same keys the planner View menu writes)
//   - window.helmConfidential  → password change (hashPassword/load/saveConfidentialConfig)
// Requires planner-ui.jsx (PlFld, PlModal) + @nexusmd/ui planner-v2.css.
const { useState: useStateVS, useMemo: useMemoVS, useRef: useRefVS, useEffect: useEffectVS } = React;

// Local pref hook — persists to localStorage and pushes to server prefs.
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
    helmPushPref?.(key, v);
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
  const result = zones || fallback;
  return result;
}

function SettingsView({ tweaks, setTweak, onWorkScreensChanged, onOpenConnection, onOpenJira, onOpenGithub, onOpenProjectAreas, onGoPlanner }) {
  // Phone: a grouped list of categories, each opening as its own page. Wider screens keep the rail.
  const [phone, setPhone] = useStateVS(() => window.matchMedia('(max-width:600px)').matches);
  useEffectVS(() => {
    const mq = window.matchMedia('(max-width:600px)');
    const h = e => setPhone(e.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  const [subPage, setSubPage] = useStateVS(() => (window.matchMedia('(max-width:600px)').matches ? null : 'profile'));
  const page = subPage || (phone ? null : 'profile');
  const offScreens = useOffScreens();
  const [pwOpen, setPwOpen] = useStateVS(false);
  const isManual = useProfile?.()?.activeProfile?.type === 'manual';
  const photoInputRef = useRefVS(null);

  const toggleDashWidget = (id, shown) => {
    const current = tweaks.hiddenDashWidgets || [];
    setTweak('hiddenDashWidgets', shown
      ? current.filter(x => x !== id)
      : [...current, id]
    );
  };

  // Profile fields (persisted locally; identity defaults come from Azure DevOps)
  const me = HelmData?.ME || {};
  const browserTz = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_) { return 'UTC'; }
  })();
  const [displayName, setDisplayName] = usePrefVS('helm.profile.displayName', me.name || '');
  const [profRole, setProfRole] = usePrefVS('helm.profile.role', me.role || 'Engineering Manager');
  const [profTeam, setProfTeam] = usePrefVS('helm.profile.team', '');
  const [profTz, setProfTz] = usePrefVS('helm.profile.timeZone', browserTz);
  // Photo stays localStorage-only (data URL — too large for the pref sync endpoint)
  const [photo, setPhoto] = useStateVS(() => {
    try { return localStorage.getItem(getProfileKey('helm.profile.photo')) || ''; } catch (_) { return ''; }
  });

  // Planner prefs (same keys the planner header View menu writes)
  const [plLanding, setPlLanding] = usePrefVS('helm.planner.landing', 'glance');
  const [plNav, setPlNav] = usePrefVS('helm.planner.nav', 'rail');
  const [plEntry, setPlEntry] = usePrefVS('helm.planner.entry', 'inline');
  const [carryPrompt, setCarryPrompt] = usePrefVS('helm.planner.carryPrompt', '1');

  // Notifications
  const [notifWeekly, setNotifWeekly] = usePrefVS('helm.notif.weekly', '1');
  const [notifOneOnOne, setNotifOneOnOne] = usePrefVS('helm.notif.oneOnOne', '1');
  const [notifDigest, setNotifDigest] = usePrefVS('helm.notif.digest', '0');

  // Confidential
  const [autoRelock, setAutoRelock] = usePrefVS('helm.confidential.autoRelock', '0');
  const confCfg = window.helmConfidential?.loadConfidentialConfig?.() || { sections: [], hash: null };

  const [appOAuthServices] = useStateVS(() => [
    {
      id: 'ado',
      label: 'Azure DevOps',
      icon: 'inbox',
      desc: 'OAuth 2.0 — work items, PRs, pipelines',
      ...makeAppOAuthService('ado'),
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
      ...makeAppOAuthService('microsoft'),
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
      ...makeAppOAuthService('github'),
      credFields: [
        { key: 'clientId', label: 'Client ID', hint: 'From GitHub → Settings → Developer settings → OAuth Apps' },
        { key: 'clientSecret', label: 'Client Secret', secret: true },
      ],
    },
  ]);

  const [storageBump, setStorageBump] = useStateVS(0);
  const storage = useMemoVS(() => {
    let weeks = 0, bytes = 0, versions = 0, gNotes = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const activeId = localStorage.getItem('helm.activeProfileId') || '';
        const plannerPrefix = activeId ? `helm.p.${activeId}.planner` : 'helm.planner';
        if (!k || !k.startsWith(plannerPrefix)) continue;
        const v = localStorage.getItem(k) || '';
        bytes += k.length + v.length;
        if (k.startsWith(plannerPrefix + '.week.')) weeks++;
        if (k === plannerPrefix + '.versions') { try { versions = JSON.parse(v).length; } catch {} }
        if (k === plannerPrefix + '.globalNotes') { try { gNotes = JSON.parse(v).length; } catch {} }
      }
    } catch {}
    const summary = { weeks, kb: Math.round(bytes / 102.4) / 10, versions, gNotes };
    return summary;
  }, [subPage, storageBump]);

  const choosePhoto = () => photoInputRef.current?.click();
  const onPhotoPicked = (e) => {
    const file = e.target.files?.[0];
    if (!file) { return; }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      setPhoto(url);
      try { localStorage.setItem(getProfileKey('helm.profile.photo'), url); } catch (_) {
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
      const doomed = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const activeId = localStorage.getItem('helm.activeProfileId') || '';
        const plannerPrefix = activeId ? `helm.p.${activeId}.planner` : 'helm.planner';
        if (k && k.startsWith(plannerPrefix)) { doomed.push(k); }
      }
      doomed.forEach(k => localStorage.removeItem(k));
      toast?.('Local planner data cleared.', 'success');
    } catch (_) {
      toast?.('Could not clear local data.', 'error');
    }
    setStorageBump(n => n + 1);
  };

  const NAV = [
    { id: 'profile',      label: 'Profile',      icon: 'team' },
    { id: 'appearance',   label: 'Appearance',   icon: 'sun' },
    { id: 'planner',      label: 'Planner',      icon: 'planner' },
    { id: 'profiles',     label: 'Profiles',     icon: 'more' },
    { id: 'privacy',      label: 'Confidential', icon: 'lock' },
    { id: 'data',         label: 'Data & sync',  icon: 'inbox' },
    { id: 'integrations', label: 'Integrations', icon: 'lock' },
  ];

  const SUMMARY = {
    profile:      () => [displayName || (/^loading/i.test(me.name || '') ? '' : me.name), profRole].filter(Boolean).join(' · ') || 'Name, role, time zone',
    appearance:   () => `Theme and ${tweaks.density || 'balanced'} density`,
    planner:      () => 'Landing page, navigation, entry style',
    profiles:     () => 'Switch or add profiles',
    privacy:      () => privacySummary({ hasPassword: !!confCfg.hash, autoRelock }),
    data:         () => dataSummary({ pending: appQueue.count(), loadedLabel: syncLabel(HelmData?.loadedAt) }),
    integrations: () => connectionsSummary({ ado: getAdoConfig(), jira: getJiraConfig(), github: getGithubConfig() }),
  };
  const shownName = displayName || me.name || '—';
  const initials = (shownName === '—' ? (me.name || '?') : shownName)
    .split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  const tzOptions = useMemoVS(() => vsTimeZones(), []);

  return (
    <React.Fragment>
      <div className="m-appbar">
        {phone && page && (
          <button type="button" className="m-iconbtn" aria-label="Back to settings" onClick={() => setSubPage(null)}>
            <Icon name="chevron-left" size={18}/>
          </button>
        )}
        <div className="m-ab-lead">
          <div>
            <h1>{phone && page ? (NAV.find(n => n.id === page)?.label || 'Settings') : 'Settings'}</h1>
            {!(phone && page) && <div className="m-ab-sub">Profile, appearance, and planner preferences</div>}
          </div>
        </div>
        <div className="m-ab-actions">
        </div>
      </div>
      <div className="m-screen" data-screen-label="Settings">
      {phone && !page && (
        <div className="m-card flush">
          {NAV.map(n => (
            <div key={n.id} className="m-row" onClick={() => setSubPage(n.id)}>
              <span className="m-fileic"><Icon name={n.icon} size={17}/></span>
              <div className="m-row-main">
                <div className="m-row-title">{n.label}</div>
                <div className="m-row-sub">{SUMMARY[n.id]?.()}</div>
              </div>
              <Icon name="chevron-right" size={16} className="chev"/>
            </div>
          ))}
        </div>
      )}
      {!(phone && !page) && <div className="set-layout">
        {!phone && <div className="pl-rail" style={{ top: 16 }}>
          {NAV.map(n => (
            <button key={n.id} className={`pl-rail-item ${subPage === n.id ? 'active' : ''}`} onClick={() => setSubPage(n.id)}>
              <span className="ic"><Icon name={n.icon} size={14}/></span>{n.label}
            </button>
          ))}
        </div>}
        <div style={{ minWidth: 0 }}>
          {page === 'profile' && (
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
                    <input value={displayName} placeholder={me.name || ''} onChange={e => setDisplayName(e.target.value)}/>
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
              {!isManual && onOpenJira && (
                <VsRow title="Jira account" desc="Site, email, API token and projects">
                  <button className="btn sm ghost" onClick={onOpenJira}>Manage</button>
                </VsRow>
              )}
              {!isManual && onOpenGithub && (
                <VsRow title="GitHub account" desc="Token, repositories, issues, pull requests and Actions runs">
                  <button className="btn sm ghost" onClick={onOpenGithub}>Manage</button>
                </VsRow>
              )}
              {!isManual && onOpenProjectAreas && (
                <VsRow title="Project areas" desc="The area tree used for triage and work-item classification">
                  <button className="btn sm ghost" onClick={onOpenProjectAreas}>Edit project areas</button>
                </VsRow>
              )}
            </VsCard>
          )}

          {page === 'appearance' && (
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
              {WORK_SCREENS.map(s => (
                <VsRow key={s.id} title={`${s.label} screen`} desc="Show it in the navigation; switching it off also stops loading its data">
                  <PlToggle checked={!offScreens.includes(s.id)}
                    onChange={on => { setOffScreens(on ? offScreens.filter(x => x !== s.id) : [...offScreens, s.id]); onWorkScreensChanged?.(); }}/>
                </VsRow>
              ))}
              <VsRow title="Documents tab" desc="Show Markdown, JSON editor and Regex tester in the navigation">
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

          {page === 'planner' && (
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

          {page === 'profiles' && (
            <>
              <VsProfiles profileApi={useProfile()} showOrgLabel={false} />
              <BackupRestoreCard fileIO={appFileIO} showExportSingle={true} cloudProviders={appCloudProviders} />
              <CloudSyncCard controller={appSync} providers={appCloudProviders} fileIO={appFileIO} />
            </>
          )}

          {page === 'privacy' && (
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

          {page === 'data' && (
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
          )}

          {page === 'integrations' && (
            <IntegrationsView services={appOAuthServices} />
          )}
        </div>
      </div>}
      <VsPasswordModal open={pwOpen} onClose={() => setPwOpen(false)}/>
      </div>
    </React.Fragment>
  );
}

export { SettingsView };


