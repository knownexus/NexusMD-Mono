import React from 'react';
import flatpickr from 'flatpickr';
import 'flatpickr/dist/flatpickr.min.css';
import {
  PL_STATUSES, PL_PRIOS, PL_OPEN,
  plTodayDate, plParseYmd, plFmtYmd, plIsOverdueYmd, plIsTodayYmd, qaParseDue,
} from '@nexusmd/core';
import { StatusChip, PrioChip, PlModal, PlFld, DueLabel } from '../planner-chips.jsx';
import { plOpenCtx } from './planner-notes.jsx';
// primitives.jsx — Planner v2 input primitives (date/time pickers, ColInput, qaParse).
// Shared across web + app. The chips/modal/labels come from ../planner-chips.jsx and
// the constants/date helpers from @nexusmd/core; both are re-exported for convenience.
const { useState: useStatePU, useEffect: useEffectPU, useCallback: useCallbackPU, useRef: useRefPU } = React;

// Re-export the constants/chips that planner consumers historically imported from here.
export {
  PL_STATUSES, PL_PRIOS, PL_OPEN,
  plTodayDate, plParseYmd, plFmtYmd, plIsOverdueYmd, plIsTodayYmd, qaParseDue,
  StatusChip, PrioChip, PlModal, PlFld, DueLabel,
};

// Calendar date picker backed by Flatpickr. Stores/returns 'YYYY-MM-DD' strings. Internal to ColInput.
export function PlannerDatePicker({ value, onChange, autoFocus }) {
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
export function PlannerDateTimePicker({ value, onChange, autoFocus }) {
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
export function ColInput({ col, value, onChange, autoFocus, datalistId, meetingOptions }) {
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

// DueLabel now comes from @nexusmd/ui (imported + re-exported).

// ── Quick-add parser ("Send budget update due:fri p2") ───────
// qaParseDue now comes from @nexusmd/core (imported above).
export function qaParse(text, section) {
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

export function plNewRow(section, patch) {
  const b = { id: 'r' + Date.now() + Math.random().toString(36).slice(2, 6) };
  section.cols.forEach(c => { b[c.k] = c.t === 'status' ? 'To Do' : ''; });
  if (section.defaultConfidential) b._confidential = true;
  return { ...b, ...patch };
}

// Find nearest scrollable ancestor (the app's main pane) for section jumps.
export function plScrollToEl(id) {
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

// (Functions are exported inline; constants/chips are re-exported at the top.)