// view-settings.jsx — shared Settings form/profile primitives (web + app). The
// SettingsView page + integration cards (Google/GitHub/Drive/PlannerSync) stay
// per-platform; these 9 building blocks were byte-identical bar a few seams:
// ThemeChipPicker reads the platform theme registry off window; VsPasswordModal
// uses the shared confidential helpers; VsProfileEditor/VsProfiles take a
// showOrgLabel flag (web shows an org-label field, the app hides it); VsProfiles
// takes the profile API as a prop (each platform's profile-context useProfile()).
import React from 'react';
import { Icon } from '../icons.jsx';
import { PlFld, PlModal } from '../planner-chips.jsx';
import { toast } from '../toast.jsx';
import { hashPassword, loadConfidentialConfig, saveConfidentialConfig } from '../planner/planner-confidential.js';
import { useProfile } from '../profile-context.jsx';

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
  // Theme registry is published on window per platform (web NEXUSMD_THEMES, app HELM_THEMES).
  const themes = window.NEXUSMD_THEMES || window.HELM_THEMES || [];
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
          <input value={orgLabel} placeholder="e.g. msl-cirrus" onChange={e => setOrgLabel(e.target.value)} />
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
          showOrgLabel={showOrgLabel}
        />
      )}
    </div>
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

// fileIO: { saveFile(name, text) → Promise, pickFile() → Promise<string|null> }
function BackupRestoreCard({ fileIO, showExportSingle = true }) {
  const { profiles, activeProfile, exportBundle, importBundle } = useProfile();
  const [mode, setMode] = useStateVS(null);     // 'export-all' | 'export-one' | 'import'
  const [pendingText, setPendingText] = useStateVS(null);
  const [busy, setBusy] = useStateVS(false);

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
        await fileIO.saveFile(filename, text);
        toast?.('Profile file saved.', 'success');
      }
    } catch (e) {
      toast?.(e?.message || 'Something went wrong.', 'error');
    } finally { setBusy(false); setMode(null); setPendingText(null); }
  };

  return (
    <div className="card set-card">
      <div className="card-head">
        <h3><span style={{ color: 'var(--text-subtle)', display: 'flex' }}><Icon name="send" size={14} /></span>&nbsp;Backup &amp; Restore</h3>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
      </div>
      <BundlePasswordModal
        open={mode != null}
        confirm={mode === 'export-all' || mode === 'export-one'}
        onClose={() => { setMode(null); setPendingText(null); }}
        onSubmit={onPassword}
      />
    </div>
  );
}

// ── Shared exports ────────────────────────────────────────────────
export {
  PROFILE_COLORS,
  PlToggle, VsRow, VsCard, VsFullRow, ThemeChipPicker, VsSeg,
  VsPasswordModal, VsProfileEditor, VsProfiles,
  BundlePasswordModal, BackupRestoreCard,
};
