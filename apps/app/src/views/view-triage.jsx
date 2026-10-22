import React from 'react';
import { toast } from '../toast.jsx';
import { HelmData } from '../data.jsx';
import { TriageEvents, TriageExportButton, TriageStatusLine } from '../triage.jsx';
import { Icon } from '../icons.jsx';
import {
  TriageRow as SharedTriageRow, TriageKpi, BUCKET_META, BUCKET_ORDER, PRIO_COLOR,
} from '@nexusmd/ui';
// view-triage.jsx — interactive "Unassigned To-Do Triage" tab.
// Live view of open + unassigned work items from HelmData.WORK_ITEMS, with the same
// area / bucket / priority model as the Unassigned_ToDo_Triage_Tracker spreadsheet.
// Rows are expandable: click to reveal triage edit fields + full work item content.

function isTerminalState(state) {
  return ['Done', 'Closed', 'Resolved', 'Removed', 'Cancelled'].includes(state);
}

const triageSelectStyle = {
  height: 44, padding: '0 8px',
  border: '1px solid var(--border)', borderRadius: 6,
  background: 'var(--surface)', color: 'var(--text)',
  fontSize: 12, cursor: 'pointer', fontFamily: 'var(--sans)',
};

// The app has no triage backend: edits are saved as annotations in local storage and
// merged into the work items by TriageView. Touch-height selects come from triageSelectStyle.
function saveTriage(id, changes) {
  let annotations = [];
  try { annotations = JSON.parse(localStorage.getItem('helm.android.triage') || '[]'); } catch (_) {}
  const idx = annotations.findIndex(a => a.id === id);
  const merged = { ...(idx >= 0 ? annotations[idx] : { id }), ...changes };
  if (idx >= 0) annotations[idx] = merged;
  else annotations.push(merged);
  localStorage.setItem('helm.android.triage', JSON.stringify(annotations));
}

function TriageRow(props) {
  return <SharedTriageRow {...props} saveTriage={saveTriage} selectStyle={triageSelectStyle}/>;
}

// ── TriageView ────────────────────────────────────────────────────────────────

function TriageView() {
  const [data, setData]       = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError]     = React.useState(null);
  const [bucketFilter, setBucketFilter]   = React.useState('all');
  const [areaFilter, setAreaFilter]       = usePersisted('helm.triage.area', 'all');
  const [groupBy, setGroupBy]             = usePersisted('helm.triage.groupBy', 'bucket');
  const [search, setSearch]               = React.useState('');
  const [excludeTags, setExcludeTags]     = usePersisted('helm.triage.excludeTags', '');
  const [collapsed, setCollapsed]       = usePersisted('helm.triage.collapsed', {});

  React.useEffect(() => { setCollapsed({}); }, [groupBy]);

  const load = React.useCallback(() => {
    setLoading(true); setError(null);
    try {
      // Source: open + unassigned items from the already-loaded ADO data
      const excludeTagList = excludeTags.split(',').map(t => t.trim()).filter(Boolean);
      const rawItems = (HelmData.WORK_ITEMS || []).filter(w =>
        !w.assignee && !isTerminalState(w.state) &&
        (excludeTagList.length === 0 || !excludeTagList.some(et =>
          (w.tags || []).some(t => t.toLowerCase().includes(et.toLowerCase()))
        ))
      );

      // Load saved triage annotations
      let annotations = [];
      try { annotations = JSON.parse(localStorage.getItem('helm.android.triage') || '[]'); } catch (_) {}
      const annotMap = new Map(annotations.map(a => [a.id, a]));

      // Merge: work item data + saved triage annotation
      const items = rawItems.map(w => {
        const ann = annotMap.get(w.id) || {};
        return {
          id: w.id,
          title: w.title,
          type: w.type,
          state: w.state,
          area: ann.area || 'Other',
          bucket: ann.bucket || 'Flesh out',
          priority: ann.priority || 'Medium',
          suggestedOwner: ann.suggestedOwner || 'TBD',
          status: ann.status || 'Not started',
          action: ann.action || '',
          tags: (w.tags || []).join('; '),
          url: `https://dev.azure.com/${HelmData.ORG}/_workitems/edit/${w.id}`,
          project: w.project || '',
        };
      });

      const counts = {
        total:    items.length,
        ready:    items.filter(i => i.bucket === 'Ready to assign').length,
        fleshOut: items.filter(i => i.bucket === 'Flesh out').length,
        decision: items.filter(i => i.bucket === 'Decision').length,
      };

      setData({ items, counts });
    } catch (e) { setError(e.message || 'Failed to load'); }
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

  const selectStyle = { height: 44, padding: '0 8px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', fontSize: 12.5, cursor: 'pointer', fontFamily: 'var(--sans)' };

  return (
    <React.Fragment>
      <div className="m-appbar">
        <div className="m-ab-lead">
          <h1>Triage</h1>
          <div className="m-ab-sub">{counts.total} open · unassigned work item{counts.total !== 1 ? 's' : ''}</div>
        </div>
        <div className="m-ab-actions">
          <TriageStatusLine style={{ marginRight: 4 }} />
          <TriageExportButton label="Export to spreadsheet"
            availableStates={Array.from(new Set(items.map(i => i.state).filter(Boolean))).sort()} />
          <button type="button" className="btn sm ghost" onClick={load} disabled={loading}><Icon name="refresh" size={13}/> {loading ? 'Loading…' : 'Refresh'}</button>
        </div>
      </div>

      <div className="m-screen">
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
          style={{ height: 44, flex: 1, minWidth: 180, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', fontSize: 12.5, fontFamily: 'var(--sans)', outline: 'none' }} />
        <input value={excludeTags} onChange={e => setExcludeTags(e.target.value)} placeholder="Exclude tags (comma-separated)…"
          title="Items matching any of these tags will be hidden"
          style={{ height: 44, flex: 1, minWidth: 180, padding: '0 10px', border: `1px solid ${excludeTags.trim() ? 'var(--warning, #c98a1b)' : 'var(--border)'}`, borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', fontSize: 12.5, fontFamily: 'var(--sans)', outline: 'none' }} />
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
          {error}. Check the Azure DevOps connection in Settings, then Refresh.
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
    </React.Fragment>
  );
}

export { TriageView };


