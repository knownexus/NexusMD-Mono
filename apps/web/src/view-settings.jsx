// view-settings.jsx — Settings & profile page (planner-redesign port)
// Works with the app's existing infrastructure:
//   - tweaks / setTweak        → nexusmd.tweaks (theme, density, sidebar, typeLabels)
//   - onOpenConnection         → opens the existing SettingsModal (/api/config: org, PAT, SMTP…)
//   - NexusMDData.ME       → profile identity (name, email, org from Azure DevOps)
//   - nexusmd.planner.*        → planner view prefs (same keys the planner View menu writes)
//   - confidential.jsx           → password change (hashPassword/load/saveConfidentialConfig)
// Requires planner-ui.jsx (PlFld, PlModal) + nexusmd-planner-v2.css.
import React, { useState as useStateVS, useEffect as useEffectVS, useRef as useRefVS, useCallback as useCallbackVS } from 'react'
import { NexusMDData, NexusMDApi } from './data.js';
import { Drawer, nexusMDPushPref } from './components.jsx'
import { Icon } from './icons.jsx'
import { PlFld, PlModal } from './planner-ui.jsx'
import { activeProfileId, updateSettings, weekKey, PlannerSync } from './planner-sync.js'
import { displayName } from './MarkdownViewer.jsx'
import { getProfileKey } from './profile-keys.js'
import { loadConfidentialConfig, saveConfidentialConfig, hashPassword } from './confidential.jsx'
import { useProfile } from './profile-context.jsx'
import { toast } from './toast.jsx'
import { GoogleAuth } from './google-auth.js'
import { GitHubClient } from './github-client.js'

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
  const themes = window.NEXUSMD_THEMES || [];
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
  const cfg = loadConfidentialConfig() || { sections: [], hash: null };
  const hasExisting = !!cfg.hash;
  const handleClose = () => { setCur(''); setPw(''); setConfirm(''); setErr(''); setOk(''); onClose(); };

  const save = async () => {
    setErr(''); setOk('');
    if (!pw) { setErr('Enter a new password.'); return; }
    if (pw !== confirm) { setErr('New passwords do not match.'); return; }
    setBusy(true);
    try {
      if (hasExisting) {
        const curHash = await hashPassword(cur);
        if (curHash !== cfg.hash) { setErr('Current password is incorrect.'); setBusy(false); return; }
      }
      const newHash = await hashPassword(pw);
      saveConfidentialConfig({ ...cfg, hash: newHash });
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
  return zones || fallback;
}

// ── Profiles sub-page ─────────────────────────────────────────
const PROFILE_COLORS = [
  '#9a7e22', '#6c8ebf', '#7c7c7c', '#48b870',
  '#e05a2b', '#8098e0', '#b86078', '#c09040',
];

function VsProfileEditor({ profile, onSave, onDelete, onExport, onClose }) {
  const isNew = !profile;
  const [name, setName]         = useStateVS(profile?.name       || '');
  const [initials, setInit]     = useStateVS(profile?.initials   || '');
  const [type, setType]         = useStateVS(profile?.type       || 'ado');
  const [color, setColor]       = useStateVS(profile?.color      || PROFILE_COLORS[0]);
  const [orgLabel, setOrgLabel] = useStateVS(profile?.orgLabel   || '');
  const [confirmDel, setConf]   = useStateVS(false);

  const autoInit = name.trim().split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  const save = () => {
    if (!name.trim()) { toast?.('Name is required.', 'error'); return; }
    onSave({ name: name.trim(), initials: (initials.trim() || autoInit).toUpperCase().slice(0, 3), type, color, orgLabel: orgLabel.trim() });
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
      <PlFld label="Organisation label" hint="Shown under the app name in the sidebar — leave blank to use the Azure DevOps org name">
        <input value={orgLabel} placeholder="e.g. msl-cirrus" onChange={e => setOrgLabel(e.target.value)} />
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

// ── Drive backup / restore card ────────────────────────────────
function DriveSyncCard() {
  const [files,     setFiles]     = useStateVS([]);
  const [loading,   setLoading]   = useStateVS(false);
  const [uploading, setUploading] = useStateVS(false);
  const [error,     setError]     = useStateVS(null);

  const getToken = () => GoogleAuth?.getAuth()?.accessToken ?? null;

  const loadFiles = () => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    fetch(`/api/google/drive/files?token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(12_000) })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => { setFiles(data); setLoading(false); })
      .catch(err => { setError(String(err)); setLoading(false); });
  };

  useEffectVS(() => { loadFiles(); }, []);

  const backup = async () => {
    const token = getToken();
    if (!token) { toast?.('Google not connected.', 'error'); return; }
    setUploading(true);
    try {
      // Collect all profile-namespaced planner data + prefs
      const activeId = localStorage.getItem('nexusmd.activeProfileId') || '';
      const snap = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith(`nexusmd.p.${activeId}`) || k.startsWith('nexusmd.profiles') || k === 'nexusmd.activeProfileId')) {
          snap[k] = localStorage.getItem(k);
        }
      }
      const data = JSON.stringify({ exportedAt: new Date().toISOString(), profileId: activeId, snap });
      const res = await fetch('/api/google/drive/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, data }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(res.status);
      toast?.('Backup saved to Google Drive.', 'success');
      loadFiles();
    } catch (err) {
      toast?.(`Backup failed: ${err}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  const restore = async (fileId) => {
    const token = getToken();
    if (!token) return;
    const sure = window.confirm('Restore this backup? Your current local data will be overwritten.');
    if (!sure) return;
    try {
      const res = await fetch(`/api/google/drive/restore/${encodeURIComponent(fileId)}?token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(res.status);
      const { snap } = await res.json();
      Object.entries(snap || {}).forEach(([k, v]) => { try { localStorage.setItem(k, v); } catch {} });
      toast?.('Backup restored. Reloading…', 'success');
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      toast?.(`Restore failed: ${err}`, 'error');
    }
  };

  const deleteFile = async (fileId) => {
    const token = getToken();
    if (!token) return;
    if (!window.confirm('Delete this backup from Google Drive?')) return;
    try {
      await fetch(`/api/google/drive/files/${encodeURIComponent(fileId)}?token=${encodeURIComponent(token)}`, { method: 'DELETE', signal: AbortSignal.timeout(10_000) });
      setFiles(f => f.filter(x => x.id !== fileId));
      toast?.('Backup deleted.', 'success');
    } catch {
      toast?.('Delete failed.', 'error');
    }
  };

  if (!GoogleAuth?.isConnected()) return null;

  return (
    <VsCard title="Google Drive Backup" icon="inbox">
      {error && <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
      <div className="set-row" style={{ gap: 8 }}>
        <button className="btn sm ghost" onClick={loadFiles} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        <span style={{ flex: 1 }}/>
        <button className="btn sm primary" onClick={backup} disabled={uploading}>{uploading ? 'Saving…' : 'Backup now'}</button>
      </div>
      {files.length === 0 && !loading && (
        <div style={{ padding: '12px 14px', fontSize: 12.5, color: 'var(--text-subtle)' }}>No backups yet. Click "Backup now" to create one.</div>
      )}
      {files.map(f => {
        const date = f.modifiedTime ? new Date(f.modifiedTime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '';
        const kb   = f.size ? Math.round(Number(f.size) / 1024) + ' KB' : '';
        return (
          <div key={f.id} className="set-row" style={{ gap: 8 }}>
            <div className="info" style={{ flex: 1 }}>
              <div className="t" style={{ fontSize: 12.5 }}>{f.name}</div>
              <div className="d">{date}{kb ? ` · ${kb}` : ''}</div>
            </div>
            <button className="btn sm ghost" onClick={() => restore(f.id)}>Restore</button>
            <button className="btn sm ghost danger" onClick={() => deleteFile(f.id)}>Delete</button>
          </div>
        );
      })}
    </VsCard>
  );
}

// ── Planner Sync Card ─────────────────────────────────────────
const FREQ_PRESETS = [
  [15,  'Every 15 min'],
  [60,  'Every hour'],
  [360, 'Every 6 hours'],
  [1440,'Daily'],
];

function PlannerConflictModal({ conflict, onKeepMine, onUseDrive, onCancel }) {
  if (!conflict) return null;
  const wkLabel = (() => {
    const [yearStr, weekStr] = conflict.weekKey.split('-W');
    const year = parseInt(yearStr, 10);
    const week = parseInt(weekStr, 10);
    const monday = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() || 7) + 1);
    const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
    const fmt = d => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `Week ${week} — ${fmt(monday)}–${fmt(sunday)}`;
  })();

  return (
    <PlModal open icon="alert"
      title="Planner sync conflict"
      sub={wkLabel}
      onClose={onCancel}
      footer={(
        <React.Fragment>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn ghost" onClick={onUseDrive}>Use Drive version</button>
          <button className="btn primary" onClick={onKeepMine}>Keep mine</button>
        </React.Fragment>
      )}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '4px 0' }}>
        {[
          { label: 'This device', version: conflict.localVersion },
          { label: 'Google Drive', version: conflict.driveVersion },
        ].map(({ label, version }) => (
          <div key={label} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-subtle)', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 12.5 }}>Version {version}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-subtle)', padding: '4px 0' }}>
        Both copies have unsynchronised changes. Choose which version to keep. The other will be overwritten.
      </div>
    </PlModal>
  );
}

function PlannerSyncCard() {
  const [settings, setSettingsState] = useStateVS(() => {
    try {
      const raw = localStorage.getItem(getProfileKey?.('planner.sync'));
      return raw ? { localEnabled: false, localFolder: '', driveEnabled: false, intervalMinutes: 60, ...JSON.parse(raw) } : { localEnabled: false, localFolder: '', driveEnabled: false, intervalMinutes: 60 };
    } catch { return { localEnabled: false, localFolder: '', driveEnabled: false, intervalMinutes: 60 }; }
  });
  const [status,     setStatus]     = useStateVS({ state: 'idle', lastSynced: null, conflicts: [] });
  const [conflict,   setConflict]   = useStateVS(null);  // currently-shown conflict
  const [customOpen, setCustomOpen] = useStateVS(settings.intervalMinutes > 0 && !FREQ_PRESETS.find(([m]) => m === settings.intervalMinutes));
  const [customVal,  setCustomVal]  = useStateVS(String(settings.intervalMinutes));
  const [bootstrapping, setBootstrapping] = useStateVS(false);

  useEffectVS(() => {
    const handler = e => {
      setStatus(e.detail);
      if (e.detail.bootstrapping === false) setBootstrapping(false);
      if (e.detail.bootstrapping === true)  setBootstrapping(true);
    };
    document.addEventListener('nexusmd:planner-sync-status', handler);
    return () => document.removeEventListener('nexusmd:planner-sync-status', handler);
  }, []);

  const applySettings = (next) => {
    setSettingsState(next);
    PlannerSync?.updateSettings(next);
  };

  const toggle = (field) => {
    const next = { ...settings, [field]: !settings[field] };
    applySettings(next);
  };

  const pickFolder = async () => {
    const picked = await window.electronAPI?.pickOutputFolder();
    if (picked) applySettings({ ...settings, localEnabled: true, localFolder: picked });
  };

  const setFreq = (minutes) => {
    const isCustom = !FREQ_PRESETS.find(([m]) => m === minutes);
    setCustomOpen(isCustom);
    applySettings({ ...settings, intervalMinutes: minutes });
  };

  const applyCustomFreq = () => {
    const v = parseInt(customVal, 10);
    if (v > 0) applySettings({ ...settings, intervalMinutes: v });
  };

  const openConflict = (c) => setConflict(c);

  const resolveConflict = async (choice) => {
    if (!conflict) return;
    setConflict(null);
    await PlannerSync?.resolveConflict(conflict.weekKey, choice);
  };

  const statusText = () => {
    const { state, lastSynced, conflicts } = status;
    if (state === 'conflict') {
      const c = (conflicts || [])[0];
      return c ? (
        <button className="btn sm ghost danger" onClick={() => openConflict(c)} style={{ fontWeight: 600 }}>
          Conflict on {c.weekKey} — tap to resolve
        </button>
      ) : 'Conflict detected';
    }
    if (state === 'syncing')      return bootstrapping ? 'Importing from Drive…' : 'Syncing…';
    if (state === 'offline')      return 'Offline — saving locally';
    if (state === 'disconnected') return 'Google disconnected';
    if (state === 'error')        return `Sync error — will retry`;
    if (lastSynced) {
      const d = new Date(lastSynced);
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `Last synced: ${isToday ? 'Today' : d.toLocaleDateString([], { dateStyle: 'short' })} at ${time}`;
    }
    return 'Never synced';
  };

  const isCustomFreq = !FREQ_PRESETS.find(([m]) => m === settings.intervalMinutes);
  const googleConnected = !!GoogleAuth?.isConnected?.();

  return (
    <VsCard title="Planner Sync" icon="send">
      {/* Local folder */}
      <VsRow title="Save to local folder" desc={settings.localFolder || 'No folder selected'}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {window.electronAPI && (
            <button className="btn sm ghost" onClick={pickFolder}>Browse…</button>
          )}
          <PlToggle
            checked={settings.localEnabled}
            onChange={() => {
              if (!settings.localEnabled && !settings.localFolder && window.electronAPI) {
                pickFolder();
              } else {
                toggle('localEnabled');
              }
            }}
          />
        </div>
      </VsRow>

      {/* Google Drive */}
      <VsRow
        title="Save to Google Drive"
        desc={googleConnected ? 'Syncs to your Google Drive app folder' : 'Connect Google to enable'}>
        {googleConnected
          ? <PlToggle checked={settings.driveEnabled} onChange={() => toggle('driveEnabled')} />
          : <span className="pill muted">Not connected</span>
        }
      </VsRow>

      {/* Sync frequency (only shown when either is enabled) */}
      {(settings.localEnabled || settings.driveEnabled) && (
        <VsFullRow title="Sync frequency" desc="How often to check for changes">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {FREQ_PRESETS.map(([minutes, label]) => (
              <button
                key={minutes}
                className={`btn sm ${settings.intervalMinutes === minutes && !isCustomFreq ? 'primary' : 'ghost'}`}
                onClick={() => setFreq(minutes)}>
                {label}
              </button>
            ))}
            <button
              className={`btn sm ${isCustomFreq ? 'primary' : 'ghost'}`}
              onClick={() => { setCustomOpen(true); }}>
              Custom
            </button>
          </div>
          {(customOpen || isCustomFreq) && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
              <input
                type="number" min="1" className="plf-input" style={{ width: 80 }}
                value={customVal}
                onChange={e => setCustomVal(e.target.value)}
                onBlur={applyCustomFreq}
                onKeyDown={e => { if (e.key === 'Enter') applyCustomFreq(); }}
              />
              <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>minutes</span>
            </div>
          )}
        </VsFullRow>
      )}

      {/* Status line */}
      <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text-subtle)', borderTop: '1px solid var(--border)' }}>
        {statusText()}
      </div>

      <PlannerConflictModal
        conflict={conflict}
        onKeepMine={() => resolveConflict('mine')}
        onUseDrive={() => resolveConflict('drive')}
        onCancel={() => setConflict(null)}
      />
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

  const NAV = [
    { id: 'profile', label: 'Profile', icon: 'team' },
    { id: 'appearance', label: 'Appearance', icon: 'sun' },
    { id: 'planner', label: 'Planner', icon: 'planner' },
    { id: 'profiles', label: 'Profiles', icon: 'more' },
    { id: 'privacy', label: 'Confidential', icon: 'lock' },
    { id: 'data', label: 'Data & sync', icon: 'inbox' },
    ...(!isManual ? [{ id: 'connection', label: 'Connection', icon: 'inbox' }] : []),
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
            <DriveSyncCard />
            <PlannerSyncCard />
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

          {subPage === 'connection' && !isManual && (<>
            {useProfile?.()?.activeProfile?.type === 'github'
              ? <GitHubConnectionTab activeProfile={useProfile().activeProfile} />
              : (
                <VsCard title="Azure DevOps Connection" icon="inbox">
                  <VsRow title="Connection settings" desc="Org, PAT, projects, and email digest">
                    <button className="btn sm ghost" onClick={onOpenConnection}>Manage connection</button>
                  </VsRow>
                </VsCard>
              )
            }
            <GoogleConnectionCard />
          </>)}
        </div>
      </div>
      <VsPasswordModal open={pwOpen} onClose={() => setPwOpen(false)}/>
    </div>
  );
}

export { SettingsView }
