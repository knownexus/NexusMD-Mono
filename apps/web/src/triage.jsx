import React from 'react';
import { NexusMDData } from './data.js';
// triage.jsx — shared triage-export controls used by both the Dashboard and Work Items views.
//   <TriageExportButton/>  — pulls open work items from ADO into triage-tracker/exports and refreshes the .xlsx
//   <TriageStatusLine/>    — small line showing when the tracker was last generated

import { Icon } from './icons.jsx';
import { toast } from './toast.jsx';
import { timeAgo } from '@nexusmd/core';

// Tiny bus so a successful export tells any visible status lines to re-fetch.
export const TriageEvents = (() => {
  const subs = new Set();
  return { sub: (fn) => { subs.add(fn); return () => subs.delete(fn); }, fire: () => subs.forEach(fn => fn()) };
})();

export function TriageExportButton({ label = 'Generate triage export', availableStates }) {
  const [busy,      setBusy]      = React.useState(false);
  const [showModal, setShowModal] = React.useState(false);

  async function run(filters) {
    setShowModal(false);
    if (busy) return;
    setBusy(true);
    const tid = toast ? toast('Generating triage export…', 'loading', { duration: 0 }) : null;
    try {
      const resp = await fetch('/api/triage/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filters),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) throw new Error(data.error || `Export failed (${resp.status})`);
      const detail = `${data.itemsExported} items` + (data.xlsxRegenerated ? ' · tracker refreshed' : ' · CSV written');
      toast?.(`Triage export complete — ${detail}`, 'success');
      TriageEvents.fire();
    } catch (e) {
      toast?.(e.message || 'Triage export failed', 'error', { duration: 7000 });
    } finally {
      if (tid != null) toast?.dismiss(tid);
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn sm ghost" onClick={() => setShowModal(true)} disabled={busy}
        title="Pull open work items from Azure DevOps and write the triage CSV into triage-tracker/exports">
        <Icon name="refresh" size={13}/> {busy ? 'Generating…' : label}
      </button>
      {showModal && <TriageExportModal onClose={() => setShowModal(false)} onExport={run} availableStates={availableStates}/>}
    </>
  );
}

export function TriageStatusLine({ style }) {
  const [status, setStatus] = React.useState(null);

  const refresh = React.useCallback(async () => {
    try {
      const r = await fetch('/api/triage/status');
      if (r.ok) setStatus(await r.json());
    } catch (_) { /* leave previous status */ }
  }, []);

  React.useEffect(() => { refresh(); return TriageEvents.sub(refresh); }, [refresh]);

  let text, ok = false;
  if (!status)             text = 'Checking tracker…';
  else if (!status.exists) text = 'Tracker not generated yet';
  else {
    ok = true;
    const when = `${timeAgo(status.lastGeneratedUtc)} ago`;
    text = `Tracker generated ${when}` + (status.itemCount != null ? ` · ${status.itemCount} open items` : '');
  }

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 11.5, color: 'var(--text-subtle, #999)', fontFamily: 'var(--sans)', whiteSpace: 'nowrap',
      ...style,
    }}>
      {ok && <Icon name="check" size={11} />}
      {text}
    </span>
  );
}

export function TriageExportModal({ onClose, onExport, availableStates }) {
  const configProjects = (NexusMDData && NexusMDData.CONFIG_PROJECTS) || [];
  const terminalStates = ['Closed', 'Resolved', 'Removed', 'Done', 'Completed'];
  // Prefer states derived from actual ADO data (passed from caller); fall back to NexusMDData.STATES
  const allStates = (availableStates?.length > 0
    ? availableStates
    : ((NexusMDData && NexusMDData.STATES) || ['New', 'Active', 'Resolved', 'Approved', 'Committed'])
  ).filter(s => !terminalStates.includes(s));
  const team = (NexusMDData && NexusMDData.TEAM) || [];

  const [projects,  setProjects]  = React.useState(configProjects.slice());
  const [states,    setStates]    = React.useState(allStates.slice());
  const [assignee,  setAssignee]  = React.useState('');
  const [dateFrom,  setDateFrom]  = React.useState('');
  const [dateTo,    setDateTo]    = React.useState('');
  const [tags,      setTags]      = React.useState('');
  const [excludeTags, setExcludeTags] = React.useState('');

  const ref = React.useRef(null);
  React.useEffect(() => {
    const onMouse = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey   = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('keydown',   onKey);
    return () => { document.removeEventListener('mousedown', onMouse); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const toggle = (arr, setArr, v) => setArr(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

  const label11 = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 5 };
  const inputStyle = { width: '100%', fontSize: 12.5, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', boxSizing: 'border-box' };

  return (
    <div id="modal-triage-export" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div ref={ref} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-pop)', padding: '20px 22px', width: 420, maxHeight: '82vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Export options</h3>
          <button className="btn icon ghost sm" onClick={onClose}><Icon name="x" size={13}/></button>
        </div>

        {configProjects.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <span style={label11}>Projects</span>
            {configProjects.map(p => (
              <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer', padding: '2px 0' }}>
                <input type="checkbox" checked={projects.includes(p)} onChange={() => toggle(projects, setProjects, p)} style={{ margin: 0 }}/>
                {p}
              </label>
            ))}
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <span style={label11}>States</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px' }}>
            {allStates.map(s => (
              <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer', padding: '2px 0' }}>
                <input type="checkbox" checked={states.includes(s)} onChange={() => toggle(states, setStates, s)} style={{ margin: 0 }}/>
                {s}
              </label>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label11}>Assignee</label>
          <select value={assignee} onChange={e => setAssignee(e.target.value)} style={inputStyle}>
            <option value="">All</option>
            <option value="__unassigned__">Unassigned only</option>
            {team.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 14, display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={label11}>Changed after</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputStyle}/>
          </div>
          <div style={{ flex: 1 }}>
            <label style={label11}>Changed before</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputStyle}/>
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={label11}>Tags (comma-separated, any match)</label>
          <input type="text" value={tags} onChange={e => setTags(e.target.value)} placeholder="bug, regression, …" style={inputStyle}/>
          <input type="text" value={excludeTags} onChange={e => setExcludeTags(e.target.value)} placeholder="Parked, blocked, …" style={inputStyle}/>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn sm ghost" onClick={onClose}>Cancel</button>
          <button className="btn sm primary" onClick={() => {
            if (states.length === 0) { toast?.('Select at least one state to export.', 'warning'); return; }
            if (configProjects.length > 0 && projects.length === 0) { toast?.('Select at least one project to export.', 'warning'); return; }
            onExport({
              projects,
              states,
              assignee: assignee === '__unassigned__' ? '' : (assignee || null),
              dateFrom: dateFrom || null,
              dateTo:   dateTo   || null,
              tags: tags.split(',').map(t => t.trim()).filter(Boolean),
              excludedTags: excludeTags.split(',').map(t => t.trim()).filter(Boolean),
            });
          }}>
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
