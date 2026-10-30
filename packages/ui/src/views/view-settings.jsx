// view-settings.jsx — shared Settings form/profile primitives (web + app). The
// SettingsView page + integration cards (Google/GitHub/Drive/PlannerSync) stay
// per-platform; these 9 building blocks were byte-identical bar a few seams:
// ThemeChipPicker reads the shared theme registry (themes.js); VsPasswordModal
// uses the shared confidential helpers; VsProfileEditor/VsProfiles take a
// showOrgLabel flag (web shows an org-label field, the app hides it); VsProfiles
// takes the profile API as a prop (each platform's profile-context useProfile()).
import React from 'react';
import { Icon } from '../icons.jsx';
import { NEXUSMD_THEMES, THEME_MODES } from '../themes.js';
import { PlFld, PlModal } from '../planner-chips.jsx';
import { toast } from '../toast.jsx';
import { hashPassword, loadConfidentialConfig, saveConfidentialConfig } from '../planner/planner-confidential.js';
import { useProfile } from '../profile-context.jsx';
import { useNexusData } from '../data-context.jsx';
import { usePersisted } from '../app-components.jsx';
import { reorderColumns, toggleColumnHidden, addManualColumn, removeAutoAdded, resetToDetected, resolveFields, reorderField, toggleField, defaultConfig, WI_CARD_FIELDS, WI_TABLE_COLUMNS, PR_CARD_FIELDS, BUILDS_TABLE_COLUMNS, TESTS_TABLE_COLUMNS } from '@nexusmd/core';
import { WI_TYPE_STATES_CACHE_KEY } from './wi-cache-key.js';

const { useState: useStateVS, useEffect: useEffectVS, useRef: useRefVS, useCallback: useCallbackVS } = React;

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

// Which Settings sections are collapsed: one list of section ids, kept for this machine rather than
// per profile (it is how the page is laid out, not a setting). Read and written in full each time
// so cards collapsed on different tabs never overwrite each other.
const COLLAPSED_KEY = 'nexusmd.settings.collapsed';
function readCollapsed() {
  try {
    const ids = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]');
    return Array.isArray(ids) ? ids : [];
  } catch { return []; }
}
function writeCollapsed(id, collapsed) {
  try {
    const ids = readCollapsed().filter(x => x !== id);
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed ? [...ids, id] : ids));
  } catch { /* storage unavailable: the section still collapses for this visit */ }
}

