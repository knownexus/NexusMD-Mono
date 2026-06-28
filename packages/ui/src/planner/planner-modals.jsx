// planner-modals.jsx — the stateless presentational pieces of the planner's
// "part 2": import/versions/confidential modals, the week calendar picker, the
// header dropdown + menu items, and the delete-week confirm. Shared web + app.
//
// The PlannerView shell itself stays per-platform (desktop page-head + split
// menus vs the mobile appbar + quick-capture FAB), but every modal/menu/picker
// it renders is identical, so they live here. Namespaced storage (versions, the
// confidential remote payload) goes through the planner runtime, exactly like
// loadGlobalNotes/loadConfidentialConfig.
import React from 'react';
import { Icon } from '../icons.jsx';
import { PlModal, PlFld } from '../planner-chips.jsx';
import { getIsoWeek, getIsoYearWeek, getMondayOfDate, PLANNER_SECTIONS } from '@nexusmd/core';
import { getPlannerRuntime } from './runtime.js';
import {
  hashPassword, loadConfidentialConfig, saveConfidentialConfig, decryptConfidentialFromServer,
} from './planner-confidential.js';

const { useState, useEffect, useMemo, useRef } = React;

// ── Version snapshots (runtime-namespaced storage; web bare nexusmd.*, app
//    profile-scoped helm.*) ──────────────────────────────────────────────────
export function loadVersions() {
  const { storage, getProfileKey, namespace } = getPlannerRuntime();
  try { return JSON.parse(storage.getItem(getProfileKey(`${namespace}.planner.versions`)) || '[]'); } catch { return []; }
}
export function saveVersions(versions) {
  const { storage, getProfileKey, namespace, pushPref } = getPlannerRuntime();
  const s = JSON.stringify(versions);
  try { storage.setItem(getProfileKey(`${namespace}.planner.versions`), s); } catch (_) {}
  pushPref?.(`${namespace}.planner.versions`, s);
}
export function describeSnapshot(data) {
  const tasks = (data.tasks || []).length;
  const meetings = (data.meetSched || []).length;
  const oneOnOnes = (data.oneOnOnes || []).length;
  const parts = [];
  if (tasks) parts.push(`${tasks} task${tasks !== 1 ? 's' : ''}`);
  if (meetings) parts.push(`${meetings} meeting${meetings !== 1 ? 's' : ''}`);
  if (oneOnOnes) parts.push(`${oneOnOnes} 1:1${oneOnOnes !== 1 ? 's' : ''}`);
  return parts.length ? parts.join(', ') : 'empty planner';
}

