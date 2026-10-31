import React from 'react';
import { Icon } from '../icons.jsx';
import { useSourceFilter, SourceSwitch } from '../source-switch.jsx';
import { workItemSource } from '../work-item-source.js';
import { HelmData } from '../data.jsx';
import { Sheet } from '../components.jsx';
import { getProfileKey } from '../profile-keys.js';
import { isTerminalState } from '@nexusmd/core';
import { usePersisted, GROUP_ORDER_MODES, orderGroups, moveGroup } from '@nexusmd/ui';
// view-workitems.jsx — Mobile work items list
const { useState, useMemo, useEffect } = React;

// ── Pure helpers (module-level, never recreated) ──────────────────────────────
const STATE_TONE = s => {
  if (/done|closed|resolved|completed/i.test(s)) return 'success';
  if (/blocked/i.test(s))  return 'danger';
  if (/review/i.test(s))   return 'violet';
  if (/active|progress/i.test(s)) return 'info';
  return '';
};
const TYPE_ICON = t => {
  switch ((t || '').toLowerCase()) {
    case 'bug':     return 'alert';
    case 'story':   return 'list';
    case 'feature': return 'star';
    case 'spike':   return 'fire';
    default:        return 'check';
  }
};
const LANES = ['To Do', 'Active', 'Blocked', 'In Review', 'Done'];

// GitHub issues are only open or closed.
const GH_LANES = ['Open', 'Closed'];
const projectOf = (w) => (w.source === 'github' ? (w.projectName || w.project) : w.project);

function laneFilter(lane, w) {
  if (lane === 'Open')      return !isTerminalState(w.state);
  if (lane === 'Closed')    return isTerminalState(w.state);
  if (lane === 'Done')      return isTerminalState(w.state);
  if (lane === 'Blocked')   return /blocked/i.test(w.state);
  if (lane === 'In Review') return /review/i.test(w.state) && !/blocked/i.test(w.state);
  if (lane === 'Active')    return /active|in.?progress/i.test(w.state) && !/review/i.test(w.state) && !/blocked/i.test(w.state);
  // 'To Do' = explicit match OR catch-all for unrecognised states
  if (lane === 'To Do')     return /new|to.?do|backlog/i.test(w.state) ||
    (!isTerminalState(w.state) &&
     !/blocked|review|active|in.?progress/i.test(w.state));
  return false;
}

// Jira ids are stored as 'jira:TFP-123'; show the key.
const shortId = (id) => String(id).replace(/^jira:/, '');

// The states an item can move to: the provider's own workflow for it when it can say (Jira, GitHub),
// else its type's workflow from the ADO metadata, else every state in use. Never the current one.
export function stateChoices(wi, remote, typeStates, allStates) {
  const key = Object.keys(typeStates || {}).find(k => k.toLowerCase() === String(wi.type || '').toLowerCase());
  const pool = Array.isArray(remote) && remote.length ? remote : key ? typeStates[key] : allStates;
  return [...new Set(pool || [])].filter(st => st && st !== wi.state);
}

// ── WorkRow — module-level to avoid remounts on parent re-render ──────────────
function WorkRow({ wi, newItemIds, onOpen, onState, team }) {
  const assigneeName = wi.assignee && wi.assignee !== 'unassigned'
    ? ((team.find(t => t.id === wi.assignee)?.name || wi.assignee).split(' ')[0])
    : null;
  return (
    <div className={`m-row${newItemIds?.has(wi.id) ? ' row-flash' : ''}`}
      onClick={() => onOpen(wi)}>
      <span className={`m-typ ${(wi.type || 'task').toLowerCase()}`}>
        <Icon name={TYPE_ICON(wi.type)} size={15}/>
      </span>
      <div className="m-row-main">
        <div className="m-row-title">{wi.title}</div>
        <div className="m-row-meta">
          <span className="m-id">#{wi.displayId || shortId(wi.id)}</span>
          {wi.state && (
            <button type="button" className={`pill m-pillbtn ${STATE_TONE(wi.state)}`} aria-label={`State ${wi.state}. Change state`}
              onClick={e => { e.stopPropagation(); onState?.(wi); }}>{wi.state} <Icon name="chevron-down" size={10}/></button>
          )}
          {wi.priority >= 1 && wi.priority <= 2 && (
            <span className={`prio p${wi.priority}`}>P{wi.priority}</span>
          )}
          {assigneeName && <span className="m-id">{assigneeName}</span>}
        </div>
      </div>
      <Icon name="chevron-right" size={16} className="chev"/>
    </div>
  );
}