// A Settings section. Its title bar collapses and expands it, and that is remembered by `id`
// (the title by default). A collapsed section stays mounted, so a half-typed field survives it.
// `actions` sit at the right of the title bar; `flush` drops the body padding for rows (VsRow).
function VsCard({ title, icon, children, id, actions, flush = true }) {
  const key = id || (typeof title === 'string' ? title : '');
  const [collapsed, setCollapsed] = useStateVS(() => !!key && readCollapsed().includes(key));
  const bodyId = React.useId();
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (key) writeCollapsed(key, next);
  };
  return (
    <div className={`card set-card${collapsed ? ' collapsed' : ''}`}>
      <div className="card-head">
        <button type="button" className="set-card-toggle" aria-expanded={!collapsed} aria-controls={bodyId} onClick={toggle}>
          <span className="chev" style={{ display: 'flex' }}><Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={14}/></span>
          <h3><span style={{ color: 'var(--text-subtle)', display: 'flex' }}><Icon name={icon} size={14}/></span>&nbsp;{title}</h3>
        </button>
        {actions && <div className="actions">{actions}</div>}
      </div>
      <div id={bodyId} className={`card-body${flush ? ' flush' : ''}`} hidden={collapsed}>{children}</div>
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
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, width: '100%' }}>
      {NEXUSMD_THEMES.map(t => {
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

// The mode switch (light / dim / dark) and, for each mode, the palette it uses.
function ThemeModeSettings({ tweaks, setTweak }) {
  return (
    <>
      <VsRow title="Mode" desc="Switch between your light, dim and dark themes">
        <VsSeg value={tweaks.theme || 'light'}
          options={THEME_MODES.map(m => [m.id, m.label, m.icon])}
          onChange={v => setTweak('theme', v)}/>
      </VsRow>
      {THEME_MODES.map(m => (
        <VsFullRow key={m.id} title={`${m.label} mode theme`} desc={`Palette used when ${m.label.toLowerCase()} mode is on`}>
          <ThemeChipPicker value={tweaks[m.key] || m.fallback} onChange={v => setTweak(m.key, v)}/>
        </VsFullRow>
      ))}
    </>
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
// ── Profiles sub-page ─────────────────────────────────────────
const PROFILE_COLORS = [
  '#9a7e22', '#6c8ebf', '#7c7c7c', '#48b870',
  '#e05a2b', '#8098e0', '#b86078', '#c09040',
];

// showOrgLabel: web profiles carry an `orgLabel` (sidebar label); the app's don't.
function VsProfileEditor({ profile, onSave, onDelete, onExport, onClose, showOrgLabel = true }) {
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
    const base = { name: name.trim(), initials: (initials.trim() || autoInit).toUpperCase().slice(0, 3), type, color };
    onSave(showOrgLabel ? { ...base, orgLabel: orgLabel.trim() } : base);
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
      {showOrgLabel && (
        <PlFld label="Organisation label" hint="Shown under the app name in the sidebar — leave blank to use the Azure DevOps org name">
          <input value={orgLabel} placeholder="e.g. my-org" onChange={e => setOrgLabel(e.target.value)} />
        </PlFld>
      )}
    </PlModal>
  );
}

// profileApi is the per-platform profile-context value (useProfile()); injected
// because the underlying provider differs (web REST /api/profiles vs app local).
function VsProfiles({ profileApi, showOrgLabel = true }) {
  const { profiles, activeId, switchProfile, createProfile, updateProfile, deleteProfile, exportProfile, importProfile } = profileApi;
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
    <>
    <VsCard title="Profiles" icon="more"
      actions={<button className="btn sm" onClick={() => setEditing('new')}>+ New profile</button>}>
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
    </VsCard>
    {/* Outside the card: "+ New profile" still works while the section is collapsed. */}
    {editing && (
      <VsProfileEditor
        profile={editing === 'new' ? null : editing}
        onSave={handleSave}
        onDelete={handleDelete}
        onExport={exportProfile}
        onClose={() => setEditing(null)}
        showOrgLabel={showOrgLabel}
      />
    )}
    </>
  );
}

// ── Backup & Restore ──────────────────────────────────────────────
// A password prompt — `confirm` shows a second field (export); single field for import.
function BundlePasswordModal({ open, confirm, onClose, onSubmit }) {
  // Uncontrolled inputs read via refs at submit time (rather than controlled
  // state) so values are read straight off the DOM nodes.
  const pwRef = useRefVS(null);
  const pw2Ref = useRefVS(null);
  const [err, setErr] = useStateVS('');
  if (!open) return null;
  const submit = () => {
    const pw = pwRef.current?.value || '';
    const pw2 = pw2Ref.current?.value || '';
    if (!pw) { setErr('Enter a password.'); return; }
    if (confirm && pw !== pw2) { setErr('Passwords do not match.'); return; }
    setErr('');
    onSubmit(pw);
  };
  const close = () => { setErr(''); onClose(); };
  return (
    <PlModal open onClose={close} icon="lock"
      title={confirm ? 'Set a password for this file' : 'Enter the file password'}
      sub="The file is encrypted with this password; you'll need it to import."
      footer={(
        <React.Fragment>
          <button className="btn ghost" onClick={close}>Cancel</button>
          <button className="btn primary" onClick={submit}>{confirm ? 'Export' : 'Import'}</button>
        </React.Fragment>
      )}>
      <PlFld label="Password">
        <input type="password" ref={pwRef} autoFocus onChange={() => setErr('')}
          onKeyDown={e => { if (e.key === 'Enter' && !confirm) submit(); }} />
      </PlFld>
      {confirm && (
        <PlFld label="Confirm password">
          <input type="password" ref={pw2Ref} onChange={() => setErr('')}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
        </PlFld>
      )}
      {err && <div className="plm-callout err">{err}</div>}
    </PlModal>
  );
}

// A small list modal for choosing a cloud backup to restore.
function CloudPickerModal({ open, label, files, busy, onClose, onPick }) {
  if (!open) return null;
  return (
    <PlModal open onClose={onClose} icon="inbox"
      title={`Restore from ${label}`}
      sub="Choose a backup file to download and import."
      footer={<button className="btn ghost" onClick={onClose}>Cancel</button>}>
      {busy && <div className="plm-callout">Loading…</div>}
      {!busy && (!files || files.length === 0) && (
        <div className="plm-callout">No backups found in {label}.</div>
      )}
      {!busy && files && files.map(f => (
        <button key={f.id} className="btn sm" style={{ width: '100%', justifyContent: 'space-between', marginBottom: 6 }}
          onClick={() => onPick(f)}>
          <span>{f.name}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{(f.modifiedAt || '').slice(0, 10)}</span>
        </button>
      ))}
    </PlModal>
  );
}

// fileIO: { saveFile(name, text) → Promise, pickFile() → Promise<string|null> }
function BackupRestoreCard({ fileIO, showExportSingle = true, cloudProviders = [] }) {
  const { profiles, activeProfile, exportBundle, importBundle } = useProfile();
  const [mode, setMode] = useStateVS(null);     // 'export-all' | 'export-one' | 'import'
  const [pendingText, setPendingText] = useStateVS(null);
  const [busy, setBusy] = useStateVS(false);
  const [cloudTarget, setCloudTarget] = useStateVS(null);     // provider for the active password flow
  const [picker, setPicker] = useStateVS(null);               // { provider, files } | { provider, busy }

  const startCloudExport = (provider) => { setMode('export-all'); setPendingText('all'); setCloudTarget(provider); };
  const startCloudRestore = async (provider) => {
    setPicker({ provider, busy: true, files: null });
    try { const files = await provider.list(); setPicker({ provider, busy: false, files }); }
    catch (e) { toast?.(e?.message || `Couldn't reach ${provider.label}.`, 'error'); setPicker(null); }
  };
  const onPickCloudFile = async (file) => {
    const provider = picker.provider;
    setPicker(null);
    try {
      const text = await provider.download(file.id);
      setPendingText(text); setMode('import'); setCloudTarget(null);
    } catch (e) { toast?.(e?.message || 'Download failed.', 'error'); }
  };

  const startExport = (scope) => { setMode(scope === 'all' ? 'export-all' : 'export-one'); setPendingText(scope); };
  const startImport = async () => {
    const text = await fileIO.pickFile();
    if (!text) return;
    setPendingText(text); setMode('import');
  };
  const onPassword = async (password) => {
    setBusy(true);
    try {
      if (mode === 'import') {
        const res = await importBundle({ text: pendingText, password });
        toast?.(`Imported ${res.imported} profile${res.imported !== 1 ? 's' : ''}. Reloading…`, 'success');
        setTimeout(() => window.location.reload(), 700);
      } else {
        const scope = mode === 'export-all' ? 'all' : (activeProfile?.id);
        const { filename, text } = await exportBundle({ scope, password });
        if (cloudTarget) { await cloudTarget.upload(filename, text); toast?.(`Backup saved to ${cloudTarget.label}.`, 'success'); }
        else { await fileIO.saveFile(filename, text); toast?.('Profile file saved.', 'success'); }
      }
    } catch (e) {
      toast?.(e?.message || 'Something went wrong.', 'error');
    } finally { setBusy(false); setMode(null); setPendingText(null); setCloudTarget(null); }
  };

  return (
    <>
    <VsCard title="Backup & Restore" icon="send" flush={false}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          Export a password-encrypted <code>.nmdprofile</code> file you can keep as a backup or open in the other apps.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {showExportSingle && activeProfile && (
            <button className="btn sm" disabled={busy} onClick={() => startExport(activeProfile.id)}>
              <Icon name="send" size={12} /> Export this profile
            </button>
          )}
          <button className="btn sm" disabled={busy || profiles.length === 0} onClick={() => startExport('all')}>
            <Icon name="send" size={12} /> Back up all profiles
          </button>
          <button className="btn sm ghost" disabled={busy} onClick={startImport}>
            <Icon name="inbox" size={12} /> Import / Restore from file
          </button>
        </div>
        {cloudProviders.map(p => (
          <div key={p.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {p.isConnected() ? (
              <>
                <button className="btn sm" disabled={busy} onClick={() => startCloudExport(p)}>
                  <Icon name="send" size={12} /> Save backup to {p.label}
                </button>
                <button className="btn sm ghost" disabled={busy} onClick={() => startCloudRestore(p)}>
                  <Icon name="inbox" size={12} /> Restore from {p.label}
                </button>
                <button className="btn sm ghost" disabled={busy} onClick={() => p.disconnect()}>
                  Disconnect
                </button>
              </>
            ) : (
              <button className="btn sm" disabled={busy} onClick={() => p.connect()}>
                <Icon name="lock" size={12} /> Connect {p.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </VsCard>
    <CloudPickerModal
      open={picker != null}
      label={picker?.provider?.label || ''}
      files={picker?.files}
      busy={!!picker?.busy}
      onClose={() => setPicker(null)}
      onPick={onPickCloudFile}
    />
    <BundlePasswordModal
      open={mode != null}
      confirm={mode === 'export-all' || mode === 'export-one'}
      onClose={() => { setMode(null); setPendingText(null); }}
      onSubmit={onPassword}
    />
    </>
  );
}

// Cloud Sync card — continuous sync + encrypted local export/import. Driven by a
// platform sync controller (createSyncController), the platform's cloud providers,
// and its file I/O. Shared across web/desktop/app.
function CloudSyncCard({ controller, providers, fileIO }) {
  const [selectedId, setSelectedId] = React.useState(() => controller.getSyncProvider()?.id || '');
  const [hasKey, setHasKey] = React.useState(false);
  const [passphrase, setPassphrase] = React.useState('');
  const [syncing, setSyncing] = React.useState(false);
  const [lastResult, setLastResult] = React.useState(null);

  const provider = providers.find(p => p.id === selectedId) || null;
  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => { controller.hasSyncKey().then(setHasKey); }, []);
  React.useEffect(() => {
    const p = providers.find(p => p.id === selectedId) || null;
    setConnected(p ? p.isConnected() : false);
  }, [selectedId]);
  React.useEffect(() => {
    const refresh = () => {
      const p = providers.find(p => p.id === selectedId) || null;
      setConnected(p ? p.isConnected() : false);
    };
    // 'focus' covers OAuth-in-another-tab; 'nexusmd:cloud-auth-changed' covers
    // async token (re)hydration where isConnected() is cache-backed (app).
    window.addEventListener('focus', refresh);
    window.addEventListener('nexusmd:cloud-auth-changed', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('nexusmd:cloud-auth-changed', refresh);
    };
  }, [selectedId]);

  const handleProviderChange = (id) => {
    setSelectedId(id); controller.setSyncProvider(id);
    const p = providers.find(pr => pr.id === id) || null;
    setConnected(p ? p.isConnected() : false);
  };
  const handleConnect = async () => { if (!provider) return; await provider.connect(); setConnected(provider.isConnected()); };
  const handleDisconnect = async () => { if (!provider) return; await provider.disconnect(); setConnected(false); toast?.(`${provider.label} disconnected.`, 'success'); };
  const handleSavePassphrase = async () => { if (!passphrase) return; await controller.setSyncPassphrase(passphrase); setPassphrase(''); setHasKey(true); toast?.('Sync passphrase saved.', 'success'); };
  const handleForgetPassphrase = async () => { await controller.clearSyncKey(); setHasKey(false); toast?.('Sync passphrase forgotten.', 'success'); };

  const handleSyncNow = async () => {
    setSyncing(true); setLastResult(null);
    try {
      const result = await controller.syncOnce();
      setLastResult(result);
      if (result.skipped === 'no-key') toast?.('Set a sync passphrase first.', 'info');
      else if (result.skipped === 'no-provider') toast?.('Select a cloud provider first.', 'info');
      else if (result.skipped === 'not-connected') toast?.('Connect your cloud provider first.', 'info');
      else if (result.skipped === 'bad-passphrase') toast?.('Wrong passphrase — enter the correct passphrase and try again.', 'error');
      else if (!result.skipped) toast?.(`Synced — pushed ${result.pushed}, pulled ${result.pulled}, merged ${result.merged}.`, 'success');
    } catch (err) { toast?.('Sync failed: ' + (err?.message || 'unknown error'), 'error'); }
    finally { setSyncing(false); }
  };

  const stamp = () => {
    const d = new Date(); const p2 = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  };
  const handleExport = async () => {
    try {
      const text = await controller.exportLocalBundle();
      await fileIO.saveFile(`nexusmd-planner-${controller.getActiveProfileId() || 'default'}-${stamp()}.nmdplanner`, text);
      toast?.('Exported encrypted planner bundle.', 'success');
    } catch (err) { toast?.('Export failed: ' + (err?.message || 'unknown error'), 'error'); }
  };
  const handleImport = async () => {
    try {
      const text = await fileIO.pickFile();
      if (!text) return;
      const r = await controller.importLocalBundle(text);
      toast?.(r.collections.length ? `Imported ${r.collections.join(', ')}.` : 'Nothing to import.', 'success');
    } catch (err) { toast?.(err?.code === 'bad-passphrase' ? 'Wrong passphrase for this file.' : 'Import failed: ' + (err?.message || 'unknown error'), 'error'); }
  };

  const lastDesc = lastResult && !lastResult.skipped
    ? `Last: pushed ${lastResult.pushed}, pulled ${lastResult.pulled}, merged ${lastResult.merged}`
    : 'Push and pull encrypted changes with your cloud';

  return (
    <VsCard title="Cloud Sync" icon="inbox">
      <VsFullRow title="Cloud provider" desc="Where encrypted sync files are stored">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {providers.map(p => (
            <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13 }}>
              <input type="radio" name="sync-provider" value={p.id} checked={selectedId === p.id} onChange={() => handleProviderChange(p.id)} style={{ accentColor: 'var(--accent)' }} />
              {p.label}
            </label>
          ))}
        </div>
      </VsFullRow>
      {provider && (
        <VsRow title={provider.label} desc={connected ? `Connected to ${provider.label}` : `Not connected to ${provider.label}`}>
          {connected ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="pill success"><span className="dot"></span>Connected</span>
              <button className="btn sm ghost danger" onClick={handleDisconnect}>Disconnect</button>
            </div>
          ) : (
            <button className="btn sm ghost" onClick={handleConnect}>Connect {provider.label}</button>
          )}
        </VsRow>
      )}
      <VsRow title="Sync passphrase" desc="AES-256 key for all synced data — hashed locally, never sent anywhere">
        {hasKey ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="pill success"><span className="dot"></span>Remembered</span>
            <button className="btn sm ghost danger" onClick={handleForgetPassphrase}>Forget</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleSavePassphrase(); }} placeholder="Enter passphrase…" style={{ width: 200, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', font: 'inherit', fontSize: 13, color: 'var(--text)' }} />
            <button className="btn sm" onClick={handleSavePassphrase} disabled={!passphrase}>Save</button>
          </div>
        )}
      </VsRow>
      <VsRow title="Sync now" desc={lastDesc}>
        <button className="btn sm" onClick={handleSyncNow} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync now'}</button>
      </VsRow>
      <VsRow title="Local file" desc={hasKey ? 'Export or import an encrypted planner bundle (.nmdplanner)' : 'Set a sync passphrase to encrypt local exports'}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn sm ghost" onClick={handleExport} disabled={!hasKey}>Export to file</button>
          <button className="btn sm ghost" onClick={handleImport} disabled={!hasKey}>Import from file</button>
        </div>
      </VsRow>
    </VsCard>
  );
}

// ── OAuth integration card ────────────────────────────────────────
// service: { id, label, icon, desc, isConnected, connect, disconnect,
//            credFields, loadCreds, saveCreds, children? }
function OAuthServiceCard({ service }) {
  const {
    label, icon, desc,
    isConnected, connect, disconnect,
    credFields = [], loadCreds, saveCreds,
    children,
  } = service;

  const [connected, setConnected] = React.useState(() => isConnected());
  const [credsOpen, setCredsOpen] = React.useState(false);
  const [creds, setCreds] = React.useState({});
  const [saving, setSaving] = React.useState(false);
  const [credErr, setCredErr] = React.useState('');

  React.useEffect(() => {
    if (!loadCreds) return;
    const result = loadCreds();
    if (result != null && typeof result.then === 'function') {
      result.then(c => setCreds(c || {}));
    } else {
      setCreds(result || {});
    }
  }, [loadCreds]);

  React.useEffect(() => {
    const refresh = () => setConnected(isConnected());
    window.addEventListener('focus', refresh);
    window.addEventListener('nexusmd:cloud-auth-changed', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('nexusmd:cloud-auth-changed', refresh);
    };
  }, [isConnected]);

  const allCredsFilled = credFields.every(f => (creds[f.key] || '').trim());

  const handleConnect = () => {
    if (!allCredsFilled) {
      setCredErr('Enter Client ID and Secret first.');
      setCredsOpen(true);
      return;
    }
    Promise.resolve(connect()).then(() => setConnected(isConnected())).catch(() => {});
  };

  const handleDisconnect = () => {
    Promise.resolve(disconnect()).then(() => {
      setConnected(false);
      toast?.(`${label} disconnected.`, 'success');
    }).catch(() => {});
  };

  const handleSaveCreds = () => {
    setSaving(true);
    Promise.resolve(saveCreds(creds)).then(() => {
      toast?.('Credentials saved.', 'success');
      setCredErr('');
      setCredsOpen(false);
    }).catch(() => {
      toast?.('Could not save credentials.', 'error');
    }).finally(() => setSaving(false));
  };

  const inputStyle = {
    width: '100%', padding: '6px 10px', borderRadius: 8,
    border: '1px solid var(--border)', background: 'var(--surface-2)',
    font: 'inherit', fontSize: 13, color: 'var(--text)',
  };

  return (
    <VsCard title={label} icon={icon}>
      {credFields.length > 0 && (
        <>
          <div className="set-row" style={{ cursor: 'pointer' }} onClick={() => setCredsOpen(o => !o)}>
            <div className="info">
              <div className="t">App credentials</div>
              <div className="d">{desc}</div>
            </div>
            {allCredsFilled
              ? <span className="pill success"><span className="dot"></span>Configured</span>
              : <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Not configured</span>}
            <button className="btn sm ghost" onClick={e => { e.stopPropagation(); setCredsOpen(o => !o); }}>
              {credsOpen ? 'Hide' : 'Edit'}
            </button>
          </div>
          {credsOpen && (
            <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {credFields.map(f => (
                <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)' }}>
                    {f.label}
                  </label>
                  <input
                    type={f.secret ? 'password' : 'text'}
                    value={creds[f.key] || ''}
                    onChange={e => { setCreds(c => ({ ...c, [f.key]: e.target.value })); setCredErr(''); }}
                    style={inputStyle}
                  />
                  {f.hint && <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{f.hint}</span>}
                </div>
              ))}
              <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                These credentials are shared across all users of this instance.
              </div>
              {credErr && <div className="plm-callout err">{credErr}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn sm primary" onClick={handleSaveCreds} disabled={saving}>
                  {saving ? 'Saving…' : 'Save credentials'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      <VsRow
        title="Connection"
        desc={credFields.length ? (connected ? `Connected to ${label}` : `Not connected to ${label}`) : desc}>
        {connected ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="pill success"><span className="dot"></span>Connected</span>
            <button className="btn sm ghost danger" onClick={handleDisconnect}>Disconnect</button>
          </div>
        ) : (
          <button className="btn sm ghost" onClick={handleConnect}>Connect {label}</button>
        )}
      </VsRow>
      {children}
    </VsCard>
  );
}

function IntegrationsView({ services }) {
  return (
    <React.Fragment>
      {services.map(s => <OAuthServiceCard key={s.id} service={s} />)}
    </React.Fragment>
  );
}

// ── Board Columns settings card ───────────────────────────────────
// Self-contained: owns its own boardColumnConfig state (usePersisted) and
// reads projects from useNexusData(). wiTypeStates comes from the cache key
// written by the work-items view after it fetches ADO state lists.
function BoardColumnsCard() {
  const { data: { PROJECTS = [] } } = useNexusData();
  const [boardColumnConfig, setBoardColumnConfig] = usePersisted('nexusmd.wi.boardColumns', {});
  const wiTypeStates = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem(WI_TYPE_STATES_CACHE_KEY) || '{}'); }
    catch { return {}; }
  }, []);

  const useGlobal = PROJECTS.length <= 1;
  const [selectedProject, setSelectedProject] = useStateVS(() => useGlobal ? '__global__' : (PROJECTS[0]?.id || '__global__'));
  const [newColName, setNewColName] = useStateVS('');
  const [dragIdx, setDragIdx] = useStateVS(null);
  const [overIdx, setOverIdx] = useStateVS(null);

  const projectKey = useGlobal ? '__global__' : selectedProject;
  const entry = boardColumnConfig[projectKey] || { columns: [], autoAdded: [], hidden: [] };

  const update = (fn) => setBoardColumnConfig(prev => fn(prev));

  const onDragStart = (idx) => setDragIdx(idx);
  const onDragOver = (e, idx) => { e.preventDefault(); setOverIdx(idx); };
  const onDrop = (e, dropIdx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === dropIdx) { setDragIdx(null); setOverIdx(null); return; }
    const newOrder = [...entry.columns];
    const [moved] = newOrder.splice(dragIdx, 1);
    newOrder.splice(dropIdx, 0, moved);
    update(c => reorderColumns(c, projectKey, newOrder));
    setDragIdx(null); setOverIdx(null);
  };
  const onDragEnd = () => { setDragIdx(null); setOverIdx(null); };

  const detectedStates = [...new Set(Object.values(wiTypeStates).flat())];

  return (
    <VsCard title="Board columns" icon="board">
      {!useGlobal && PROJECTS.length > 1 && (
        <VsRow title="Project" desc="Configure columns per project">
          <select
            value={selectedProject}
            onChange={e => setSelectedProject(e.target.value)}
            style={{ height: 30, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 13, color: 'var(--text)', cursor: 'pointer' }}
          >
            {PROJECTS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </VsRow>
      )}

      <VsFullRow
        title="Columns"
        desc="Drag to reorder · toggle to show/hide · ✕ to undo auto-detected columns"
      >
        {entry.columns.length === 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--text-subtle)', margin: 0 }}>
            No columns configured yet — columns appear automatically after the board loads ADO states.
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
          {entry.columns.map((col, idx) => {
            const isHidden    = (entry.hidden || []).includes(col);
            const isAutoAdded = (entry.autoAdded || []).includes(col);
            const isDragging  = dragIdx === idx;
            const isOver      = overIdx === idx && dragIdx !== null && dragIdx !== idx;
            return (
              <div
                key={col}
                draggable
                onDragStart={() => onDragStart(idx)}
                onDragOver={e => onDragOver(e, idx)}
                onDrop={e => onDrop(e, idx)}
                onDragEnd={onDragEnd}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                  borderRadius: 8, border: `1px solid ${isOver ? 'var(--accent-border)' : 'var(--border)'}`,
                  background: isOver ? 'var(--accent-soft)' : isDragging ? 'var(--surface-2)' : 'var(--surface)',
                  opacity: isDragging ? 0.5 : 1,
                  transition: 'border-color .1s, background .1s',
                  cursor: 'grab',
                  userSelect: 'none',
                }}
              >
                {/* Drag handle */}
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, color: 'var(--text-subtle)', flexShrink: 0 }}>
                  {[0,1].map(i => (
                    <span key={i} style={{ display: 'flex', gap: 2 }}>
                      <span style={{ width: 2.5, height: 2.5, borderRadius: '50%', background: 'currentColor' }}/>
                      <span style={{ width: 2.5, height: 2.5, borderRadius: '50%', background: 'currentColor' }}/>
                    </span>
                  ))}
                </span>

                {/* Show/hide checkbox */}
                <input
                  type="checkbox"
                  checked={!isHidden}
                  onChange={e => update(c => toggleColumnHidden(c, projectKey, col, !e.target.checked))}
                  style={{ cursor: 'pointer', accentColor: 'var(--accent)', flexShrink: 0 }}
                  onClick={e => e.stopPropagation()}
                />

                {/* Column name */}
                <span style={{ flex: 1, fontSize: 13, color: isHidden ? 'var(--text-subtle)' : 'var(--text)', textDecoration: isHidden ? 'line-through' : 'none' }}>
                  {col}
                </span>

                {/* Auto badge + undo */}
                {isAutoAdded && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: 10.5, fontWeight: 600, color: 'var(--text-subtle)',
                    background: 'var(--surface-2)', border: '1px solid var(--border)',
                    borderRadius: 4, padding: '1px 6px',
                  }}>
                    Auto
                    <button
                      onClick={e => { e.stopPropagation(); update(c => removeAutoAdded(c, projectKey, col)); }}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-subtle)', display: 'flex', alignItems: 'center', lineHeight: 1 }}
                      title="Undo auto-added (hides this column)"
                    >✕</button>
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Add column input */}
        <form
          onSubmit={e => {
            e.preventDefault();
            const name = newColName.trim();
            if (!name) return;
            update(c => addManualColumn(c, projectKey, name));
            setNewColName('');
          }}
          style={{ display: 'flex', gap: 6, marginTop: 4, width: '100%' }}
        >
          <input
            value={newColName}
            onChange={e => setNewColName(e.target.value)}
            placeholder="Add column…"
            style={{ flex: 1, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 13, color: 'var(--text)', fontFamily: 'var(--sans)' }}
          />
          <button type="submit" className="btn sm" disabled={!newColName.trim()}>Add</button>
        </form>

        {/* Reset link */}
        {detectedStates.length > 0 && (
          <button
            type="button"
            onClick={() => update(c => resetToDetected(c, projectKey, detectedStates))}
            style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', fontSize: 12, cursor: 'pointer', padding: 0, textDecoration: 'underline', alignSelf: 'flex-start', marginTop: 2 }}
          >
            Reset to detected ADO states
          </button>
        )}
      </VsFullRow>
    </VsCard>
  );
}

function FieldVisibilityCard({ title, catalog, config, onChange }) {
  const [dragIdx, setDragIdx] = useStateVS(null)
  const [overIdx, setOverIdx] = useStateVS(null)
  const rows = resolveFields(catalog, config)

  const onDrop = (dropIdx) => {
    if (dragIdx === null || dragIdx === dropIdx) { setDragIdx(null); setOverIdx(null); return }
    onChange(reorderField(config, catalog, rows[dragIdx].key, rows[dropIdx].key))
    setDragIdx(null); setOverIdx(null)
  }

  return (
    <VsCard title={title} icon="board">
      <VsFullRow title="Fields" desc="Drag to reorder · toggle to show/hide">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
          {rows.map((f, idx) => {
            const isOver = overIdx === idx && dragIdx !== null && dragIdx !== idx
            const isDragging = dragIdx === idx
            return (
              <div
                key={f.key}
                draggable
                onDragStart={() => setDragIdx(idx)}
                onDragOver={e => { e.preventDefault(); setOverIdx(idx) }}
                onDrop={e => { e.preventDefault(); onDrop(idx) }}
                onDragEnd={() => { setDragIdx(null); setOverIdx(null) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                  borderRadius: 8, border: `1px solid ${isOver ? 'var(--accent-border)' : 'var(--border)'}`,
                  background: isOver ? 'var(--accent-soft)' : isDragging ? 'var(--surface-2)' : 'var(--surface)',
                  opacity: isDragging ? 0.5 : 1, cursor: 'grab', userSelect: 'none',
                }}
              >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, color: 'var(--text-subtle)', flexShrink: 0 }}>
                  {[0,1].map(i => (
                    <span key={i} style={{ display: 'flex', gap: 2 }}>
                      <span style={{ width: 2.5, height: 2.5, borderRadius: '50%', background: 'currentColor' }}/>
                      <span style={{ width: 2.5, height: 2.5, borderRadius: '50%', background: 'currentColor' }}/>
                    </span>
                  ))}
                </span>
                <input
                  type="checkbox"
                  aria-label={f.label}
                  checked={f.visible}
                  disabled={f.locked}
                  onChange={() => onChange(toggleField(config, catalog, f.key))}
                  style={{ cursor: f.locked ? 'not-allowed' : 'pointer', accentColor: 'var(--accent)', flexShrink: 0 }}
                />
                <span style={{ flex: 1, fontSize: 13, color: f.visible ? 'var(--text)' : 'var(--text-subtle)', textDecoration: f.visible ? 'none' : 'line-through' }}>
                  {f.label}
                </span>
              </div>
            )
          })}
        </div>
        <button
          type="button"
          onClick={() => onChange(defaultConfig(catalog))}
          style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', fontSize: 12, cursor: 'pointer', padding: 0, textDecoration: 'underline', alignSelf: 'flex-start', marginTop: 6 }}
        >
          Reset to defaults
        </button>
      </VsFullRow>
    </VsCard>
  )
}