// ── Import modal (v1 semantics: { data, themes } envelope, merge) ──
export function ImportModal({ open, onClose, onImport }) {
  const [status, setStatus] = useState(null);
  const [pending, setPending] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);
  const handleClose = () => { setStatus(null); setPending(null); setDragOver(false); onClose(); };

  const parseFile = (file) => {
    if (!file) return;
    if (!file.name.endsWith('.json')) { setStatus({ ok: false, message: 'Please choose a .json file.' }); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      let parsed;
      try { parsed = JSON.parse(ev.target.result); }
      catch (e) { setStatus({ ok: false, message: 'Invalid JSON: ' + e.message }); return; }

      let data = null, themes = null;
      if (parsed && typeof parsed.data === 'object' && parsed.data !== null) {
        data = parsed.data; themes = parsed.themes || null;
      } else if (parsed && typeof parsed === 'object') {
        const knownKeys = PLANNER_SECTIONS.map(s => s.id);
        if (Object.keys(parsed).filter(k => knownKeys.includes(k)).length > 0) data = parsed;
        else { setStatus({ ok: false, message: "File doesn't look like a planner export. Expected { data, themes } or a planner data object." }); return; }
      } else { setStatus({ ok: false, message: 'Unexpected file format.' }); return; }

      const tasks = (data.tasks || []).length, meetings = (data.meetSched || []).length, oneOnOnes = (data.oneOnOnes || []).length;
      const exportedAt = parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString() : null;
      setPending({ data, themes });
      setStatus({ ok: true, message: 'Ready to import — merges into the current week.', detail: `${tasks} tasks, ${meetings} meetings, ${oneOnOnes} 1:1s${exportedAt ? ' · exported ' + exportedAt : ''}` });
    };
    reader.onerror = () => setStatus({ ok: false, message: 'Could not read the file.' });
    reader.readAsText(file);
  };

  return (
    <PlModal open={open} onClose={handleClose} icon="inbox" title="Import planner"
      sub="Merge a JSON export into this week"
      footer={(
        <React.Fragment>
          <button className="btn ghost" onClick={handleClose}>Cancel</button>
          <button className="btn primary" disabled={!pending} onClick={() => { onImport(pending.data, pending.themes); handleClose(); }}>Import</button>
        </React.Fragment>
      )}>
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); parseFile(e.dataTransfer.files?.[0]); }}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `1.5px dashed ${dragOver ? 'var(--accent)' : 'var(--border-strong)'}`,
          borderRadius: 12, padding: '30px 20px', textAlign: 'center', cursor: 'pointer',
          background: dragOver ? 'var(--accent-soft)' : 'var(--surface-2)', transition: 'all .15s',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        }}>
        <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={e => { parseFile(e.target.files?.[0]); e.target.value = ''; }}/>
        <Icon name="inbox" size={20} style={{ color: 'var(--text-subtle)' }}/>
        <div style={{ fontSize: 13, fontWeight: 500 }}>Drop a .json export here, or click to browse</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>Existing data is preserved unless the file has the same sections</div>
      </div>
      {status && (
        <div className={`plm-callout ${status.ok ? 'ok' : 'err'}`}>
          <strong>{status.message}</strong>
          {status.detail && <div style={{ marginTop: 3, opacity: .85 }}>Found: {status.detail}</div>}
        </div>
      )}
    </PlModal>
  );
}

