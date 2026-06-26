import React from 'react';
import { NotificationBanner, Drawer, nexusMDPushPref } from './components.jsx';
import { Icon } from './icons.jsx';
import { PlModal, PlFld, plScrollToEl, plNewRow, PL_OPEN, plIsOverdueYmd } from './planner-ui.jsx';
import { WorkItemCtxLayer, GlobalNotesView, loadGlobalNotes, saveGlobalNotes } from './planner-notes.jsx';
import { SectionCard } from './planner-editors.jsx';
import { GlanceView, collectCarryItems, CarryOverModal } from './planner-glance.jsx';
import { hashPassword, loadConfidentialConfig, saveConfidentialConfig, decryptConfidentialFromServer } from './confidential.jsx';
import {
  PLANNER_SECTIONS, PL_GROUPS, plSectionGroup, getIsoWeek, fmtDateShort,
  getYearWeekForOffset, getMondayOfDate, weekStorageKey, loadWeekPlanner, saveWeekPlanner,
  getWeeksWithData, isLegacyMigrationDone, markLegacyMigrationDone, hasMeaningfulPlannerData,
  buildEmptyPlannerData, checkConfidentialReminders, weekKeyToOffset,
  loadVersions, saveVersions, describeSnapshot, plannerExportDocx,
} from './view-planner.jsx';

// view-planner-2.jsx — Weekly planner v2, part 2: modals, calendar picker, PlannerView.
// Load AFTER view-planner.jsx (part 1 defines DOCX/storage/sections/helpers).

const { useState: useStatePL, useEffect: useEffectPL, useMemo: useMemoPL, useRef: useRefPL, useCallback: useCallbackPL } = React;

