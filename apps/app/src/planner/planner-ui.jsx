import React from 'react';
import { Icon } from '../icons.jsx';
import flatpickr from 'flatpickr';
import {
  PL_STATUSES, PL_PRIOS, PL_OPEN,
  plTodayDate, plParseYmd, plFmtYmd, plIsOverdueYmd, plIsTodayYmd, qaParseDue,
} from '@nexusmd/core';
// planner-ui.jsx — Planner v2 shared primitives (live in wwwroot alongside components.jsx)
// Load AFTER icons.jsx/components.jsx and BEFORE planner-notes.jsx / planner-editors.jsx / view-planner.jsx.
// PL_STATUSES/PL_PRIOS/PL_OPEN + ymd date helpers now come from @nexusmd/core (imported above).
const { useState: useStatePU, useEffect: useEffectPU, useCallback: useCallbackPU, useRef: useRefPU } = React;

// ── Status select rendered as a colored chip ──────────────────
function StatusChip({ value, onChange, stopClick, readOnly }) {
  return (
    <span className="stchip" data-s={value || ''} onClick={stopClick ? e => e.stopPropagation() : undefined}>
      <span className="face"><span className="cdot"></span>{value || '—'}</span>
      {!readOnly && (
        <select value={value || ''} onChange={e => onChange(e.target.value)} aria-label="Status">
          {PL_STATUSES.map(s => <option key={s} value={s}>{s || '—'}</option>)}
        </select>
      )}
    </span>
  );
}

function PrioChip({ value, onChange, stopClick, readOnly }) {
  const n = value ? value[0] : '';
  return (
    <span className="stchip" onClick={stopClick ? e => e.stopPropagation() : undefined}>
      <span className={`priochip p${n || 4}`} style={!value ? { opacity: 0.45 } : null}>{value ? 'P' + n : '—'}</span>
      {!readOnly && (
        <select value={value || ''} onChange={e => onChange(e.target.value)} aria-label="Priority">
          {PL_PRIOS.map(p => <option key={p} value={p}>{p || '—'}</option>)}
        </select>
      )}
    </span>
  );
}

