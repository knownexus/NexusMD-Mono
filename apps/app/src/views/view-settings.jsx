import React from 'react';
import { toast } from '../toast.jsx';
import { helmPushPref } from '../components.jsx';
import { HelmData } from '../data.jsx';
import { getProfileKey } from '../profile-keys.js';
import { Icon } from '../icons.jsx';
import { useProfile } from '../profile-context.jsx';
import { marked } from 'marked';
// view-settings.jsx — Settings & profile page (planner-redesign port)
// Works with the app's existing infrastructure:
//   - tweaks / setTweak        → helm.tweaks (theme, density, sidebar, typeLabels)
//   - onOpenConnection         → opens the existing SettingsModal (/api/config: org, PAT, SMTP…)
//   - HelmData.ME       → profile identity (name, email, org from Azure DevOps)
//   - helm.planner.*           → planner view prefs (same keys the planner View menu writes)
//   - window.helmConfidential  → password change (hashPassword/load/saveConfidentialConfig)
// Requires planner-ui.jsx (PlFld, PlModal) + helm-planner-v2.css.
const { useState: useStateVS, useMemo: useMemoVS, useRef: useRefVS } = React;

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

function PlToggle({ checked, onChange }) {
  return (
    <label className="tgl">
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span className="tr"></span>
      <span className="th"></span>
    </label>
  );
}