// ── ChipToggle — module-level to avoid remounts ───────────────────────────────
function ChipToggle({ label, active, onToggle }) {
  return (
    <button type="button" onClick={onToggle} style={{
      padding: '6px 12px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
      border: `1px solid ${active ? 'var(--accent-border)' : 'var(--border)'}`,
      background: active ? 'var(--accent-soft)' : 'var(--surface)',
      color: active ? 'var(--accent)' : 'var(--text-muted)',
    }}>
      {label}
    </button>
  );
}

// ── GroupHeader — module-level to avoid remounts ─────────────────────────────
function GroupHeader({ label, count, collapsed, onToggle }) {
  return (
    <div className="wi-group-hd" onClick={onToggle}>
      <span className="wi-group-label">{label}</span>
      <span className="wi-group-count">{count}</span>
      <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={14}/>
    </div>
  );
}

function loadWIViewState() {
  try {
    const s = localStorage.getItem(getProfileKey('helm.workitems.viewState'));
    return s ? JSON.parse(s) : {};
  } catch { return {}; }
}

// ── Main component ────────────────────────────────────────────────────────────
function WorkItemsView({ items, setItems, onOpen, onCreate, onFlash, team = [], newItemIds, device }) {
  const [search, setSearch]           = useState('');
  const [viewMode, setViewMode]       = useState('list');
  const [filterOpen, setFilterOpen]   = useState(false);
  const [typeFilter, setTypeFilter]   = useState(() => new Set(loadWIViewState().typeFilter || []));
  const [stateFilter, setStateFilter] = useState(() => new Set(loadWIViewState().stateFilter || []));
  const [assigneeFilter, setAssigneeFilter] = useState(() => new Set(loadWIViewState().assigneeFilter || []));
  const [groupBy, setGroupBy]         = useState(() => loadWIViewState().groupBy ?? null);
  const [sortBy, setSortBy]           = useState(() => loadWIViewState().sortBy ?? null);
  const [collapsedGroups, setCollapsedGroups] = usePersisted('helm.workitems.collapsed', new Set());
  useEffect(() => { setCollapsedGroups(new Set()); }, [groupBy]);
  // One saved order per grouping: { mode, keys }, shared with desktop's Work Items.
  const [groupOrders, setGroupOrders] = usePersisted('nexusmd.wi.groupOrder', {});
  useEffect(() => {
    try {
      localStorage.setItem(
        getProfileKey('helm.workitems.viewState'),
        JSON.stringify({
          groupBy,
          sortBy,
          typeFilter:     [...typeFilter],
          stateFilter:    [...stateFilter],
          assigneeFilter: [...assigneeFilter],
        })
      );
    } catch {}
  }, [groupBy, sortBy, typeFilter, stateFilter, assigneeFilter]);

  const toggle = (setter) => (val) => setter(prev => {
    const n = new Set(prev);
    n.has(val) ? n.delete(val) : n.add(val);
    return n;
  });

  const filterCount = typeFilter.size + stateFilter.size + assigneeFilter.size;
  const clearFilters = () => {
    setTypeFilter(new Set());
    setStateFilter(new Set());
    setAssigneeFilter(new Set());
  };

  // Change an item's state from its row: a sheet of the states it can move to, applied at once, with Undo.
  const [stateItem, setStateItem] = useState(null);
  const [stateOptions, setStateOptions] = useState(null);
  const src = useSourceFilter('work', items);
  const list = src.filtered;
  const openStateSheet = (wi) => {
    setStateItem(wi); setStateOptions(null);
    Promise.resolve(workItemSource?.availableTargetStates?.(wi.id)).catch(() => null)
      .then(remote => setStateOptions(stateChoices(wi, remote, HelmData?.WI_TYPE_STATES, allStates)));
  };
  const setStateLocal = (id, state) => setItems?.(prev => prev.map(w => (w.id === id ? { ...w, state } : w)));
  const changeState = async (wi, state) => {
    const before = wi.state;
    const label = wi.displayId || shortId(wi.id);
    setStateItem(null);
    setStateLocal(wi.id, state);
    try {
      await workItemSource.saveField(wi.id, 'System.State', state);
      onFlash?.(`${label} moved to ${state}`, 'check', async () => {
        setStateLocal(wi.id, before);
        try { await workItemSource.saveField(wi.id, 'System.State', before); }
        catch (e) { setStateLocal(wi.id, state); onFlash?.(`Could not undo: ${e?.message || 'failed'}`, 'alert'); }
      });
    } catch (e) {
      setStateLocal(wi.id, before);
      onFlash?.(`Could not change state: ${e?.message || 'failed'}`, 'alert');
    }
  };

  // Open / Closed when GitHub is the only provider; the usual five lanes otherwise.
  const lanes = useMemo(() => (list.length > 0 && list.every(w => w.source === 'github') ? GH_LANES : LANES), [list]);

  const allTypes     = useMemo(() => [...new Set(list.map(w => w.type).filter(Boolean))],  [list]);
  const allStates    = useMemo(() => [...new Set(list.map(w => w.state).filter(Boolean))], [list]);
  const allAssignees = useMemo(() => [...new Set(list.map(w => w.assignee || 'unassigned'))], [list]);

  const memberName = id => {
    if (!id || id === 'unassigned') return 'Unassigned';
    return (team.find(t => t.id === id)?.name || id).split(' ')[0];
  };

  const filtered = useMemo(() => list.filter(w => {
    if (typeFilter.size     && !typeFilter.has(w.type))                       return false;
    if (stateFilter.size    && !stateFilter.has(w.state))                     return false;
    if (assigneeFilter.size && !assigneeFilter.has(w.assignee || 'unassigned')) return false;
    const q = search.trim().toLowerCase();
    if (q && !w.title.toLowerCase().includes(q) && !String(w.id).includes(q)) return false;
    return true;
  }), [list, typeFilter, stateFilter, assigneeFilter, search]);

  const sortedFiltered = useMemo(() => {
    if (!sortBy) return filtered;
    return [...filtered].sort((a, b) => {
      if (sortBy === 'id')     return a.id - b.id;
      if (sortBy === 'status') return (a.state || '').localeCompare(b.state || '');
      if (sortBy === 'type')   return (a.type  || '').localeCompare(b.type  || '');
      return 0;
    });
  }, [filtered, sortBy]);

  const groupedList = useMemo(() => {
    if (!groupBy) return null;
    const buckets = {};
    sortedFiltered.forEach(w => {
      const key =
        groupBy === 'user'    ? (w.assignee || 'unassigned') :
        groupBy === 'project' ? (projectOf(w) || 'Unknown')   :
        /* status */ (lanes.find(lane => laneFilter(lane, w)) || w.state || 'Unknown');
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(w);
    });

    if (groupBy === 'status') {
      const known = lanes.filter(s => buckets[s]);
      const rest  = Object.keys(buckets).filter(k => !lanes.includes(k)).sort();
      return orderGroups([...known, ...rest].map(k => ({ key: k, label: k, items: buckets[k] })), groupOrders?.[groupBy]);
    }
    if (groupBy === 'user') {
      const keys = Object.keys(buckets).filter(k => k !== 'unassigned').sort(
        (a, b) => memberName(a).localeCompare(memberName(b))
      );
      if (buckets['unassigned']) keys.push('unassigned');
      return orderGroups(keys.map(k => ({ key: k, label: memberName(k), items: buckets[k] })), groupOrders?.[groupBy]);
    }
    // project
    return orderGroups(Object.keys(buckets).sort().map(k => ({ key: k, label: k, items: buckets[k] })), groupOrders?.[groupBy]);
  }, [sortedFiltered, groupBy, team, groupOrders, lanes]);

  const boardLanes = useMemo(() => {
    if (!groupBy || groupBy === 'status') {
      return lanes.map(lane => ({
        key: lane,
        label: lane,
        items: sortedFiltered.filter(w => laneFilter(lane, w)),
      }));
    }
    if (groupBy === 'user') {
      const ids = [...new Set(sortedFiltered.map(w => w.assignee || 'unassigned'))];
      ids.sort((a, b) => {
        if (a === 'unassigned') return 1;
        if (b === 'unassigned') return -1;
        return memberName(a).localeCompare(memberName(b));
      });
      return ids.map(id => ({
        key: id,
        label: memberName(id),
        items: sortedFiltered.filter(w => (w.assignee || 'unassigned') === id),
      }));
    }
    // project
    const projects = [...new Set(sortedFiltered.map(w => projectOf(w) || 'Unknown'))].sort();
    return projects.map(proj => ({
      key: proj,
      label: proj,
      items: sortedFiltered.filter(w => (projectOf(w) || 'Unknown') === proj),
    }));
  }, [sortedFiltered, groupBy, team, lanes]);

  const userBoardData = useMemo(() => {
    if (viewMode !== 'board' || groupBy !== 'user') return null;
    const ids = [...new Set(sortedFiltered.map(w => w.assignee || 'unassigned'))];
    ids.sort((a, b) => {
      if (a === 'unassigned') return 1;
      if (b === 'unassigned') return -1;
      return memberName(a).localeCompare(memberName(b));
    });
    return ids.map(userId => ({
      userId,
      label: memberName(userId),
      lanes: lanes.map(lane => ({
        key: lane,
        label: lane,
        items: sortedFiltered.filter(w =>
          (w.assignee || 'unassigned') === userId && laneFilter(lane, w)
        ),
      })),
    }));
  }, [sortedFiltered, viewMode, groupBy, team, lanes]);

  return (
    <>
      <div className="m-appbar">
        <div className="m-ab-lead"><h1>Work</h1></div>
        <div className="m-ab-actions">
          <button type="button" className="m-iconbtn"
            title={viewMode === 'list' ? 'Board view' : 'List view'}
            onClick={() => setViewMode(v => v === 'list' ? 'board' : 'list')}>
            <Icon name={viewMode === 'list' ? 'board' : 'list'} size={18}/>
          </button>
        </div>
      </div>

      <div className="m-screen" style={{ paddingBottom: 80 }}>
        <SourceSwitch {...src}/>
        {/* Search + filter bar */}
        <div className="m-filterbar" style={{ marginBottom: 12 }}>
          <div className="m-search" style={{ flex: 1 }}>
            <span className="si"><Icon name="search" size={16}/></span>
            <input type="search" enterKeyHint="search"
              value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"/>
          </div>
          <button type="button" className={`m-filterbtn${filterCount > 0 ? ' has' : ''}`}
            onClick={() => setFilterOpen(true)}>
            <Icon name="filter" size={16}/>
            Filter
            {filterCount > 0 && <span className="fc">{filterCount}</span>}
          </button>
        </div>

        {/* One-tap state chips with counts; the sheet keeps the rarer filters */}
        {allStates.length > 1 && (
          <div className="m-chipscroll" style={{ marginBottom: 8 }}>
            <button type="button" className={`m-chip${stateFilter.size === 0 ? ' active' : ''}`}
              onClick={() => setStateFilter(new Set())}>
              All <span className="m-chip-count">{list.length}</span>
            </button>
            {allStates.map(s => (
              <button key={s} type="button" className={`m-chip${stateFilter.has(s) ? ' active' : ''}`}
                onClick={() => toggle(setStateFilter)(s)}>
                {s} <span className="m-chip-count">{list.filter(w => w.state === s).length}</span>
              </button>
            ))}
          </div>
        )}

        {viewMode === 'list' ? (
          sortedFiltered.length === 0
            ? (
              <div className="m-empty">
                <div className="ei"><Icon name="work" size={22}/></div>
                <div className="et">{search || filterCount > 0 ? 'No items match' : 'No items'}</div>
                {(search || filterCount > 0) && (
                  <>
                    <div className="es">Try a different search or filter.</div>
                    <button type="button" className="btn m-btn-lg" style={{ marginTop: 12 }}
                      onClick={() => { setSearch(''); clearFilters(); }}>
                      Clear filters
                    </button>
                  </>
                )}
              </div>
            )
            : groupedList
              ? groupedList.map(({ key, label, items }) => {
                  const collapsed = collapsedGroups.has(key);
                  return (
                    <div key={key} style={{ marginBottom: 8 }}>
                      <GroupHeader
                        label={label}
                        count={items.length}
                        collapsed={collapsed}
                        onToggle={() => toggle(setCollapsedGroups)(key)}
                      />
                      {!collapsed && (
                        <div className="m-card flush">
                          {items.map(wi => (
                            <WorkRow key={wi.id} wi={wi} newItemIds={newItemIds}
                              onOpen={onOpen} onState={openStateSheet} team={team}/>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              : (
                <div className="m-card flush">
                  {sortedFiltered.map(wi => (
                    <WorkRow key={wi.id} wi={wi} newItemIds={newItemIds}
                      onOpen={onOpen} onState={openStateSheet} team={team}/>
                  ))}
                </div>
              )
        ) : userBoardData ? (
          <div role="region" aria-label="Board view">
            {userBoardData.map(({ userId, label, lanes }) => (
              <div key={userId} style={{ marginBottom: 20 }}>
                <div style={{
                  fontWeight: 700, fontSize: 13, color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                  padding: '0 2px', marginBottom: 8,
                }}>
                  {label}
                </div>
                <div style={{
                  display: 'flex', gap: 12, overflowX: 'auto',
                  scrollSnapType: 'x mandatory', paddingBottom: 8,
                }}>
                  {lanes.map(({ key, label: laneLabel, items }) => (
                    <div key={key} style={{
                      minWidth: 220, flexShrink: 0, scrollSnapAlign: 'start',
                      background: 'var(--surface-2)', borderRadius: 'var(--radius-lg)', padding: 10,
                    }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{laneLabel}</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>
                          {items.length}
                        </span>
                      </div>
                      {items.map(wi => (
                        <div key={wi.id} onClick={() => onOpen(wi)} style={{
                          background: 'var(--surface)', borderRadius: 'var(--radius)',
                          padding: '8px 10px', marginBottom: 8, cursor: 'pointer',
                        }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                            <span className={`m-typ ${(wi.type || 'task').toLowerCase()}`}
                              style={{ fontSize: 12, width: 18, height: 18 }}>
                              <Icon name={TYPE_ICON(wi.type)} size={13}/>
                            </span>
                            <span className="m-id">#{wi.displayId || shortId(wi.id)}</span>
                          </div>
                          <div style={{ fontSize: 13, lineHeight: 1.4 }}>{wi.title}</div>
                        </div>
                      ))}
                      {items.length === 0 && (
                        <div style={{ fontSize: 12, color: 'var(--text-subtle)', textAlign: 'center', padding: '12px 0' }}>
                          Empty
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div role="region" aria-label="Board view"
            style={{ display: 'flex', gap: 12, overflowX: 'auto', scrollSnapType: 'x mandatory', paddingBottom: 12 }}>
            {boardLanes.map(({ key, label, items }) => (
              <div key={key} style={{
                minWidth: 256, flexShrink: 0, scrollSnapAlign: 'start',
                background: 'var(--surface-2)', borderRadius: 'var(--radius-lg)', padding: 10,
              }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-subtle)' }}>{items.length}</span>
                </div>
                {items.map(wi => (
                  <div key={wi.id} onClick={() => onOpen(wi)} style={{
                    background: 'var(--surface)', borderRadius: 'var(--radius)', padding: '8px 10px',
                    marginBottom: 8, cursor: 'pointer',
                  }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                      <span className={`m-typ ${(wi.type || 'task').toLowerCase()}`}
                        style={{ fontSize: 12, width: 18, height: 18 }}>
                        <Icon name={TYPE_ICON(wi.type)} size={13}/>
                      </span>
                      <span className="m-id">#{wi.displayId || shortId(wi.id)}</span>
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.4 }}>{wi.title}</div>
                  </div>
                ))}
                {items.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-subtle)', textAlign: 'center', padding: '12px 0' }}>
                    Empty
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet open={!!stateItem} icon="check-circle" title="Change state" sub={stateItem ? `${stateItem.displayId || shortId(stateItem.id)} · now ${stateItem.state}` : ''}
        onClose={() => setStateItem(null)}>
        {!stateOptions && <div className="muted" style={{ padding: 8 }}>Loading states…</div>}
        {stateOptions && stateOptions.length === 0 && <div className="m-empty"><div className="et">No other states</div><div className="es">This item can't move anywhere from here.</div></div>}
        {stateOptions && stateOptions.length > 0 && (
          <div className="m-card flush">
            {stateOptions.map(st => (
              <div key={st} className="m-row" onClick={() => changeState(stateItem, st)}>
                <div className="m-row-main"><span className={`pill ${STATE_TONE(st)}`}>{st}</span></div>
                <Icon name="chevron-right" size={16} className="chev"/>
              </div>
            ))}
          </div>
        )}
      </Sheet>

      {/* FAB */}
      <button type="button" className="m-fab" onClick={onCreate} aria-label="New work item">
        <Icon name="plus" size={24}/>
      </button>

      {/* Filter sheet */}
      <Sheet open={filterOpen} icon="filter" title="Filter"
        onClose={() => setFilterOpen(false)}
        footer={
          <>
            {filterCount > 0 && (
              <button type="button" className="btn ghost m-btn-lg"
                onClick={() => { clearFilters(); setFilterOpen(false); }}>
                Clear all
              </button>
            )}
            <button type="button" className="btn primary m-btn-lg"
              onClick={() => setFilterOpen(false)}>
              Show {sortedFiltered.length}
            </button>
          </>
        }>
        <div className="m-fld">
          <label>Group by</label>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {['user','project','status'].map(g => (
              <ChipToggle key={g}
                label={g.charAt(0).toUpperCase() + g.slice(1)}
                active={groupBy === g}
                onToggle={() => setGroupBy(groupBy === g ? null : g)}/>
            ))}
          </div>
        </div>
        {groupBy && groupedList && (
          <div className="m-fld">
            <label>Order groups</label>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {GROUP_ORDER_MODES.map(m => (
                <ChipToggle key={m.id} label={m.label}
                  active={(groupOrders?.[groupBy]?.mode || 'default') === m.id}
                  onToggle={() => {
                    const cur = groupOrders?.[groupBy];
                    const shownKeys = groupedList.map(g => g.key);
                    const next = m.id === 'custom'
                      ? { mode: 'custom', keys: [...shownKeys, ...(cur?.keys || []).filter(k => !shownKeys.includes(k))] }
                      : { ...cur, mode: m.id };
                    setGroupOrders({ ...groupOrders, [groupBy]: next });
                  }}/>
              ))}
            </div>
            {(groupOrders?.[groupBy]?.mode === 'custom') && (
              <div style={{ display:'flex', flexDirection:'column', gap:4, marginTop:6 }}>
                {groupedList.map((g, i) => {
                  const move = (to) => {
                    const next = moveGroup(groupedList.map(x => x.key), groupOrders[groupBy].keys, i, to);
                    if (next) setGroupOrders({ ...groupOrders, [groupBy]: next });
                  };
                  return (
                    <div key={g.key} style={{ display:'flex', alignItems:'center', gap:8, fontSize:13 }}>
                      <span style={{ flex:1, minWidth:0 }} className="truncate">{g.label}</span>
                      <button type="button" className="btn sm ghost" disabled={i === 0} onClick={() => move(i - 1)}><Icon name="chevron-up" size={12}/></button>
                      <button type="button" className="btn sm ghost" disabled={i === groupedList.length - 1} onClick={() => move(i + 1)}><Icon name="chevron-down" size={12}/></button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <div className="m-fld">
          <label>Sort by</label>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {[['id','Number'],['status','Status'],['type','Type']].map(([val, label]) => (
              <ChipToggle key={val}
                label={label}
                active={sortBy === val}
                onToggle={() => setSortBy(sortBy === val ? null : val)}/>
            ))}
          </div>
        </div>
        {allTypes.length > 0 && (
          <div className="m-fld">
            <label>Type</label>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {allTypes.map(t => (
                <ChipToggle key={t} label={t} active={typeFilter.has(t)}
                  onToggle={() => toggle(setTypeFilter)(t)}/>
              ))}
            </div>
          </div>
        )}
        {allStates.length > 0 && (
          <div className="m-fld">
            <label>State</label>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {allStates.map(s => (
                <ChipToggle key={s} label={s} active={stateFilter.has(s)}
                  onToggle={() => toggle(setStateFilter)(s)}/>
              ))}
            </div>
          </div>
        )}
        {allAssignees.length > 1 && (
          <div className="m-fld">
            <label>Assignee</label>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {allAssignees.map(id => (
                <ChipToggle key={id} label={memberName(id)} active={assigneeFilter.has(id)}
                  onToggle={() => toggle(setAssigneeFilter)(id)}/>
              ))}
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}

export { WorkItemsView };
