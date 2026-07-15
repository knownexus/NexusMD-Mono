import React from 'react';
// view-triage.jsx — interactive "Unassigned To-Do Triage" tab. Shared web + desktop.
// Live view of open + unassigned work items from /api/triage/items, with the same
// area / bucket / priority model as the Unassigned_ToDo_Triage_Tracker spreadsheet.
// Rows are expandable: click to reveal triage edit fields + full work item content.
// /api/triage/* is served by the web host; on desktop those calls degrade (the
// list/edits need the ASP.NET host) — the shell still renders.

import { Icon } from '../icons.jsx';
import { TriageEvents, TriageExportButton, TriageStatusLine } from './triage.jsx';
import { WorkItemDetail } from './work-item-detail.jsx';
import { usePersisted } from '../app-components.jsx';
import { toast } from '../toast.jsx';
import { useNexusData } from '../data-context.jsx';

const BUCKET_META = {
  'Decision':        { color: 'var(--danger)',  label: 'Needs decision' },
  'Flesh out':       { color: 'var(--warning, #c98a1b)', label: 'Needs flesh out' },
  'Ready to assign': { color: 'var(--success)', label: 'Ready to assign' },
};
const BUCKET_ORDER  = ['Decision', 'Flesh out', 'Ready to assign'];
const PRIO_COLOR    = { High: 'var(--danger)', Medium: 'var(--info)', Low: 'var(--text-subtle)' };
const AREA_OPTIONS  = ['Claims (FLI)', 'Invoicing (Cirrus)', 'Finance / Payments', 'CRM', 'Supportis', 'Quoting (Dual Drive)', 'Platform / Infra', 'Other'];
const STATUS_OPTIONS = ['Not started', 'In progress', 'Specced', 'Assigned', 'Done'];
const softBg = (c) => `color-mix(in srgb, ${c} 12%, var(--surface))`;

const triageSelectStyle = {
  height: 28, padding: '0 8px',
  border: '1px solid var(--border)', borderRadius: 6,
  background: 'var(--surface)', color: 'var(--text)',
  fontSize: 12, cursor: 'pointer', fontFamily: 'var(--sans)',
};

// ── TriageKpi ─────────────────────────────────────────────────────────────────

function TriageKpi({ label, value, color, active, onClick }) {
  return (
    <button onClick={onClick}
      style={{
        flex: 1, minWidth: 120, textAlign: 'left', cursor: 'pointer',
        border: `1px solid ${active ? color : 'var(--border)'}`,
        background: active ? softBg(color) : 'var(--surface)',
        borderRadius: 12, padding: '12px 14px', transition: 'all .12s',
      }}>
      <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: 'var(--mono)' }}>{value}</div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 2 }}>{label}</div>
    </button>
  );
}

// ── TriageEditField ───────────────────────────────────────────────────────────
// A labelled inline field used inside the expanded triage row.

function TriageEditField({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 120 }}>
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-subtle)' }}>{label}</span>
      {children}
    </div>
  );
}

// ── TriageRow ─────────────────────────────────────────────────────────────────