function VsRow({ title, desc, children }) {
  return (
    <div className="set-row">
      <div className="info">
        <div className="t">{title}</div>
        {desc && <div className="d">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

function VsCard({ title, icon, children }) {
  return (
    <div className="card set-card">
      <div className="card-head"><h3><span style={{ color: 'var(--text-subtle)', display: 'flex' }}><Icon name={icon} size={14}/></span>&nbsp;{title}</h3></div>
      <div className="card-body flush">{children}</div>
    </div>
  );
}

function VsFullRow({ title, desc, children }) {
  return (
    <div className="set-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
      <div className="info">
        <div className="t">{title}</div>
        {desc && <div className="d">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

function ThemeChipPicker({ value, onChange }) {
  const themes = window.HELM_THEMES || [];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, width: '100%' }}>
      {themes.map(t => {
        const active = value === t.id;
        return (
          <button key={t.id} type="button" onClick={() => onChange(t.id)} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
            padding: '7px 11px 6px', borderRadius: 8, cursor: 'pointer',
            border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
            background: active ? 'var(--accent-soft)' : 'var(--surface-2)',
            transition: 'border-color .12s, background .12s',
          }}>
            <div style={{ display: 'flex', gap: 3 }}>
              {t.swatch.map((c, i) => (
                <div key={i} style={{
                  width: 13, height: 13, borderRadius: '50%',
                  background: c, border: '1px solid rgba(0,0,0,.14)',
                  flexShrink: 0,
                }} />
              ))}
            </div>
            <div style={{
              fontSize: 11, fontWeight: active ? 600 : 500, lineHeight: 1,
              color: active ? 'var(--accent)' : 'var(--text-muted)',
            }}>
              {t.label}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function VsSeg({ value, options, onChange }) {
  return (
    <div className="pl-seg">
      {options.map(([v, l, ic]) => (
        <button key={v} className={value === v ? 'active' : ''} onClick={() => onChange(v)}>
          {ic && <Icon name={ic} size={12}/>}{l}
        </button>
      ))}
    </div>
  );
}

// ── Change-password modal (uses real hashing + re-encrypt) ────
function VsPasswordModal({ open, onClose }) {
  const [cur, setCur] = useStateVS('');
  const [pw, setPw] = useStateVS('');
  const [confirm, setConfirm] = useStateVS('');
  const [err, setErr] = useStateVS('');
  const [ok, setOk] = useStateVS('');
  const [busy, setBusy] = useStateVS(false);
  const cfg = window.helmConfidential?.loadConfidentialConfig?.() || { sections: [], hash: null };
  const hasExisting = !!cfg.hash;
  const handleClose = () => { setCur(''); setPw(''); setConfirm(''); setErr(''); setOk(''); onClose(); };

  const save = async () => {
    setErr(''); setOk('');
    if (!pw) { setErr('Enter a new password.'); return; }
    if (pw !== confirm) { setErr('New passwords do not match.'); return; }
    setBusy(true);
    try {
      const hc = window.helmConfidential;
      if (hasExisting) {
        const curHash = await hc.hashPassword(cur);
        if (curHash !== cfg.hash) { setErr('Current password is incorrect.'); setBusy(false); return; }
      }
      const newHash = await hc.hashPassword(pw);
      hc.saveConfidentialConfig({ ...cfg, hash: newHash });
      setOk(hasExisting ? 'Password changed.' : 'Password set.');
      setTimeout(handleClose, 900);
    } catch (e) {
      setErr('Could not save password.');
    } finally { setBusy(false); }
  };

  return (
    <PlModal open={open} onClose={handleClose} icon="lock"
      title={hasExisting ? 'Change confidential password' : 'Set confidential password'}
      sub="Protects sections and rows marked confidential"
      footer={(
        <React.Fragment>
          <button className="btn ghost" onClick={handleClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </React.Fragment>
      )}>
      {hasExisting && (
        <PlFld label="Current password">
          <input type="password" value={cur} autoFocus onChange={e => { setCur(e.target.value); setErr(''); }}/>
        </PlFld>
      )}
      <PlFld label="New password">
        <input type="password" value={pw} autoFocus={!hasExisting} onChange={e => { setPw(e.target.value); setErr(''); }}/>
      </PlFld>
      <PlFld label="Confirm new password">
        <input type="password" value={confirm} onChange={e => { setConfirm(e.target.value); setErr(''); }}
          onKeyDown={e => { if (e.key === 'Enter') save(); }}/>
      </PlFld>
      {err && <div className="plm-callout err">{err}</div>}
      {ok && <div className="plm-callout ok">{ok}</div>}
    </PlModal>
  );
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

// ── Profiles sub-page ─────────────────────────────────────────
const PROFILE_COLORS = [
  '#9a7e22', '#6c8ebf', '#7c7c7c', '#48b870',
  '#e05a2b', '#8098e0', '#b86078', '#c09040',
];

function VsProfileEditor({ profile, onSave, onDelete, onExport, onClose }) {
  const isNew = !profile;
  const [name, setName]       = useStateVS(profile?.name     || '');
  const [initials, setInit]   = useStateVS(profile?.initials || '');
  const [type, setType]       = useStateVS(profile?.type     || 'ado');
  const [color, setColor]     = useStateVS(profile?.color    || PROFILE_COLORS[0]);
  const [confirmDel, setConf] = useStateVS(false);

  const autoInit = name.trim().split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  const save = () => {
    if (!name.trim()) { toast?.('Name is required.', 'error'); return; }
    onSave({ name: name.trim(), initials: (initials.trim() || autoInit).toUpperCase().slice(0, 3), type, color });
  };

  return (
    <PlModal open onClose={onClose} icon="more"
      title={isNew ? 'New profile' : 'Edit profile'}
      footer={
        <React.Fragment>
          {!isNew && (
            <React.Fragment>
              <button className="btn sm ghost" onClick={() => onExport(profile.id)}>Export…</button>
              {confirmDel
                ? <button className="btn sm danger" onClick={() => onDelete(profile.id)}>Confirm delete</button>
                : <button className="btn sm ghost danger" onClick={() => setConf(true)}>Delete</button>}
            </React.Fragment>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Save</button>
        </React.Fragment>
      }>
      <PlFld label="Profile name">
        <input value={name} autoFocus onChange={e => setName(e.target.value)} />
      </PlFld>
      <PlFld label="Initials (2–3 chars)">
        <input value={initials} placeholder={autoInit} maxLength={3}
          onChange={e => setInit(e.target.value.toUpperCase())} />
      </PlFld>
      <PlFld label="Type">
        <div className="pl-seg">
          {[['ado', 'Azure DevOps'], ['manual', 'Manual']].map(([v, l]) => (
            <button key={v} className={type === v ? 'active' : ''} onClick={() => setType(v)}>{l}</button>
          ))}
        </div>
      </PlFld>
      <PlFld label="Colour">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PROFILE_COLORS.map(c => (
            <button key={c} type="button" onClick={() => setColor(c)} style={{
              width: 28, height: 28, borderRadius: '50%', background: c, border: 'none',
              outline: color === c ? '2px solid var(--accent)' : '2px solid transparent',
              outlineOffset: 2, cursor: 'pointer',
            }} />
          ))}
        </div>
      </PlFld>
    </PlModal>
  );
}

function VsProfiles() {
  const { profiles, activeId, switchProfile, createProfile, updateProfile, deleteProfile, exportProfile, importProfile } = useProfile();
  const [editing, setEditing]   = useStateVS(null);
  const importRef               = useRefVS(null);

  const handleSave = (changes) => {
    if (editing === 'new') {
      createProfile(changes);
    } else {
      updateProfile(editing.id, changes);
    }
    setEditing(null);
  };

  const handleDelete = (id) => {
    deleteProfile(id);
    setEditing(null);
  };

  return (
    <div className="card set-card">
      <div className="card-head">
        <h3><span style={{ color: 'var(--text-subtle)', display: 'flex' }}><Icon name="more" size={14}/></span>&nbsp;Profiles</h3>
        <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setEditing('new')}>+ New profile</button>
      </div>
      <div className="card-body flush">
        {profiles.map(p => (
          <div key={p.id} className="set-row">
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: p.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
              {p.initials}
            </div>
            <div className="info">
              <div className="t">{p.name}</div>
              <div className="d">{p.type === 'ado' ? 'Azure DevOps' : 'Manual — no DevOps'}</div>
            </div>
            {p.id === activeId
              ? <span className="pill success"><span className="dot"></span>Active</span>
              : <button className="btn sm ghost" onClick={() => switchProfile(p.id)}>Switch</button>}
            <button className="btn sm ghost" onClick={() => setEditing(p)}>Edit</button>
          </div>
        ))}
        <div className="set-row" style={{ opacity: .6, cursor: 'pointer' }} onClick={() => importRef.current?.click()}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', border: '1.5px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>↑</div>
          <div className="info"><div className="t">Import profile from file…</div></div>
        </div>
        <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) importProfile(f); e.target.value = ''; }} />
      </div>
      {editing && (
        <VsProfileEditor
          profile={editing === 'new' ? null : editing}
          onSave={handleSave}
          onDelete={handleDelete}
          onExport={exportProfile}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ── Settings page ─────────────────────────────────────────────
function SettingsView({ tweaks, setTweak, onOpenConnection, onOpenProjectAreas, onGoPlanner }) {
  const [subPage, setSubPage] = useStateVS('profile');
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
    { id: 'profile', label: 'Profile', icon: 'team' },
    { id: 'appearance', label: 'Appearance', icon: 'sun' },
    { id: 'planner', label: 'Planner', icon: 'planner' },
    { id: 'profiles', label: 'Profiles', icon: 'more' },
    { id: 'privacy', label: 'Confidential', icon: 'lock' },
    { id: 'data', label: 'Data & sync', icon: 'inbox' },
  ];

  const shownName = displayName || me.name || '—';
  const initials = (shownName === '—' ? (me.name || '?') : shownName)
    .split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  const tzOptions = useMemoVS(() => vsTimeZones(), []);

  return (
    <React.Fragment>
      <div className="m-appbar">
        <div className="m-ab-lead">
          <h1>Settings</h1>
          <div className="m-ab-sub">Profile, appearance, and planner preferences</div>
        </div>
        <div className="m-ab-actions">
        </div>
      </div>
      <div className="m-screen" data-screen-label="Settings">
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
              {!isManual && onOpenProjectAreas && (
                <VsRow title="Project areas" desc="The area tree used for triage and work-item classification">
                  <button className="btn sm ghost" onClick={onOpenProjectAreas}>Edit project areas</button>
                </VsRow>
              )}
            </VsCard>
          )}

          {subPage === 'appearance' && (
            <VsCard title="Appearance" icon="sun">
              <VsRow title="Mode" desc="Toggle between your assigned light and dark themes">
                <VsSeg value={tweaks.theme}
                  options={[['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']]}
                  onChange={v => setTweak('theme', v)}/>
              </VsRow>
              <VsFullRow title="Light mode theme" desc="Palette used when light mode is active">
                <ThemeChipPicker value={tweaks.lightTheme || 'parchment'} onChange={v => setTweak('lightTheme', v)}/>
              </VsFullRow>
              <VsFullRow title="Dark mode theme" desc="Palette used when dark mode is active">
                <ThemeChipPicker value={tweaks.darkTheme || 'cobalt'} onChange={v => setTweak('darkTheme', v)}/>
              </VsFullRow>
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

          {subPage === 'profiles' && <VsProfiles />}

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

          {subPage === 'data' && (
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
        </div>
      </div>
      <VsPasswordModal open={pwOpen} onClose={() => setPwOpen(false)}/>
      </div>
    </React.Fragment>
  );
}

export { SettingsView };