// ── Unified modal (every planner dialog uses this shell) ──────
function PlModal({ open, onClose, icon, title, sub, wide, className, children, footer, footerLeft }) {
  useEffectPU(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="plm-veil" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`plm ${wide ? 'wide' : ''} ${className || ''}`} role="dialog" aria-modal="true">
        <div className="plm-head">
          {icon && <span className="plm-ic"><Icon name={icon} size={16}/></span>}
          <div className="plm-ttl">
            <h2>{title}</h2>
            {sub && <div className="sub">{sub}</div>}
          </div>
          <button className="btn icon ghost sm" onClick={onClose} aria-label="Close"><Icon name="x" size={14}/></button>
        </div>
        <div className="plm-body">{children}</div>
        {(footer || footerLeft) && (
          <div className="plm-foot">
            {footerLeft && <span className="left">{footerLeft}</span>}
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// Labeled form field (drawers, modals)
function PlFld({ label, children, span }) {
  return (
    <div className="fld" style={span ? { gridColumn: `span ${span}` } : null}>
      <label>{label}</label>
      {children}
    </div>
  );
}

// Calendar date picker backed by Flatpickr. Stores/returns 'YYYY-MM-DD' strings. Internal to ColInput.
function PlannerDatePicker({ value, onChange, autoFocus }) {
  const inputRef = useRefPU(null);
  const fpRef = useRefPU(null);
  const onChangeRef = useRefPU(onChange);
  onChangeRef.current = onChange;

  useEffectPU(() => {
    const fp = flatpickr(inputRef.current, {
      dateFormat: 'Y-m-d',
      allowInput: true,
      onChange: (_, dateStr) => onChangeRef.current(dateStr),
    });
    fpRef.current = fp;
    if (autoFocus) fp.open();
    return () => fp.destroy();
  }, []);

  useEffectPU(() => {
    if (fpRef.current) fpRef.current.setDate(value || '', false);
  }, [value]);

  return <input ref={inputRef} type="text" placeholder="—" aria-label="Date" style={{ cursor: 'pointer' }}/>;
}

// Date + time picker (flatpickr with enableTime). Stores/returns 'D H:i' strings e.g. "Mon 14:30".
function PlannerDateTimePicker({ value, onChange, autoFocus }) {
  const inputRef = useRefPU(null);
  const fpRef = useRefPU(null);
  const onChangeRef = useRefPU(onChange);
  onChangeRef.current = onChange;

  useEffectPU(() => {
    const fp = flatpickr(inputRef.current, {
      enableTime: true,
      dateFormat: 'D H:i',
      time_24hr: true,
      allowInput: true,
      onChange: (_, dateStr) => onChangeRef.current(dateStr),
    });
    fpRef.current = fp;
    if (autoFocus) fp.open();
    return () => fp.destroy();
  }, []);

  useEffectPU(() => {
    if (fpRef.current) fpRef.current.setDate(value || '', false);
  }, [value]);

  return <input ref={inputRef} type="text" placeholder="—" aria-label="Day / time" style={{ cursor: 'pointer' }}/>;
}

// Inline editor for a single cell value, given a column def — shared by entry styles.
// `meetingOptions` renders a <select> for the meetNotes meeting column; `datalistId` for other autocomplete uses.
function ColInput({ col, value, onChange, autoFocus, datalistId, meetingOptions }) {
  const taRef = useCallbackPU(el => {
    if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
  }, []);
  if (col.t === 'date') return <PlannerDatePicker value={value} onChange={onChange} autoFocus={autoFocus}/>;
  if (col.t === 'datetime') return <PlannerDateTimePicker value={value} onChange={onChange} autoFocus={autoFocus}/>;
  if (col.t === 'sel') return (
    <select value={value || ''} onChange={e => onChange(e.target.value)} autoFocus={autoFocus}>
      {(col.o || []).map(o => <option key={o} value={o}>{o || '—'}</option>)}
    </select>
  );
  if (col.t === 'status') return <StatusChip value={value} onChange={onChange}/>;
  if (col.t === 'prio') return <PrioChip value={value} onChange={onChange}/>;
  if (meetingOptions) return (
    <select value={value || ''} onChange={e => onChange(e.target.value)} autoFocus={autoFocus}>
      <option value="">— select meeting —</option>
      {meetingOptions.filter(m => m.meeting && m.meeting.trim()).map((m, i) => (
        <option key={m.id || i} value={m.meeting}>
          {m.dayTime ? `${m.dayTime}: ${m.meeting}` : m.meeting}
        </option>
      ))}
    </select>
  );
  if (datalistId) return (
    <input type="text" list={datalistId} value={value || ''} autoFocus={autoFocus}
      onChange={e => onChange(e.target.value)}
      onContextMenu={e => plOpenCtx(e, value || '')}
      placeholder="Select or type…"/>
  );
  return (
    <textarea rows={1} value={value || ''} autoFocus={autoFocus}
      ref={taRef}
      onChange={e => onChange(e.target.value)}
      onContextMenu={e => plOpenCtx(e, value || '')}
      onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}/>
  );
}

// Compact date renderer with overdue/today coloring
function DueLabel({ value, status }) {
  if (!value) return <span style={{ color: 'var(--text-subtle)' }}>—</span>;
  const d = plParseYmd(value);
  if (!d) return <span style={{ color: 'var(--text-subtle)' }}>{value}</span>;
  const overdue = plIsOverdueYmd(value, status);
  const today = plIsTodayYmd(value);
  return (
    <span style={{
      fontFamily: 'var(--mono)', fontSize: 11.5, whiteSpace: 'nowrap',
      color: overdue ? 'var(--danger)' : today ? 'var(--accent)' : 'var(--text-muted)',
      fontWeight: overdue || today ? 600 : 400,
    }}>
      {today ? 'Today' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
      {overdue && ' !'}
    </span>
  );
}

// ── Quick-add parser ("Send budget update due:fri p2") ───────
// qaParseDue now comes from @nexusmd/core (imported above).
function qaParse(text, section) {
  const out = {};
  let rest = text;
  const prioCol = section.cols.find(c => c.t === 'prio');
  const dateCol = section.cols.find(c => c.t === 'date');
  const mainCol = section.cols.find(c => c.main) || section.cols[0];
  if (prioCol) {
    const m = rest.match(/(?:^|\s)p([1-4])(?=\s|$)/i);
    if (m) { out[prioCol.k] = PL_PRIOS[Number(m[1])]; rest = rest.replace(m[0], ' '); }
  }
  if (dateCol) {
    const m = rest.match(/(?:^|\s)due:(\S+)/i);
    if (m) { const d = qaParseDue(m[1]); if (d) out[dateCol.k] = d; rest = rest.replace(m[0], ' '); }
  }
  out[mainCol.k] = rest.replace(/\s+/g, ' ').trim();
  return out;
}

function plNewRow(section, patch) {
  const b = { id: 'r' + Date.now() + Math.random().toString(36).slice(2, 6) };
  section.cols.forEach(c => { b[c.k] = c.t === 'status' ? 'To Do' : ''; });
  if (section.defaultConfidential) b._confidential = true;
  return { ...b, ...patch };
}

// Find nearest scrollable ancestor (the app's main pane) for section jumps.
function plScrollToEl(id) {
  const el = document.getElementById(id);
  if (!el) return;
  let p = el.parentElement;
  while (p) {
    const s = getComputedStyle(p);
    if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight) break;
    p = p.parentElement;
  }
  const scroller = p || document.scrollingElement;
  const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 58;
  scroller.scrollTo({ top, behavior: 'smooth' });
}

Object.assign(window, {
  PL_STATUSES, PL_PRIOS, PL_OPEN,
  plTodayDate, plParseYmd, plFmtYmd, plIsOverdueYmd, plIsTodayYmd,
  StatusChip, PrioChip, PlModal, PlFld, ColInput, DueLabel,
  qaParse, qaParseDue, plNewRow, plScrollToEl,
});
export {
  PL_STATUSES, PL_PRIOS, PL_OPEN,
  plTodayDate, plParseYmd, plFmtYmd, plIsOverdueYmd, plIsTodayYmd,
  StatusChip, PrioChip, PlModal, PlFld,
  PlannerDatePicker, PlannerDateTimePicker,
  ColInput, DueLabel, qaParseDue, qaParse, plNewRow, plScrollToEl,
};