// ── Import modal (v1 semantics: { data, themes } envelope, merge) ──
function ImportModal({ open, onClose, onImport }) {
  const [status, setStatus] = useStatePL(null);
  const [pending, setPending] = useStatePL(null);
  const [dragOver, setDragOver] = useStatePL(false);
  const fileRef = useRefPL(null);
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

// ── Versions modal (v1 storage: nexusmd.planner.versions) ────────
function VersionsModal({ open, onClose, currentData, currentThemes, onRestore }) {
  const [versions, setVersions] = useStatePL(() => loadVersions());
  const [labelInput, setLabelInput] = useStatePL('');
  useEffectPL(() => { if (open) setVersions(loadVersions()); }, [open]);

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
function ConfidentialSetPasswordModal({ open, existingHash, onClose, onSaved }) {
  const [pw, setPw] = useStatePL('');
  const [confirm, setConfirm] = useStatePL('');
  const [err, setErr] = useStatePL('');
  const [busy, setBusy] = useStatePL(false);
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

function ConfidentialUnlockModal({ open, onClose, onUnlocked }) {
  const [pw, setPw] = useStatePL('');
  const [err, setErr] = useStatePL('');
  const [busy, setBusy] = useStatePL(false);
  const handleClose = () => { setPw(''); setErr(''); onClose(); };

  const handleUnlock = async () => {
    if (!pw) { setErr('Enter your password.'); return; }
    setBusy(true);
    try {
      const hash = await hashPassword(pw);
      const cfg  = loadConfidentialConfig();

      let remoteDecrypted = null;
      try {
        const remoteRaw = localStorage.getItem('nexusmd.planner.confidential.remote');
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
          localStorage.removeItem('nexusmd.planner.confidential.remote');
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

// ── Week calendar picker (unchanged from v1) ──────────────────
function WeekCalendarPicker({ weekOffset, onSelectOffset, weeksWithData, onClose }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMonday = getMondayOfDate(today);

  const selectedMonday = new Date(todayMonday);
  selectedMonday.setDate(todayMonday.getDate() + weekOffset * 7);

  const [calYear, setCalYear] = useStatePL(() => selectedMonday.getFullYear());
  const [calMonth, setCalMonth] = useStatePL(() => selectedMonday.getMonth());

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAYS   = ['Mo','Tu','We','Th','Fr','Sa','Su'];

  const weeksInView = useMemoPL(() => {
    const result = [];
    const firstDay    = new Date(calYear, calMonth, 1);
    const lastDay     = new Date(calYear, calMonth + 1, 0);
    const startMonday = getMondayOfDate(firstDay);

    for (let w = 0; w < 6; w++) {
      const monday = new Date(startMonday);
      monday.setDate(startMonday.getDate() + w * 7);
      if (monday > lastDay) break;

      const { year: wYear, week: wNum } = getYearWeekForOffset(monday);
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
function PlHeaderMenu({ label, icon, children }) {
  const [open, setOpen] = useStatePL(false);
  const ref = useRefPL(null);
  useEffectPL(() => {
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

function PlMenuItem({ icon, label, onClick, danger }) {
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

function PlMenuRadio({ heading, value, options, onChange }) {
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

// ── Delete week modal (two-step: checkbox + confirm button) ───
function DeleteWeekModal({ open, onClose, weekLabel, onConfirm }) {
  const [step, setStep] = useStatePL(1);
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

// ── PlannerView ───────────────────────────────────────────────
export function PlannerView({ data, setData, themes, setThemes }) {
  // View prefs (persisted + synced)
  const [navMode, setNavMode] = useStatePL(() => localStorage.getItem('nexusmd.planner.nav') || 'rail');
  const [entryMode, setEntryMode] = useStatePL(() => localStorage.getItem('nexusmd.planner.entry') || 'inline');
  useEffectPL(() => { localStorage.setItem('nexusmd.planner.nav', navMode); nexusMDPushPref?.('nexusmd.planner.nav', navMode); }, [navMode]);
  useEffectPL(() => { localStorage.setItem('nexusmd.planner.entry', entryMode); nexusMDPushPref?.('nexusmd.planner.entry', entryMode); }, [entryMode]);

  const [activeGroup, setActiveGroup] = useStatePL(() => {
    // Landing-view pref (Settings → Planner): glance overview or straight to sections
    const landing = localStorage.getItem('nexusmd.planner.landing') || 'glance';
    const initial = landing === 'sections' ? PL_GROUPS[0].id : 'overview';
    return initial;
  });
  const [weekOffset, setWeekOffset] = useStatePL(0);
  const [modal, setModal] = useStatePL(null); // 'import'|'versions'|'setpw'|'unlock'|'carry'|'delete-week'
  const [flash, setFlash] = useStatePL(null);
  const [calendarOpen, setCalendarOpen] = useStatePL(false);
  const [weeksWithData, setWeeksWithData] = useStatePL(() => getWeeksWithData());
  const [isNewWeek, setIsNewWeek] = useStatePL(false);
  const [pendingNotification, setPendingNotification] = useStatePL(null);
  const [dueReminders, setDueReminders] = useStatePL([]);
  const [highlightedRowId, setHighlightedRowId] = useStatePL(null);
  const [carryDismissed, setCarryDismissed] = useStatePL(false);
  // Confidential
  const [confCfg, setConfCfg] = useStatePL(() => loadConfidentialConfig());
  const [unlockedSections, setUnlockedSections] = useStatePL(() => new Set());
  const [pendingUnlockSectionId, setPendingUnlockSectionId] = useStatePL(null);
  const [pendingMark, setPendingMark] = useStatePL(null);
  const [pendingMarkRow, setPendingMarkRow] = useStatePL(null);
  // Week-agnostic notes
  const [gNotes, setGNotesRaw] = useStatePL(() => loadGlobalNotes());
  const setGNotes = useCallbackPL((fn) => setGNotesRaw(prev => {
    const next = typeof fn === 'function' ? fn(prev) : fn;
    saveGlobalNotes(next);
    return next;
  }), []);

  const calendarRef = useRefPL(null);
  const isFirstLoad = useRefPL(true);
  const readyToSave = useRefPL(false);

  const showFlash = (msg) => { setFlash(msg); setTimeout(() => setFlash(null), 2600); };

  // Consume pending navigation set by navigateToPlanner (Calendar "Open in Planner" etc.)
  useEffectPL(() => {
    const nav = window.NexusMDNav;
    if (nav?.view === 'planner') {
      if (nav.pendingFilter) {
        const g = plSectionGroup(nav.pendingFilter);
        if (g) setActiveGroup(g.id);
        setTimeout(() => plScrollToEl('sec-' + nav.pendingFilter), 80);
      }
      if (nav.notification) setPendingNotification(nav.notification);
      window.NexusMDNav = null;
    }
  }, []);

  // Check for due reminders on confidential entries
  useEffectPL(() => {
    const due = checkConfidentialReminders();
    if (due.length > 0) setDueReminders(due);
  }, []);

  // Close calendar on outside click
  useEffectPL(() => {
    if (!calendarOpen) return;
    const onDoc = e => { if (calendarRef.current && !calendarRef.current.contains(e.target)) setCalendarOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [calendarOpen]);

  // Load per-week data whenever the active week changes (v1 logic incl. migration)
  useEffectPL(() => {
    readyToSave.current = false;
    const { year, week } = getYearWeekForOffset(weekOffset);
    const saved = loadWeekPlanner(year, week);

    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      if (saved && saved.data && Object.keys(saved.data).length > 0) {
        setData(d => ({ ...d, ...saved.data }));
        if (saved.themes) setThemes(t => ({ ...t, ...saved.themes }));
        setIsNewWeek(false);
      } else if (!saved && hasMeaningfulPlannerData(data, themes)
                 && !isLegacyMigrationDone() && getWeeksWithData().size === 0) {
        saveWeekPlanner(year, week, data, themes);
        markLegacyMigrationDone();
        setWeeksWithData(getWeeksWithData());
        setIsNewWeek(false);
      } else {
        markLegacyMigrationDone();
        setData({});
        setThemes({});
        setIsNewWeek(true);
      }
    } else {
      if (saved && saved.data && Object.keys(saved.data).length > 0) {
        const newData = buildEmptyPlannerData();
        for (const sec of PLANNER_SECTIONS) {
          if (saved.data[sec.id] != null) newData[sec.id] = saved.data[sec.id];
        }
        if (saved.data._carriedOver) newData._carriedOver = true;
        setData(newData);
        setThemes(saved.themes || {});
        setIsNewWeek(false);
      } else {
        setData({});
        setThemes({});
        setIsNewWeek(true);
      }
    }
    setCarryDismissed(false);
    setTimeout(() => { readyToSave.current = true; }, 60);
  }, [weekOffset]);

  // Auto-save per week
  useEffectPL(() => {
    if (!readyToSave.current) return;
    const { year, week } = getYearWeekForOffset(weekOffset);
    if (hasMeaningfulPlannerData(data, themes)) {
      saveWeekPlanner(year, week, data, themes);
    } else {
      try { localStorage.removeItem(weekStorageKey(year, week)); } catch {}
    }
    setWeeksWithData(getWeeksWithData());
  }, [data, themes]);

  // ── Carry-over ──
  const prevWeekData = useMemoPL(() => {
    const { year, week } = getYearWeekForOffset(weekOffset - 1);
    return loadWeekPlanner(year, week);
  }, [weekOffset, weeksWithData]);
  const carryItems = useMemoPL(() => collectCarryItems(prevWeekData?.data, PLANNER_SECTIONS), [prevWeekData]);
  // Carry-over prompt can be switched off in Settings → Planner
  const carryPromptEnabled = (localStorage.getItem('nexusmd.planner.carryPrompt') || '1') !== '0';
  const showCarryBanner = carryPromptEnabled && !isNewWeek && carryItems.length > 0 && !data._carriedOver && !carryDismissed;

  const handleCarry = (selected) => {
    setData(d => {
      const base = isNewWeek ? buildEmptyPlannerData() : { ...d };
      selected.forEach(i => {
        const arr = (base[i.section.id] || []).slice();
        arr.push({ ...i.row, id: 'co' + Date.now() + Math.random().toString(36).slice(2, 5) });
        base[i.section.id] = arr;
      });
      base._carriedOver = true;
      return base;
    });
    if (isNewWeek) { setThemes({}); setIsNewWeek(false); }
    setModal(null);
    showFlash(`Carried over ${selected.length} item${selected.length !== 1 ? 's' : ''} from last week.`);
  };

  const handleCreateEntry = () => {
    setData(buildEmptyPlannerData());
    setThemes({});
    setIsNewWeek(false);
  };

  // ── Confidential handlers (v1) ──
  const handleMarkConfidential = (sectionId) => {
    if (!confCfg.hash) { setPendingMark(sectionId); setModal('setpw'); }
    else {
      const newCfg = { ...confCfg, sections: [...confCfg.sections, sectionId] };
      setConfCfg(newCfg); saveConfidentialConfig(newCfg);
    }
  };
  const handleRemoveConfidential = (sectionId) => {
    const newCfg = { ...confCfg, sections: confCfg.sections.filter(id => id !== sectionId) };
    setConfCfg(newCfg); saveConfidentialConfig(newCfg);
  };
  const handleLockRow = (sectionId, rowId) => {
    if (!confCfg.hash) { setPendingMarkRow({ sectionId, rowId }); setModal('setpw'); }
    else setData(d => ({ ...d, [sectionId]: (d[sectionId] || []).map(r => r.id === rowId ? { ...r, _confidential: true } : r) }));
  };
  const handleUnlockRow = (sectionId, rowId) => {
    setData(d => ({ ...d, [sectionId]: (d[sectionId] || []).map(r => r.id === rowId ? { ...r, _confidential: false } : r) }));
  };
  const handlePasswordSaved = (hash) => {
    const newCfg = { hash, sections: pendingMark ? [...confCfg.sections, pendingMark] : confCfg.sections };
    setConfCfg(newCfg); saveConfidentialConfig(newCfg);
    setPendingMark(null);
    if (pendingMarkRow) {
      const { sectionId, rowId } = pendingMarkRow;
      setData(d => ({ ...d, [sectionId]: (d[sectionId] || []).map(r => r.id === rowId ? { ...r, _confidential: true } : r) }));
      setPendingMarkRow(null);
    }
  };

  const weekLabel = useMemoPL(() => {
    const now = new Date();
    const day = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - day + 1 + weekOffset * 7);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    const wk = getIsoWeek(monday);
    return { short: `W${wk}`, full: `Week ${wk} · ${fmtDateShort(monday)} - ${fmtDateShort(sunday)}` };
  }, [weekOffset]);

  const { year: cYear, week: cWeek } = getYearWeekForOffset(weekOffset);
  const currentHasData = weeksWithData.has(`${cYear}-W${String(cWeek).padStart(2, '0')}`);
  const lockedRowCount = useMemoPL(() => PLANNER_SECTIONS.reduce((n, s) =>
    n + (s.type === 'table' ? (data[s.id] || []).filter(r => r._confidential && !unlockedSections.has(s.id)).length : 0), 0), [data, unlockedSections]);
  const lockedCount = confCfg.sections.filter(id => !unlockedSections.has(id)).length + lockedRowCount;

  const exportJson = () => {
    const payload = { data, themes, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `planner-${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  };
  const handleImport = (importedData, importedThemes) => {
    if (importedData && typeof importedData === 'object') setData(d => ({ ...d, ...importedData }));
    if (importedThemes && typeof importedThemes === 'object') setThemes(t => ({ ...t, ...importedThemes }));
    if (isNewWeek) setIsNewWeek(false);
    showFlash('Imported successfully.');
  };
  const handleRestore = (restoredData, restoredThemes) => {
    if (restoredData && typeof restoredData === 'object') setData(d => ({ ...d, ...restoredData }));
    if (restoredThemes && typeof restoredThemes === 'object') setThemes(t => ({ ...t, ...restoredThemes }));
    if (isNewWeek) setIsNewWeek(false);
    showFlash('Snapshot restored.');
  };
  const handleDeleteWeek = () => {
    const { year, week } = getYearWeekForOffset(weekOffset);
    const key = weekStorageKey(year, week);
    try { localStorage.removeItem(key); } catch {}
    nexusMDPushPref?.(key, null);
    setData({});
    setThemes({});
    setIsNewWeek(true);
    setWeeksWithData(getWeeksWithData());
    showFlash(`${weekLabel.short} deleted.`);
  };

  const handleViewNotification = useCallbackPL(() => {
    if (!pendingNotification) return;
    const { sectionId, personName, date } = pendingNotification;
    const g = plSectionGroup(sectionId);
    if (g) setActiveGroup(g.id);
    setTimeout(() => plScrollToEl('sec-' + sectionId), 80);
    if (sectionId === 'oneOnOnes') {
      const row = (data.oneOnOnes || []).find(
        r => r.person?.toLowerCase() === (personName || '').toLowerCase() && r.date === date
      );
      if (row) {
        setHighlightedRowId(row.id);
        setTimeout(() => setHighlightedRowId(null), 2500);
      }
    }
    setPendingNotification(null);
  }, [pendingNotification, data]);

  const handleViewReminder = useCallbackPL(() => {
    if (!dueReminders.length) return;
    const first = dueReminders[0];
    if (first.weekOffset !== 0) setWeekOffset(first.weekOffset);
    const g = plSectionGroup(first.sectionId);
    if (g) setActiveGroup(g.id);
    setTimeout(() => plScrollToEl('sec-' + first.sectionId), 100);
    setHighlightedRowId(first.rowId);
    setTimeout(() => setHighlightedRowId(null), 2500);
    const dismissKey = 'nexusmd.planner.reminderDismissed';
    const dismissed = new Set();
    try { JSON.parse(localStorage.getItem(dismissKey) || '[]').forEach(k => dismissed.add(k)); } catch {}
    dismissed.add(first.rowId + ':' + first.reminderDate);
    try { localStorage.setItem(dismissKey, JSON.stringify([...dismissed])); } catch {}
    setDueReminders(prev => prev.slice(1));
  }, [dueReminders]);

  const handleDismissReminders = useCallbackPL(() => {
    const dismissKey = 'nexusmd.planner.reminderDismissed';
    const dismissed = new Set();
    try { JSON.parse(localStorage.getItem(dismissKey) || '[]').forEach(k => dismissed.add(k)); } catch {}
    dueReminders.forEach(r => dismissed.add(r.rowId + ':' + r.reminderDate));
    try { localStorage.setItem(dismissKey, JSON.stringify([...dismissed])); } catch {}
    setDueReminders([]);
  }, [dueReminders]);

  // Glance visibility: hide locked sections + locked rows
  const rowVisible = useCallbackPL((sec, row) => {
    if (!sec) return false;
    if (confCfg.sections.includes(sec.id) && !unlockedSections.has(sec.id)) return false;
    if (row._confidential && !unlockedSections.has(sec.id)) return false;
    return true;
  }, [confCfg, unlockedSections]);

  // Global notes → "Task this week"
  const addTaskFromNote = (title) => {
    const sec = PLANNER_SECTIONS.find(s => s.id === 'tasks');
    setData(d => {
      const base = isNewWeek ? buildEmptyPlannerData() : { ...d };
      base.tasks = [...(base.tasks || []), plNewRow(sec, { task: title, priority: '3 - Medium' })];
      return base;
    });
    if (isNewWeek) { setThemes({}); setIsNewWeek(false); }
    showFlash(`Added as a task in ${weekLabel.short}.`);
  };

  const sectionProps = (sectionId) => ({
    isConfidential: confCfg.sections.includes(sectionId),
    sessionUnlocked: unlockedSections.has(sectionId),
    onMarkConfidential:   () => handleMarkConfidential(sectionId),
    onRemoveConfidential: () => handleRemoveConfidential(sectionId),
    onUnlockRequest:      () => { setPendingUnlockSectionId(sectionId); setModal('unlock'); },
    onLockRow:   (rowId) => handleLockRow(sectionId, rowId),
    onUnlockRow: (rowId) => handleUnlockRow(sectionId, rowId),
  });

  const renderSection = (sec) => (
    <SectionCard key={sec.id} section={sec} data={data} setData={setData} themes={themes} setThemes={setThemes}
      entryStyle={entryMode} domId={'sec-' + sec.id}
      highlightedRowId={highlightedRowId}
      meetingOptions={sec.id === 'meetNotes' ? (data.meetSched || []) : null}
      {...sectionProps(sec.id)}/>
  );

  const groupHeader = (g) => (
    <div key={'h' + g.id} id={'grp-' + g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '22px 0 10px', scrollMarginTop: 64 }}>
      <span style={{ color: 'var(--text-subtle)', display: 'flex' }}><Icon name={g.icon} size={14}/></span>
      <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{g.label}</span>
      <span style={{ flex: 1, height: 1, background: 'var(--border)' }}></span>
    </div>
  );

  const openGroup = (gid) => {
    setActiveGroup(gid);
    if (navMode === 'scroll') setTimeout(() => plScrollToEl('grp-' + gid), 30);
  };
  const openSection = (sid) => {
    const g = plSectionGroup(sid);
    setActiveGroup(g ? g.id : 'overview');
    setTimeout(() => plScrollToEl('sec-' + sid), 80);
  };

  const openNotesCount = gNotes.filter(n => n.status !== 'done').length;
  const navGroups = [
    { id: 'overview', label: 'Overview', icon: 'dashboard' },
    { id: 'mynotes', label: 'Notes', icon: 'pin' },
    ...PL_GROUPS,
  ];

  const glance = (
    <GlanceView data={data} themes={themes} sections={PLANNER_SECTIONS} groups={PL_GROUPS}
      onOpenGroup={openGroup} onOpenSection={openSection} rowVisible={rowVisible}
      carryCount={showCarryBanner ? carryItems.length : 0} onOpenCarry={() => setModal('carry')}/>
  );
  const notesView = (
    <GlobalNotesView notes={gNotes} setNotes={setGNotes} weekLabel={weekLabel.short} onAddTask={addTaskFromNote}/>
  );

  const modals = (
    <React.Fragment>
      <ImportModal open={modal === 'import'} onClose={() => setModal(null)} onImport={handleImport}/>
      <VersionsModal open={modal === 'versions'} onClose={() => setModal(null)} currentData={data} currentThemes={themes} onRestore={handleRestore}/>
      <ConfidentialSetPasswordModal
        open={modal === 'setpw'} existingHash={confCfg.hash}
        onClose={() => { setModal(null); setPendingMark(null); setPendingMarkRow(null); }}
        onSaved={handlePasswordSaved}/>
      <ConfidentialUnlockModal
        open={modal === 'unlock'} onClose={() => setModal(null)}
        onUnlocked={() => {
          const latestCfg = loadConfidentialConfig();
          setConfCfg(latestCfg);
          if (pendingUnlockSectionId !== null) {
            setUnlockedSections(prev => new Set([...prev, pendingUnlockSectionId]));
          } else {
            setUnlockedSections(new Set([...latestCfg.sections, ...PLANNER_SECTIONS.map(s => s.id)]));
          }
          setPendingUnlockSectionId(null);
        }}/>
      <CarryOverModal open={modal === 'carry'} onClose={() => { setModal(null); setCarryDismissed(true); }}
        items={carryItems} prevLabel={`W${getYearWeekForOffset(weekOffset - 1).week}`} onCarry={handleCarry}/>
      <DeleteWeekModal open={modal === 'delete-week'} onClose={() => setModal(null)}
        weekLabel={weekLabel} onConfirm={handleDeleteWeek}/>
      <WorkItemCtxLayer/>
    </React.Fragment>
  );

  // ── Header ──
  const header = (
    <div className="page-head">
      <div>
        <h1>Weekly planner</h1>
        <div className="sub">{weekLabel.full} · personal running notes</div>
      </div>
      <div className="page-head-actions">
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 2, position: 'relative' }} ref={calendarRef}>
          <button className="btn icon ghost sm" onClick={() => setWeekOffset(w => w - 1)} title="Previous week"><Icon name="chevron-left" size={13}/></button>
          <button className="btn sm ghost" onClick={() => setCalendarOpen(o => !o)} title="Choose a week"
            style={{ fontWeight: 600, fontFamily: 'var(--mono)', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 6px' }}>
            {weekLabel.short}
            {currentHasData && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--success)' }} title="This week has saved data"></span>}
          </button>
          <button className="btn icon ghost sm" onClick={() => setWeekOffset(w => w + 1)} title="Next week"><Icon name="chevron-right" size={13}/></button>
          {calendarOpen && (
            <WeekCalendarPicker weekOffset={weekOffset} onSelectOffset={setWeekOffset}
              weeksWithData={weeksWithData} onClose={() => setCalendarOpen(false)}/>
          )}
        </div>
        {weekOffset !== 0 && <button className="btn sm ghost" onClick={() => setWeekOffset(0)}>This week</button>}

        {lockedCount > 0 && (
          <button className="btn sm ghost" onClick={() => { setPendingUnlockSectionId(null); setModal('unlock'); }} title="Unlock all confidential sections"
            style={{ color: 'var(--text-subtle)' }}>
            <Icon name="lock" size={13}/> {lockedCount} locked
          </button>
        )}
        {unlockedSections.size > 0 && (
          <button className="btn sm ghost" onClick={() => setUnlockedSections(new Set())} title="Re-lock all confidential sections"
            style={{ color: 'var(--accent)' }}>
            <Icon name="lock" size={13}/> Re-lock
          </button>
        )}

        {!isNewWeek && (
          <React.Fragment>
            <PlHeaderMenu label="View" icon="board">
              {() => (
                <React.Fragment>
                  <PlMenuRadio heading="Navigation" value={navMode}
                    options={[['rail', 'Rail'], ['scroll', 'Scroll'], ['tabs', 'Tabs']]} onChange={setNavMode}/>
                  <PlMenuRadio heading="Entry style" value={entryMode}
                    options={[['inline', 'Inline'], ['quickadd', 'Quick-add'], ['drawer', 'Drawer']]} onChange={setEntryMode}/>
                </React.Fragment>
              )}
            </PlHeaderMenu>
            <PlHeaderMenu label="Data" icon="inbox">
              {(close) => (
                <React.Fragment>
                  <PlMenuItem icon="inbox" label="Import JSON…" onClick={() => { close(); setModal('import'); }}/>
                  <PlMenuItem icon="send" label="Export JSON" onClick={() => { close(); exportJson(); }}/>
                  <PlMenuItem icon="send" label="Export Word (.docx)" onClick={() => { close(); plannerExportDocx(data, themes, new Date().toISOString().slice(0, 10)); }}/>
                  <div style={{ height: 1, background: 'var(--border)', margin: '3px 6px' }}></div>
                  <PlMenuItem icon="clock" label="Versions…" onClick={() => { close(); setModal('versions'); }}/>
                  <div style={{ height: 1, background: 'var(--border)', margin: '3px 6px' }}></div>
                  <PlMenuItem icon="trash" label="Delete this week…" danger onClick={() => { close(); setModal('delete-week'); }}/>
                </React.Fragment>
              )}
            </PlHeaderMenu>
          </React.Fragment>
        )}
      </div>
    </div>
  );

  // ── Empty week ──
  if (isNewWeek) {
    return (
      <div data-screen-label="Planner — empty week">
        {header}
        <div className="pl-empty-week">
          <span className="plm-ic" style={{ width: 52, height: 52, borderRadius: 14 }}><Icon name="planner" size={22}/></span>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>No planner for this week</div>
            <div style={{ fontSize: 13, color: 'var(--text-subtle)', marginTop: 4 }}>{weekLabel.full}</div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn" onClick={handleCreateEntry}><Icon name="plus" size={14}/> Make new entry</button>
            {carryItems.length > 0 && (
              <button className="btn primary" onClick={() => setModal('carry')}>
                <Icon name="refresh" size={13}/> Carry over {carryItems.length} unfinished
              </button>
            )}
          </div>
          {carryItems.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
              {carryItems.filter(i => i.why === 'overdue').length} overdue · {carryItems.filter(i => i.why === 'blocked').length} blocked · from last week
            </div>
          )}
        </div>
        {modals}
      </div>
    );
  }

  return (
    <div data-screen-label="Planner">
      {header}

      {dueReminders.length > 0 && (
        <NotificationBanner
          label={dueReminders.length === 1
            ? `Reminder due: confidential entry (${dueReminders[0].reminderDate})`
            : `${dueReminders.length} reminders due on confidential entries`}
          onView={handleViewReminder}
          onDismiss={handleDismissReminders}
        />
      )}

      {pendingNotification && (
        <NotificationBanner
          label={pendingNotification.label}
          onView={handleViewNotification}
          onDismiss={() => setPendingNotification(null)}
        />
      )}
      {flash && <div className="pl-flash"><Icon name="check-circle" size={13}/> {flash}</div>}

      {navMode === 'rail' && (
        <div className="pl-layout">
          <nav className="pl-rail">
            {navGroups.map(g => {
              const secLockedHere = g.ids && g.ids.some(id => confCfg.sections.includes(id) && !unlockedSections.has(id));
              const counts = (g.ids || []).reduce((n, id) => {
                const sec = PLANNER_SECTIONS.find(s => s.id === id);
                if (!sec || sec.type !== 'table') return n;
                return n + (data[id] || []).filter(r => PL_OPEN(r.status || '') && rowVisible(sec, r)).length;
              }, 0);
              const hasAlert = (g.ids || []).some(id => {
                const sec = PLANNER_SECTIONS.find(s => s.id === id);
                if (!sec || sec.type !== 'table') return false;
                const dc = sec.cols.find(c => c.t === 'date');
                return (data[id] || []).some(r => rowVisible(sec, r) && (r.status === 'Blocked' || (dc && plIsOverdueYmd(r[dc.k], r.status))));
              });
              return (
                <button key={g.id} className={`pl-rail-item ${activeGroup === g.id ? 'active' : ''}`} onClick={() => setActiveGroup(g.id)}>
                  <span className="ic"><Icon name={g.icon} size={14}/></span>
                  {g.label}
                  {g.id === 'mynotes' && openNotesCount > 0 && <span className="count">{openNotesCount}</span>}
                  {g.ids && (hasAlert ? <span className="dot-alert" title="Overdue or blocked items"></span>
                    : secLockedHere && counts === 0 ? <Icon name="lock" size={10} style={{ marginLeft: 'auto', opacity: .4 }}/>
                    : counts > 0 ? <span className="count">{counts}</span> : null)}
                </button>
              );
            })}
          </nav>
          <div style={{ minWidth: 0 }}>
            {activeGroup === 'overview' ? glance
              : activeGroup === 'mynotes' ? notesView
              : (PL_GROUPS.find(g => g.id === activeGroup) || PL_GROUPS[0]).ids.map(id => renderSection(PLANNER_SECTIONS.find(s => s.id === id)))}
          </div>
        </div>
      )}

      {navMode === 'scroll' && (
        <div>
          <div className="pl-chipnav">
            {navGroups.map(g => (
              <button key={g.id} className={`pl-chip ${activeGroup === g.id ? 'active' : ''}`}
                onClick={() => { setActiveGroup(g.id); plScrollToEl('grp-' + g.id); }}>
                <Icon name={g.icon} size={12}/>{g.label}
              </button>
            ))}
          </div>
          <div id="grp-overview" style={{ scrollMarginTop: 64, marginBottom: 8 }}>{glance}</div>
          {PL_GROUPS.map(g => (
            <React.Fragment key={g.id}>
              {groupHeader(g)}
              {g.ids.map(id => renderSection(PLANNER_SECTIONS.find(s => s.id === id)))}
            </React.Fragment>
          ))}
          {groupHeader({ id: 'mynotes', label: 'Notes (week-agnostic)', icon: 'pin' })}
          {notesView}
        </div>
      )}

      {navMode === 'tabs' && (
        <div>
          <div style={{ marginBottom: 14 }}>
            <div className="pl-seg">
              {navGroups.map(g => (
                <button key={g.id} className={activeGroup === g.id ? 'active' : ''} onClick={() => setActiveGroup(g.id)}>
                  <Icon name={g.icon} size={12}/>{g.label}
                </button>
              ))}
            </div>
          </div>
          {activeGroup === 'overview' ? glance
            : activeGroup === 'mynotes' ? notesView
            : (PL_GROUPS.find(g => g.id === activeGroup) || PL_GROUPS[0]).ids.map(id => renderSection(PLANNER_SECTIONS.find(s => s.id === id)))}
        </div>
      )}

      {modals}
    </div>
  );
}