function CardsAndTablesSettings() {
  const [wiCard,      setWiCard]      = usePersisted('nexusmd.fields.wiCard',      [], { sync: true })
  const [wiTable,     setWiTable]     = usePersisted('nexusmd.fields.wiTable',     [], { sync: true })
  const [prCard,      setPrCard]      = usePersisted('nexusmd.fields.prCard',      [], { sync: true })
  const [buildsTable, setBuildsTable] = usePersisted('nexusmd.fields.buildsTable', [], { sync: true })
  const [testsTable,  setTestsTable]  = usePersisted('nexusmd.fields.testsTable',  [], { sync: true })
  return (
    <>
      <FieldVisibilityCard title="Work item cards" catalog={WI_CARD_FIELDS}       config={wiCard}      onChange={setWiCard} />
      <FieldVisibilityCard title="Work item table" catalog={WI_TABLE_COLUMNS}     config={wiTable}     onChange={setWiTable} />
      <FieldVisibilityCard title="Pull request cards" catalog={PR_CARD_FIELDS}    config={prCard}      onChange={setPrCard} />
      <FieldVisibilityCard title="Builds table" catalog={BUILDS_TABLE_COLUMNS}    config={buildsTable} onChange={setBuildsTable} />
      <FieldVisibilityCard title="Tests table" catalog={TESTS_TABLE_COLUMNS}      config={testsTable}  onChange={setTestsTable} />
    </>
  )
}

// ── Shared exports ────────────────────────────────────────────────
export {
  PROFILE_COLORS,
  PlToggle, VsRow, VsCard, VsFullRow, ThemeChipPicker, ThemeModeSettings, VsSeg,
  VsPasswordModal, VsProfileEditor, VsProfiles,
  BundlePasswordModal, BackupRestoreCard, CloudPickerModal, CloudSyncCard,
  OAuthServiceCard, IntegrationsView,
  BoardColumnsCard,
  FieldVisibilityCard,
  CardsAndTablesSettings,
};