export function TriageRow({ it, onUpdate }) {
  const [expanded, setExpanded]   = React.useState(false);
  const [saving,   setSaving]     = React.useState(false);
  const [saveErr,  setSaveErr]    = React.useState('');

  // Local editable copies of triage fields
  const [bucket,  setBucket]  = React.useState(it.bucket);
  const [priority, setPriority] = React.useState(it.priority);
  const [area,    setArea]    = React.useState(it.area);
  const [owner,   setOwner]   = React.useState(it.suggestedOwner || 'TBD');
  const [status,  setStatus]  = React.useState(it.status || 'Not started');
  const [action,  setAction]  = React.useState(it.action || '');

  // Sync if parent refreshes data
  React.useEffect(() => {
    setBucket(it.bucket);
    setPriority(it.priority);
    setArea(it.area);
    setOwner(it.suggestedOwner || 'TBD');
    setStatus(it.status || 'Not started');
    setAction(it.action || '');
  }, [it.id]);

  const { data: NexusMDData } = useNexusData();
  const TEAM = (NexusMDData?.TEAM || []);

  const patch = async (changes) => {
    setSaving(true); setSaveErr('');
    try {
      const r = await fetch(`/api/triage/items/${it.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      onUpdate?.(it.id, changes);
      toast?.('Triage updated', 'success');
    } catch(e) {
      setSaveErr(e.message || 'Save failed');
      toast?.(e.message || 'Triage save failed', 'error', { duration: 5000 });
    } finally { setSaving(false); }
  };

  const handleBucket   = v => { setBucket(v);   patch({ bucket: v }); };
  const handlePriority = v => { setPriority(v); patch({ priority: v }); };
  const handleArea     = v => { setArea(v);     patch({ area: v }); };
  const handleOwner    = v => { setOwner(v);    patch({ suggestedOwner: v }); };
  const handleStatus   = v => { setStatus(v);   patch({ status: v }); };

  // Next action: save on blur to avoid a request per keystroke
  const handleActionBlur = () => {
    if (action !== it.action) patch({ nextAction: action });
  };

  const meta      = BUCKET_META[bucket] || { color: 'var(--text-muted)' };
  const bucketColor = meta.color;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* ── Card header (always visible, click to expand) ── */}
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'flex-start',
          cursor: 'pointer', userSelect: 'none',
          background: expanded ? 'var(--surface-2)' : 'var(--surface)',
          transition: 'background .1s',
        }}
      >
        <span title={priority} style={{
          width: 8, height: 8, borderRadius: '50%',
          background: PRIO_COLOR[priority] || 'var(--text-subtle)',
          flexShrink: 0, marginTop: 6,
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <a href={it.url} target="_blank" rel="noopener"
              onClick={e => e.stopPropagation()}
              style={{ fontSize: 11.5, fontFamily: 'var(--mono)', color: 'var(--accent)', textDecoration: 'none', flexShrink: 0 }}>
              #{it.id}
            </a>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{it.title}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, padding: '1px 7px', borderRadius: 20, background: softBg(bucketColor), color: bucketColor, border: `1px solid ${bucketColor}` }}>{bucket}</span>
            <span style={{ fontSize: 10.5, fontWeight: 600, padding: '1px 7px', borderRadius: 20, background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>{area}</span>
            <span style={{ fontSize: 10.5, color: 'var(--text-subtle)' }}>{it.type}</span>
            {owner && owner !== 'TBD' && (
              <span style={{ fontSize: 10.5, color: 'var(--accent)', fontWeight: 600 }}>→ {owner}</span>
            )}
            {status && status !== 'Not started' && (
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 20, background: 'var(--surface-2)', color: 'var(--text-subtle)', border: '1px solid var(--border)' }}>{status}</span>
            )}
            {(it.tags || '').split(';').map(t => t.trim()).filter(Boolean).map(t => (
              <span key={t} style={{ fontSize: 10, color: 'var(--text-subtle)', fontFamily: 'var(--mono)' }}>#{t}</span>
            ))}
          </div>
          {action && !expanded && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>
              {action.length > 100 ? action.slice(0, 100) + '…' : action}
            </div>
          )}
        </div>
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={13} style={{ flexShrink: 0, marginTop: 4, color: 'var(--text-subtle)' }} />
      </div>

      {/* ── Expanded panel ── */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)' }}>

          {/* Triage edit fields */}
          <div style={{ padding: '12px 14px', background: 'var(--surface-2)', display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
            <TriageEditField label="Bucket">
              <select value={bucket} onChange={e => handleBucket(e.target.value)} style={triageSelectStyle} disabled={saving}>
                {BUCKET_ORDER.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </TriageEditField>

            <TriageEditField label="Priority">
              <select value={priority} onChange={e => handlePriority(e.target.value)} style={triageSelectStyle} disabled={saving}>
                {['High', 'Medium', 'Low'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </TriageEditField>

            <TriageEditField label="Area">
              <select value={area} onChange={e => handleArea(e.target.value)} style={triageSelectStyle} disabled={saving}>
                {AREA_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </TriageEditField>

            <TriageEditField label="Suggested owner">
              <select value={owner} onChange={e => handleOwner(e.target.value)} style={triageSelectStyle} disabled={saving}>
                <option value="TBD">TBD</option>
                {TEAM.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
            </TriageEditField>

            <TriageEditField label="Status">
              <select value={status} onChange={e => handleStatus(e.target.value)} style={triageSelectStyle} disabled={saving}>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </TriageEditField>

            <TriageEditField label="Next action">
              <textarea
                value={action}
                onChange={e => setAction(e.target.value)}
                onBlur={handleActionBlur}
                rows={2}
                disabled={saving}
                placeholder="What needs to happen…"
                style={{
                  ...triageSelectStyle, height: 'auto', padding: '4px 8px',
                  resize: 'vertical', minWidth: 240, fontFamily: 'var(--sans)', lineHeight: 1.5,
                }}
              />
            </TriageEditField>

            {saving && (
              <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', alignSelf: 'flex-end', marginBottom: 4 }}>Saving…</div>
            )}
            {saveErr && (
              <div style={{ fontSize: 11.5, color: 'var(--danger)', alignSelf: 'flex-end', marginBottom: 4 }}>{saveErr}</div>
            )}
          </div>

          {/* Work item rich content: description, AC, repro steps, discussion */}
          <WorkItemDetail id={it.id} project={it.project} />
        </div>
      )}
    </div>
  );
}

// ── TriageView ────────────────────────────────────────────────────────────────

export function TriageView() {
  const [data, setData]       = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError]     = React.useState(null);
  const [unreachable, setUnreachable] = React.useState(false);
  const [bucketFilter, setBucketFilter]   = React.useState('all');
  const [areaFilter, setAreaFilter]       = usePersisted('nexusmd.triage.area', 'all');
  const [groupBy, setGroupBy]             = usePersisted('nexusmd.triage.groupBy', 'bucket');
  const [search, setSearch]               = React.useState('');
  const [excludeTags, setExcludeTags]     = usePersisted('nexusmd.triage.excludeTags', '');
  const [collapsed, setCollapsed]       = React.useState({});

  const load = React.useCallback(async () => {
    setLoading(true); setError(null); setUnreachable(false);
    try {
      const tags = excludeTags.split(',').map(t => t.trim()).filter(Boolean);
      const qs   = tags.map(t => `excludeTags=${encodeURIComponent(t)}`).join('&');
      const r    = await fetch(`/api/triage/items${qs ? '?' + qs : ''}`);
      if (!r.ok) throw new Error(`Failed to load (${r.status})`);
      setData(await r.json());
    } catch (e) {
      // A TypeError from fetch() itself (as opposed to the Error thrown above
      // for a non-ok HTTP response) means the request never reached a server —
      // there's no Triage backend to talk to, not an Azure DevOps auth/API
      // problem, so it needs a different message (desktop has no local host
      // for /api/triage/*; see the file-level comment).
      setUnreachable(e instanceof TypeError);
      setError(e.message || 'Failed to load');
    }
    finally { setLoading(false); }
  }, [excludeTags]);

  React.useEffect(() => {
    load();
    return TriageEvents.sub(load);
  }, [load]);

  const updateItem = React.useCallback((id, changes) => {
    setData(d => d ? {
      ...d,
      items: d.items.map(it => it.id === id ? { ...it, ...changes } : it),
    } : d);
  }, []);

  const items  = (data && data.items) || [];
  const counts = (data && data.counts) || { total: 0, ready: 0, fleshOut: 0, decision: 0 };
  const areas  = React.useMemo(() => Array.from(new Set(items.map(i => i.area))).sort(), [items]);

  const filtered = React.useMemo(() => {
    let out = items;
    if (bucketFilter !== 'all') out = out.filter(i => i.bucket === bucketFilter);
    if (areaFilter !== 'all')   out = out.filter(i => i.area === areaFilter);
    if (search) {
      const q = search.toLowerCase();
      out = out.filter(i => (i.title || '').toLowerCase().includes(q) || String(i.id).includes(q) || (i.tags || '').toLowerCase().includes(q));
    }
    return out;
  }, [items, bucketFilter, areaFilter, search]);

  const groups = React.useMemo(() => {
    const map = new Map();
    filtered.forEach(i => {
      const key = groupBy === 'bucket' ? i.bucket : groupBy === 'area' ? i.area : i.priority;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(i);
    });
    let keys = Array.from(map.keys());
    if (groupBy === 'bucket') keys.sort((a, b) => BUCKET_ORDER.indexOf(a) - BUCKET_ORDER.indexOf(b));
    else if (groupBy === 'priority') { const po = ['High', 'Medium', 'Low']; keys.sort((a, b) => po.indexOf(a) - po.indexOf(b)); }
    else keys.sort();
    return keys.map(k => ({ key: k, items: map.get(k) }));
  }, [filtered, groupBy]);

  const selectStyle = { height: 30, padding: '0 8px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', fontSize: 12.5, cursor: 'pointer', fontFamily: 'var(--sans)' };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Triage</h1>
          <div className="sub">{counts.total} open · unassigned work item{counts.total !== 1 ? 's' : ''}</div>
        </div>
        <div className="page-head-actions">
          <TriageStatusLine style={{ marginRight: 4 }} />
          <TriageExportButton label="Export to spreadsheet"
            availableStates={Array.from(new Set(items.map(i => i.state).filter(Boolean))).sort()} />
          <button className="btn sm ghost" onClick={load} disabled={loading}><Icon name="refresh" size={13}/> {loading ? 'Loading…' : 'Refresh'}</button>
        </div>
      </div>

      {/* KPI tiles */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <TriageKpi label="Total open" value={counts.total} color="var(--accent)" active={bucketFilter === 'all'} onClick={() => setBucketFilter('all')} />
        <TriageKpi label="Ready to assign" value={counts.ready} color="var(--success)" active={bucketFilter === 'Ready to assign'} onClick={() => setBucketFilter(b => b === 'Ready to assign' ? 'all' : 'Ready to assign')} />
        <TriageKpi label="Needs flesh out" value={counts.fleshOut} color="var(--warning, #c98a1b)" active={bucketFilter === 'Flesh out'} onClick={() => setBucketFilter(b => b === 'Flesh out' ? 'all' : 'Flesh out')} />
        <TriageKpi label="Needs decision" value={counts.decision} color="var(--danger)" active={bucketFilter === 'Decision'} onClick={() => setBucketFilter(b => b === 'Decision' ? 'all' : 'Decision')} />
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title, #id or tag…"
          style={{ height: 30, flex: 1, minWidth: 180, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', fontSize: 12.5, fontFamily: 'var(--sans)', outline: 'none' }} />
        <input value={excludeTags} onChange={e => setExcludeTags(e.target.value)} placeholder="Exclude tags (comma-separated)…"
          title="Items matching any of these tags will be hidden"
          style={{ height: 30, flex: 1, minWidth: 180, padding: '0 10px', border: `1px solid ${excludeTags.trim() ? 'var(--warning, #c98a1b)' : 'var(--border)'}`, borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', fontSize: 12.5, fontFamily: 'var(--sans)', outline: 'none' }} />
        <select value={areaFilter} onChange={e => setAreaFilter(e.target.value)} style={selectStyle}>
          <option value="all">All areas</option>
          {areas.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <label style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>Group by</label>
        <select value={groupBy} onChange={e => setGroupBy(e.target.value)} style={selectStyle}>
          <option value="bucket">Bucket</option>
          <option value="area">Area</option>
          <option value="priority">Priority</option>
        </select>
      </div>

      {/* Body */}
      {loading && !data && <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>Loading triage items…</div>}
      {error && (
        <div className="card" style={{ padding: 16, color: 'var(--danger)', fontSize: 13 }}>
          {unreachable
            ? 'Triage isn’t available here — it requires the NexusMD web app’s backend, which the desktop app can’t reach.'
            : <>{error}. Check the Azure DevOps connection in Settings, then Refresh.</>}
        </div>
      )}
      {!loading && !error && filtered.length === 0 && (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
          {items.length === 0 ? 'No open, unassigned work items — your triage queue is clear. 🎉' : 'No items match the current filters.'}
        </div>
      )}

      {!error && groups.map(group => {
        const isCollapsed = !!collapsed[group.key];
        const meta = groupBy === 'bucket' ? (BUCKET_META[group.key] || {}) : {};
        const dot = groupBy === 'bucket' ? meta.color : groupBy === 'priority' ? PRIO_COLOR[group.key] : 'var(--text-muted)';
        return (
          <div key={group.key} style={{ marginBottom: 14 }}>
            <div onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', cursor: 'pointer', userSelect: 'none' }}>
              <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={13} />
              {dot && <span style={{ width: 9, height: 9, borderRadius: '50%', background: dot }} />}
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{group.key}</span>
              <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-subtle)', background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '1px 7px', borderRadius: 4 }}>{group.items.length}</span>
            </div>
            {!isCollapsed && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                {group.items.map(it => (
                  <TriageRow key={it.id} it={it} onUpdate={updateItem} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