// ── Versions modal (runtime-namespaced storage) ────────
export function VersionsModal({ open, onClose, currentData, currentThemes, onRestore }) {
  const [versions, setVersions] = useState(() => loadVersions());
  const [labelInput, setLabelInput] = useState('');
  useEffect(() => { if (open) setVersions(loadVersions()); }, [open]);

  const persist = (next) => { setVersions(next); saveVersions(next); };
  const saveSnapshot = () => {
    const label = labelInput.trim() || ('Snapshot ' + new Date().toLocaleDateString());
    const snap = { id: 'v' + Date.now(), label, savedAt: new Date().toISOString(), data: currentData, themes: currentThemes };
    persist([snap, ...versions].slice(0, 20));
    setLabelInput('');
  };
  const exportVersion = (v) => {
    const payload = { data: v.data, themes: v.themes, exportedAt: v.savedAt };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `planner-${v.label.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <PlModal open={open} onClose={onClose} icon="clock" title="Planner versions" sub="Snapshots of the current week"
      footerLeft="Up to 20 snapshots stored in this browser">
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={labelInput} onChange={e => setLabelInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') saveSnapshot(); }}
          placeholder={`Snapshot label (e.g. "Week ${getIsoWeek(new Date())}")`}
          style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', font: 'inherit', fontSize: 13, color: 'var(--text)', outline: 'none' }}/>
        <button className="btn sm primary" style={{ height: 34 }} onClick={saveSnapshot}><Icon name="plus" size={12}/> Save</button>
      </div>
      {versions.length === 0 && <div className="empty" style={{ padding: '22px 10px', fontSize: 12.5 }}>No snapshots yet. Save one above to preserve the current state.</div>}
      {versions.map(v => (
        <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500, fontSize: 13 }}>{v.label}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{new Date(v.savedAt).toLocaleString()} · {describeSnapshot(v.data)}</div>
          </div>
          <button className="btn sm ghost" onClick={() => { onRestore(v.data, v.themes); onClose(); }}>Restore</button>
          <button className="btn icon ghost sm" title="Download as JSON" onClick={() => exportVersion(v)}><Icon name="send" size={12}/></button>
          <button className="btn icon ghost sm" style={{ color: 'var(--danger)' }} title="Delete" onClick={() => persist(versions.filter(x => x.id !== v.id))}><Icon name="trash" size={12}/></button>
        </div>
      ))}
    </PlModal>
  );
}

// ── Confidential modals (v1 logic, unified styling) ───────────
export function ConfidentialSetPasswordModal({ open, existingHash, onClose, onSaved }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const handleClose = () => { setPw(''); setConfirm(''); setErr(''); onClose(); };

  const handleSave = async () => {
    if (!pw) { setErr('Please enter a password.'); return; }
    if (pw !== confirm) { setErr('Passwords do not match.'); return; }
    setBusy(true);
    try { onSaved(await hashPassword(pw)); handleClose(); }
    catch { setErr('Could not set password. Try again.'); }
    finally { setBusy(false); }
  };

  return (
    <PlModal open={open} onClose={handleClose} icon="lock"
      title={existingHash ? 'Change password' : 'Set confidential password'}
      sub="Stored only in your browser; synced encrypted"
      footer={(
        <React.Fragment>
          <button className="btn ghost" onClick={handleClose}>Cancel</button>
          <button className="btn primary" onClick={handleSave} disabled={busy}>
            {busy ? 'Saving…' : existingHash ? 'Change password' : 'Set password'}
          </button>
        </React.Fragment>
      )}>
      <PlFld label="Password">
        <input type="password" value={pw} autoFocus onChange={e => { setPw(e.target.value); setErr(''); }}/>
      </PlFld>
      <PlFld label="Confirm password">
        <input type="password" value={confirm} onChange={e => { setConfirm(e.target.value); setErr(''); }}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}/>
      </PlFld>
      {err && <div className="plm-callout err">{err}</div>}
    </PlModal>
  );
}

export function ConfidentialUnlockModal({ open, onClose, onUnlocked }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const handleClose = () => { setPw(''); setErr(''); onClose(); };

  const handleUnlock = async () => {
    if (!pw) { setErr('Enter your password.'); return; }
    setBusy(true);
    try {
      const hash = await hashPassword(pw);
      const cfg  = loadConfidentialConfig();

      // Remote payload uses a bare (non-profile-scoped) namespaced key in both
      // platforms — read it straight off the runtime storage.
      const { storage, namespace } = getPlannerRuntime();
      const remoteKey = `${namespace}.planner.confidential.remote`;
      let remoteDecrypted = null;
      try {
        const remoteRaw = storage.getItem(remoteKey);
        if (remoteRaw) {
          const remote = JSON.parse(remoteRaw);
          if (remote.iv && remote.ciphertext)
            remoteDecrypted = await decryptConfidentialFromServer(remote, hash);
        }
      } catch (_) {}

      const localMatch  = !!cfg.hash && hash === cfg.hash;
      const remoteMatch = !!remoteDecrypted;

      if (localMatch || remoteMatch) {
        if (remoteMatch) {
          const restored = { ...remoteDecrypted, hash: cfg.hash || hash };
          saveConfidentialConfig(restored);
          try { storage.removeItem(remoteKey); } catch (_) {}
        }
        onUnlocked(); handleClose();
      } else {
        setErr('Incorrect password.');
      }
    } finally { setBusy(false); }
  };

  return (
    <PlModal open={open} onClose={handleClose} icon="lock" title="Unlock confidential sections"
      sub="Unlocks for this session only"
      footer={(
        <React.Fragment>
          <button className="btn ghost" onClick={handleClose}>Cancel</button>
          <button className="btn primary" onClick={handleUnlock} disabled={busy}>{busy ? 'Verifying…' : 'Unlock'}</button>
        </React.Fragment>
      )}>
      <PlFld label="Password">
        <input type="password" value={pw} autoFocus onChange={e => { setPw(e.target.value); setErr(''); }}
          onKeyDown={e => { if (e.key === 'Enter') handleUnlock(); }}/>
      </PlFld>
      {err && <div className="plm-callout err">{err}</div>}
    </PlModal>
  );
}

// ── Week calendar picker ──────────────────────────────────────
export function WeekCalendarPicker({ weekOffset, onSelectOffset, weeksWithData, onClose }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMonday = getMondayOfDate(today);

  const selectedMonday = new Date(todayMonday);
  selectedMonday.setDate(todayMonday.getDate() + weekOffset * 7);

  const [calYear, setCalYear] = useState(() => selectedMonday.getFullYear());
  const [calMonth, setCalMonth] = useState(() => selectedMonday.getMonth());

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAYS   = ['Mo','Tu','We','Th','Fr','Sa','Su'];

  const weeksInView = useMemo(() => {
    const result = [];
    const firstDay    = new Date(calYear, calMonth, 1);
    const lastDay     = new Date(calYear, calMonth + 1, 0);
    const startMonday = getMondayOfDate(firstDay);

    for (let w = 0; w < 6; w++) {
      const monday = new Date(startMonday);
      monday.setDate(startMonday.getDate() + w * 7);
      if (monday > lastDay) break;

      const { year: wYear, week: wNum } = getIsoYearWeek(monday);
      const wKey    = `${wYear}-W${String(wNum).padStart(2, '0')}`;
      const diffMs  = monday.getTime() - todayMonday.getTime();
      const wOffset = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));

      const days = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(monday);
        day.setDate(monday.getDate() + d);
        days.push(day);
      }
      result.push({ monday, days, wKey, wNum, offset: wOffset });
    }
    return result;
  }, [calYear, calMonth]);

  const prevMonth = () => { if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); } else setCalMonth(m => m - 1); };
  const nextMonth = () => { if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); } else setCalMonth(m => m + 1); };

  return (
    <div style={{
      position: 'absolute', top: '110%', left: 0, zIndex: 120,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, boxShadow: 'var(--shadow-pop)',
      padding: 12, width: 276, userSelect: 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <button className="btn icon ghost sm" onClick={prevMonth}><Icon name="chevron-left" size={12}/></button>
        <div style={{ flex: 1, textAlign: 'center', fontWeight: 600, fontSize: 13 }}>{MONTHS[calMonth]} {calYear}</div>
        <button className="btn icon ghost sm" onClick={nextMonth}><Icon name="chevron-right" size={12}/></button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '30px repeat(7, 1fr)', gap: 1, marginBottom: 3 }}>
        <div style={{ fontSize: 9, color: 'var(--text-subtle)', textAlign: 'center' }}>Wk</div>
        {DAYS.map(d => (
          <div key={d} style={{ fontSize: 10, color: 'var(--text-subtle)', textAlign: 'center', fontWeight: 600 }}>{d}</div>
        ))}
      </div>

      {weeksInView.map(({ days, wKey, wNum, offset }) => {
        const isSelected = offset === weekOffset;
        const hasData    = weeksWithData.has(wKey);
        return (
          <div
            key={wKey}
            onClick={() => { onSelectOffset(offset); onClose(); }}
            style={{
              display: 'grid', gridTemplateColumns: '30px repeat(7, 1fr)', gap: 1,
              marginBottom: 2, borderRadius: 6, cursor: 'pointer', padding: '2px 0',
              background: isSelected ? 'var(--accent-soft)' : 'transparent',
              outline: isSelected ? '1.5px solid var(--accent)' : 'none',
            }}
            onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = isSelected ? 'var(--accent-soft)' : 'transparent'; }}
          >
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', fontSize: 9.5, lineHeight: 1.2, gap: 2,
              color: isSelected ? 'var(--accent)' : hasData ? 'var(--text)' : 'var(--text-subtle)',
              fontWeight: isSelected || hasData ? 600 : 400,
            }}>
              <span>{wNum}</span>
              {hasData && (
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: isSelected ? 'var(--accent)' : 'var(--success)', flexShrink: 0 }}/>
              )}
            </div>
            {days.map((day, i) => {
              const isToday        = day.toDateString() === today.toDateString();
              const isCurrentMonth = day.getMonth() === calMonth;
              return (
                <div key={i} style={{
                  textAlign: 'center', fontSize: 11.5, padding: '3px 0',
                  color: isToday ? 'var(--accent)' : !isCurrentMonth ? 'var(--text-subtle)' : 'var(--text)',
                  fontWeight: isToday ? 700 : 400,
                  borderRadius: 4,
                  background: isToday ? 'var(--accent-soft)' : 'transparent',
                }}>
                  {day.getDate()}
                </div>
              );
            })}
          </div>
        );
      })}

      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
        <button className="btn sm ghost" style={{ width: '100%', fontSize: 12 }}
          onClick={() => { onSelectOffset(0); onClose(); }}>
          This week
        </button>
      </div>
    </div>
  );
}

// ── Header dropdown (Data / View menus) ───────────────────────
export function PlHeaderMenu({ label, icon, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="btn sm ghost" onClick={() => setOpen(o => !o)}>
        <Icon name={icon} size={13}/> {label} <Icon name="chevron-down" size={11} style={{ opacity: .5 }}/>
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '115%', minWidth: 210, zIndex: 80,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: 'var(--shadow-pop)', padding: 6, display: 'flex', flexDirection: 'column', gap: 1,
        }}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

export function PlMenuItem({ icon, label, onClick, danger }) {
  const fg = danger ? 'var(--danger)' : 'var(--text)';
  const iconFg = danger ? 'var(--danger)' : 'var(--text-subtle)';
  const hoverBg = danger ? 'var(--danger-soft)' : 'var(--surface-2)';
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px', borderRadius: 6,
      width: '100%', textAlign: 'left', background: 'transparent', border: 0, cursor: 'pointer',
      color: fg, fontSize: 13,
    }}
      onMouseEnter={e => e.currentTarget.style.background = hoverBg}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <Icon name={icon} size={13} style={{ color: iconFg }}/>{label}
    </button>
  );
}

export function PlMenuRadio({ heading, value, options, onChange }) {
  return (
    <div style={{ padding: '4px 5px 6px' }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-subtle)', padding: '2px 6px 6px' }}>{heading}</div>
      <div className="pl-seg" style={{ display: 'flex', width: '100%' }}>
        {options.map(([v, l]) => (
          <button key={v} className={value === v ? 'active' : ''} style={{ flex: 1, justifyContent: 'center' }} onClick={() => onChange(v)}>{l}</button>
        ))}
      </div>
    </div>
  );
}

// ── Delete week modal (two-step: warning + confirm button) ───
export function DeleteWeekModal({ open, onClose, weekLabel, onConfirm }) {
  const [step, setStep] = useState(1);
  const handleClose = () => { setStep(1); onClose(); };
  const handleConfirm = () => { onConfirm(); handleClose(); };

  return (
    <PlModal open={open} onClose={handleClose} icon="trash" title="Delete this week"
      sub={`${weekLabel.full}`}
      footer={(
        <React.Fragment>
          <button className="btn ghost" onClick={handleClose}>Cancel</button>
          {step === 1
            ? <button className="btn danger" onClick={() => setStep(2)}>Delete week…</button>
            : <button className="btn danger" onClick={handleConfirm}>Yes, permanently delete</button>
          }
        </React.Fragment>
      )}>
      {step === 1 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="plm-callout err" style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <Icon name="alert-triangle" size={16} style={{ flexShrink: 0, marginTop: 1 }}/>
            <div>
              <strong>This will permanently delete all planner data for {weekLabel.short}.</strong>
              <div style={{ marginTop: 4, opacity: .85 }}>
                All tasks, meetings, notes, and other entries for this week will be removed from this browser. This cannot be undone.
              </div>
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            Tip: use <strong>Data → Export JSON</strong> to back up this week before deleting.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>
            Are you absolutely sure you want to delete <strong>{weekLabel.short}</strong>?
          </div>
          <div className="plm-callout err">
            <Icon name="alert-triangle" size={13} style={{ marginRight: 6, verticalAlign: 'middle' }}/>
            This is permanent and cannot be undone.
          </div>
        </div>
      )}
    </PlModal>
  );
}
