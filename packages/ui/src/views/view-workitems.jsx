import React from 'react';
import { createPortal } from 'react-dom';
// view-workitems.jsx — Work Items: table + board, filters, drag-to-move. Shared web + desktop.
// Bulk data arrives via props; PROJECTS/TEAM/STATES/ORG come from useNexusData().

import { Prio, SortHeader, StateDot } from '../components.jsx';
import { Avatar, MenuButton, NotificationBanner, ProjectChip, TypeIcon, usePersisted } from '../app-components.jsx';
import { Icon } from '../icons.jsx';
import { TriageExportButton, TriageStatusLine } from './triage.jsx';
import { WorkItemDetail } from './work-item-detail.jsx';
import { adoTypeToHelm, adoStateToHelm, slugify, timeAgo, syncBoardColumns, getActiveLanes, resolveFields, WI_CARD_FIELDS, WI_TABLE_COLUMNS, indexPRsByWorkItem, CATEGORY_LANES, CATEGORY_LABELS, itemCategory, displayIdOf, isJiraId, jiraColumnForStatus } from '@nexusmd/core';
import { useNexusData } from '../data-context.jsx';
import { toast } from '../toast.jsx';
import { GROUP_ORDER_MODES, orderGroups, moveGroup } from './wi-group-order.js';

// Collapsed group keys, remembered per profile and kept separately per grouping.
// One persisted object keyed by grouping (usePersisted only reads storage on mount).
function useCollapsedGroups(storageKey, grouping) {
  const [all, setAll] = usePersisted(storageKey, {});
  const collapsed = (all && all[grouping]) || {};
  const setCollapsed = (next) => setAll(prev => {
    const cur = (prev && prev[grouping]) || {};
    const val = typeof next === 'function' ? next(cur) : next;
    return { ...(prev || {}), [grouping]: val };
  });
  return [collapsed, setCollapsed];
}

// Persist work-item field changes. Desktop hosts inject workItemSource (writes
// straight to ADO or Jira, routed by id); legacy web hosts hit /api/workitems/:id.
// `ops` is a list of [ '/fields/<Field>', value ] pairs. Failures are toasted and
// reported as `false` so callers can roll back their optimistic edit.
export async function patchWorkItem(workItemSource, id, ops) {
  if (workItemSource?.saveField) {
    try {
      for (const [path, value] of ops) {
        await workItemSource.saveField(id, path.replace('/fields/', ''), value ?? '');
      }
      return true;
    } catch (e) {
      toast?.('✗ ' + (e?.message || 'Save failed'), 'error');
      return false;
    }
  }
  try {
    await fetch(`/api/workitems/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ops.map(([path, value]) => ({ op: 'add', path, value }))),
    });
    return true;
  } catch {
    return false;
  }
}

import { WI_TYPE_STATES_CACHE_KEY } from './wi-cache-key.js';
export { WI_TYPE_STATES_CACHE_KEY };

// Local aliases matching legacy global names used in this file
const adoTypeToNexusMD  = adoTypeToHelm;
const adoStateToNexusMD = adoStateToHelm;

function navigateToPRs(workItemId) {
  window.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: { view: 'prs', filter: { workItemId } } }));
}

const { useState: useStateW, useMemo: useMemoW } = React;

// Shared timer for hover-prefetch — only one row is hovered at a time.
let _wiHoverTimer;

function FilterDropdown({ label, children, activeCount = 0, width = 280, align = 'left', title }) {
    const [open, setOpen] = React.useState(false);
    const ref = React.useRef(null);

    React.useEffect(() => {
        const onClick = (e) => {
            if (!ref.current?.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, []);

    const isActive = activeCount > 0;

    return (
        <div ref={ref} style={{ position: 'relative' }}>
            <button
                onClick={() => setOpen(v => !v)}
                title={title}
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    height: 30,
                    padding: '0 10px',
                    borderRadius: 8,
                    border: isActive
                        ? '1px solid var(--accent-border)'
                        : '1px solid var(--border)',
                    background: isActive ? 'var(--accent-soft)' : 'var(--surface)',
                    color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                    fontWeight: isActive ? 600 : 500,
                    fontSize: 12.5,
                    cursor: 'pointer',
                    transition: 'all .15s ease',
                    whiteSpace: 'nowrap',
                    fontFamily: 'var(--sans)',
                }}
            >
                {label}
                {isActive && (
                    <span style={{
                        background: 'var(--accent)',
                        color: 'var(--accent-fg)',
                        borderRadius: 999,
                        fontSize: 9,
                        fontWeight: 700,
                        minWidth: 16,
                        height: 16,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '0 4px',
                        fontFamily: 'var(--mono)',
                    }}>{activeCount}</span>
                )}
                <Icon name={open ? 'chevron-up' : 'chevron-down'} size={11} />
            </button>

            {open && (
                <div
                    style={{
                        position: 'absolute',
                        top: 36,
                        [align]: 0,
                        width,
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 12,
                        boxShadow: 'var(--shadow-pop)',
                        padding: 12,
                        zIndex: 100,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                    }}
                >
                    {children}
                </div>
            )}
        </div>
    );
}

function FilterSection({ title, children }) {
    return (
        <div>
            <div
                style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: 'var(--text-subtle)',
                    marginBottom: 8,
                    letterSpacing: 0.5,
                }}
            >
                {title}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {children}
            </div>
        </div>
    );
}

function FilterOption({ active, negated, onClick, icon, label, count, danger = false }) {
  const isDanger = danger || negated;
  const borderColor = (active || negated)
    ? isDanger ? 'var(--danger)' : 'var(--accent-border)'
    : 'var(--border)';
  const bgColor = active
    ? isDanger ? 'var(--danger-soft)' : 'var(--accent-soft)'
    : negated ? 'var(--danger-soft)' : 'var(--surface-2)';
  const textColor = active
    ? isDanger ? 'var(--danger)' : 'var(--accent)'
    : negated ? 'var(--danger)' : 'var(--text-muted)';

  return (
    <button
      onClick={onClick}
      style={{
        height: 28, padding: '0 9px', borderRadius: 6,
        border: `1px solid ${borderColor}`,
        background: bgColor, color: textColor,
        display: 'inline-flex', alignItems: 'center', gap: 5,
        cursor: 'pointer', fontSize: 12,
        fontWeight: (active || negated) ? 600 : 500,
        transition: 'all .12s ease', fontFamily: 'var(--sans)',
      }}
    >
      {icon}
      <span>{label}</span>
      {count != null && <span style={{ opacity: 0.6, fontSize: 10.5, fontFamily: 'var(--mono)' }}>{count}</span>}
      {(active || negated) && <Icon name={negated && !active ? 'x' : 'check'} size={10} />}
    </button>
  );
}

// The table's row sort. Its default group order follows it (groups appear as first met).
function sortItems(items, sort) {
  return [...items].sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    const va = a[sort.col], vb = b[sort.col];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });
}

// Group key + label for one item, matching how WITable/WIBoard key their groups.
function groupKeyLabel(w, grouping, team, projects) {
  switch (grouping) {
    case 'assignee': return [w.assignee || 'unassigned', team.find(t => t.id === w.assignee)?.name || (w.assignee || 'Unassigned')];
    case 'state':    return [w.state, w.state];
    case 'project':  return [w.project, projects.find(p => p.id === w.project)?.name || w.project];
    case 'priority': return [`p${w.priority}`, `Priority ${w.priority}`];
    case 'type':     return [w.type || 'unknown', w.type || 'Unknown'];
    default:         return [null, null];
  }
}

// The groups shown for `grouping`, in default order, as { key, label, count }.
function groupList(items, grouping, team, projects, extraKeys = []) {
  const map = new Map();
  items.forEach(w => {
    const [key, label] = groupKeyLabel(w, grouping, team, projects);
    if (!map.has(key)) map.set(key, { key, label, count: 0 });
    map.get(key).count++;
  });
  extraKeys.forEach(([key, label]) => { if (!map.has(key)) map.set(key, { key, label, count: 0 }); });
  const arr = Array.from(map.values());
  if (grouping === 'priority') arr.sort((a, b) => a.key.localeCompare(b.key));
  return arr;
}

// "Order" popover next to Group by: pick a sort, or drag / nudge groups into a custom order.
function GroupOrderMenu({ grouping, groups, order, setOrder }) {
  const [dragIdx, setDragIdx] = useStateW(null);
  const shown = orderGroups(groups, order);
  const shownKeys = shown.map(g => g.key);
  const move = (from, to) => { const next = moveGroup(shownKeys, order?.keys, from, to); if (next) setOrder(next); };
  const mode = order?.mode || 'default';
  const arrowBtn = { border: 'none', background: 'none', padding: 2, cursor: 'pointer', color: 'var(--text-subtle)', display: 'inline-flex' };

  return (
    <FilterDropdown label={<><Icon name="sort" size={12}/> Order</>} activeCount={mode === 'default' ? 0 : 1} width={260} align="right" title="Order the groups">
      <FilterSection title="Sort groups">
        {GROUP_ORDER_MODES.map(m => (
          <FilterOption key={m.id} active={mode === m.id} label={m.label}
            onClick={() => setOrder(m.id === 'custom' ? { mode: 'custom', keys: [...shownKeys, ...(order?.keys || []).filter(k => !shownKeys.includes(k))] } : { ...order, mode: m.id })}/>
        ))}
      </FilterSection>
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-subtle)', marginBottom: 6, letterSpacing: 0.5 }}>
          Drag to reorder
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 280, overflowY: 'auto' }}>
          {shown.map((g, i) => (
            <div key={g.key}
              draggable
              onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', g.key); setDragIdx(i); }}
              onDragOver={e => { if (dragIdx != null) e.preventDefault(); }}
              onDrop={e => { e.preventDefault(); if (dragIdx != null) move(dragIdx, i); setDragIdx(null); }}
              onDragEnd={() => setDragIdx(null)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6, fontSize: 12.5, cursor: 'grab',
                background: dragIdx === i ? 'var(--surface-2)' : 'transparent', opacity: dragIdx === i ? 0.6 : 1 }}>
              <Icon name="grip" size={12} style={{ color: 'var(--text-subtle)', flexShrink: 0 }}/>
              {grouping === 'assignee' && g.key !== 'unassigned' && <Avatar who={g.key} size="xs"/>}
              <span className="truncate" style={{ flex: 1, minWidth: 0 }}>{g.label}</span>
              <span className="muted mono" style={{ fontSize: 10.5 }}>{g.count}</span>
              <button type="button" title="Move to top" style={arrowBtn} disabled={i === 0} onClick={() => move(i, 0)}><Icon name="arrow-up" size={11}/></button>
              <button type="button" title="Move up" style={arrowBtn} disabled={i === 0} onClick={() => move(i, i - 1)}><Icon name="chevron-up" size={11}/></button>
              <button type="button" title="Move down" style={arrowBtn} disabled={i === shown.length - 1} onClick={() => move(i, i + 1)}><Icon name="chevron-down" size={11}/></button>
            </div>
          ))}
        </div>
      </div>
    </FilterDropdown>
  );
}

function ActiveFilterChip({ label, onRemove, negated = false, icon }) {
    const bg     = negated ? 'var(--danger-soft)'   : 'var(--accent-soft)';
    const border = negated ? 'var(--danger)'         : 'var(--accent-border)';
    const color  = negated ? 'var(--danger)'         : 'var(--accent)';
    return (
        <div
            style={{
                height: 26,
                padding: '0 8px 0 10px',
                borderRadius: 999,
                background: bg,
                border: `1px solid ${border}`,
                color,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11.5,
                fontWeight: 600,
                whiteSpace: 'nowrap',
            }}
        >
            {icon && <span style={{ display:'inline-flex', alignItems:'center' }}>{icon}</span>}
            <span>{label}</span>
            <button
                onClick={onRemove}
                style={{
                    border: 'none',
                    background: 'rgba(0,0,0,0.08)',
                    color: 'inherit',
                    cursor: 'pointer',
                    padding: 0,
                    width: 16,
                    height: 16,
                    borderRadius: 999,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'background .12s',
                }}
            >
                <Icon name="x" size={9} />
            </button>
        </div>
    );
}

const SOURCE_LABELS = { ado: 'ADO', jira: 'Jira', github: 'GitHub' };
// GitHub issues are only open or closed; label-driven columns are out of scope.
const GITHUB_LANES = ['Open', 'Closed'];

const adoItemUrl = (org, w) =>
  `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(String(w.project || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))}/_workitems/edit/${w.id}`;

// Id link for a work item: "#123" for ADO, "ABC-12" for Jira, with a source badge
// when more than one provider is connected.
export function WorkItemIdLink({ w, fontSize = 12 }) {
  const { data: NexusMDData, workItemSource } = useNexusData();
  const multi = (NexusMDData.WORK_ITEM_PROVIDERS || []).length > 1;
  const url = workItemSource?.webUrl?.(w) || adoItemUrl(NexusMDData.ORG, w);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {multi && (
        <span data-source={w.source || 'ado'} style={{ fontSize: 9.5, padding: '0 5px', borderRadius: 3, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          {SOURCE_LABELS[w.source || 'ado']}
        </span>
      )}
      <a href={url} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}
        style={{ color: 'var(--accent)', textDecoration: 'none', fontFamily: 'var(--mono)', fontSize }}>{displayIdOf(w)}</a>
    </span>
  );
}

function ProviderStatusPills({ providers = [], showErrors = true }) {
  const pills = [];
  providers.forEach(p => {
    if (showErrors && (p.status === 'error' || p.status === 'stale')) {
      pills.push(
        <span key={`${p.id}:err`} role="status" title={p.error || ''}
          style={{ fontSize: 11.5, padding: '2px 8px', borderRadius: 999, border: '1px solid var(--danger)', color: 'var(--danger)', whiteSpace: 'nowrap' }}>
          {p.label}: {p.error || 'load failed'}{p.status === 'stale' ? ' (showing cached)' : ''}
        </span>
      );
    }
    if (p.warning) {
      pills.push(
        <span key={`${p.id}:warn`} role="status" title={p.warningDetail || p.warning}
          style={{ fontSize: 11.5, padding: '2px 8px', borderRadius: 999, border: '1px solid var(--warning, var(--border))', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {p.label}: {p.warning}
        </span>
      );
    }
  });
  return pills;
}

// ─── Shared select style for Group by controls ────────────────────────────────
const groupBySelectStyle = {
    height: 30,
    padding: '0 26px 0 10px',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface)',
    fontSize: 12.5,
    color: 'var(--text)',
    cursor: 'pointer',
    appearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238a857d' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 8px center',
    outline: 'none',
    fontFamily: 'var(--sans)',
};

export function WorkItemsView({ items, setItems, onOpen, onCreate, team: teamProp, newItemIds = new Set(), serverSearch }) {
  const { data: NexusMDData } = useNexusData();
  const [initialNewCount] = useStateW(() => newItemIds.size);
  const [bannerDismissed, setBannerDismissed] = useStateW(false);
  const [extraItems,   setExtraItems]   = useStateW([]);
  const [totalMatched, setTotalMatched] = useStateW(null);
  const [loadingMore,  setLoadingMore]  = useStateW(false);
  const [loadMoreErr,  setLoadMoreErr]  = useStateW('');
  const [view,            setView]           = usePersisted('nexusmd.wi.view',          'table');
  const [search,          setSearch]         = useStateW('');
  const [activeProject,   setActiveProject]  = usePersisted('nexusmd.wi.project',       'all');
  const [activeAssignees, setActiveAssignees]= usePersisted('nexusmd.wi.assignees',     new Set());
  const [activeStates,    setActiveStates]   = usePersisted('nexusmd.wi.states',        new Set());
  const [activeTypes,     setActiveTypes]    = usePersisted('nexusmd.wi.types',         new Set());
  const [activePrios,     setActivePrios]    = usePersisted('nexusmd.wi.prios',         new Set());
  const [negatedStates,    setNegatedStates]    = usePersisted('nexusmd.wi.states.neg',    new Set());
  const [negatedTypes,     setNegatedTypes]     = usePersisted('nexusmd.wi.types.neg',     new Set());
  const [negatedAssignees, setNegatedAssignees] = usePersisted('nexusmd.wi.assignees.neg', new Set());
  const [negatedPrios,     setNegatedPrios]     = usePersisted('nexusmd.wi.prios.neg',     new Set());
  const [grouping,        setGrouping]       = usePersisted('nexusmd.wi.grouping',      'assignee');
  const [boardGrouping,   setBoardGrouping]  = usePersisted('nexusmd.wi.boardGrouping', 'none');
  const [sort,            setSort]           = usePersisted('nexusmd.wi.sort',          { col: 'id', dir: 'desc' });
  const [selection,       setSelection]      = useStateW(new Set());
  const [collapsed,       setCollapsed]      = useCollapsedGroups('nexusmd.wi.collapsed.table', grouping);
  // Group order per grouping ({ mode, keys }), shared by table and board. Kept in profile
  // storage, so it is remembered and goes into the exported settings file.
  const [groupOrders,     setGroupOrders]    = usePersisted('nexusmd.wi.groupOrder',    {});
  const [includedTags,       setIncludedTags]       = usePersisted('nexusmd.wi.tags.inc',           new Set());
  const [excludedTags,       setExcludedTags]       = usePersisted('nexusmd.wi.tags.exc',           new Set());
  const [noTagsOnly,         setNoTagsOnly]         = usePersisted('nexusmd.wi.noTagsOnly',         false);
  const [showEmptyAssignees, setShowEmptyAssignees] = usePersisted('nexusmd.wi.showEmptyAssignees', false);
  const [boardColumnConfig,  setBoardColumnConfig]  = usePersisted('nexusmd.wi.boardColumns',       {});
  const [displayMode, setDisplayMode] = usePersisted('nexusmd.wi.displayMode', 'merged');
  const [sourceTab,   setSourceTab]   = usePersisted('nexusmd.wi.sourceTab',   'ado');

  const { PROJECTS, STATES } = NexusMDData;
  const TEAM = teamProp || NexusMDData.TEAM || [];

  const prIndex = useMemoW(() => indexPRsByWorkItem(NexusMDData.PRS || []), [NexusMDData.PRS]);

  const providers = NexusMDData.WORK_ITEM_PROVIDERS || [];
  const multiProvider = providers.length > 1;
  // Jira-only profiles need the pills too, or a failed load is invisible. ADO-only
  // profiles see only warnings (e.g. PRs unavailable), never error/stale pills.
  const hasJiraProvider = providers.some(p => p.id === 'jira');
  const showProviderPills = hasJiraProvider || providers.some(p => p.warning);
  const separate = multiProvider && displayMode === 'separate';
  const activeSource = separate ? (providers.some(p => p.id === sourceTab) ? sourceTab : providers[0].id) : null;
  const boardColumns = Array.isArray(NexusMDData.JIRA_BOARD_COLUMNS) && NexusMDData.JIRA_BOARD_COLUMNS.length
    ? NexusMDData.JIRA_BOARD_COLUMNS : null;
  const jiraOnly = providers.length === 1 && providers[0].id === 'jira';
  const jiraTab = activeSource === 'jira' || jiraOnly;
  const laneMode = jiraTab && boardColumns ? 'jira-columns' : (multiProvider && !separate ? 'category' : 'state');
  const sourceItems = useMemoW(
    () => (activeSource ? items.filter(i => (i.source || 'ado') === activeSource) : items),
    [items, activeSource],
  );
  const jiraLanes = useMemoW(() => {
    const fromMeta = [...new Set(Object.values(NexusMDData.WI_TYPE_STATES_BY_SOURCE?.jira || {}).flat())];
    return fromMeta.length ? fromMeta : [...new Set(sourceItems.map(w => w.state).filter(Boolean))];
  }, [NexusMDData.WI_TYPE_STATES_BY_SOURCE, sourceItems]);

  // Merged view: prop items (initial load + background refresh) + any extra pages loaded,
  // each annotated with its real linked-PR count. In separate mode, only the active source.
  const allItems = useMemoW(() => {
    const seen = new Set(sourceItems.map(i => i.id));
    const merged = [...sourceItems, ...extraItems.filter(i => !seen.has(i.id))];
    return merged.map(i => ({ ...i, prs: prIndex.get(i.id)?.length ?? 0 }));
  }, [sourceItems, extraItems, prIndex]);

  const KNOWN_TYPES = ['bug', 'feature', 'task', 'story', 'spike', 'epic'];
  const typeFilterOptions = useMemoW(() => {
    const extra = new Set();
    allItems.forEach(w => { if (w.type && !KNOWN_TYPES.includes(w.type)) extra.add(w.type); });
    return [...KNOWN_TYPES, ...Array.from(extra).sort()];
  }, [allItems]);

  const priorityFilterOptions = useMemoW(() => {
    const base = new Set(NexusMDData.PRIORITIES?.length ? NexusMDData.PRIORITIES : [1, 2, 3, 4]);
    allItems.forEach(w => { if (Number.isFinite(w.priority)) base.add(w.priority); });
    return Array.from(base).sort((a, b) => a - b);
  }, [allItems, NexusMDData.PRIORITIES]);

  // Map a flat WorkItemSearchResultDto (camelCase) to the internal shape
  const mapDto = useMemoW(() => {
    const nameToId = {};
    TEAM.forEach(t => { if (t.name) nameToId[t.name] = t.id; });
    return (wi) => {
      const assigneeId  = wi.assignedTo ? (nameToId[wi.assignedTo] || null) : null;
      const tags        = (wi.tags || '').split(';').map(t => t.trim()).filter(Boolean);
      const changed     = wi.changedDate || '';
      const areaPath    = wi.areaPath || '';
      const firstSeg    = areaPath.split('\\')[0] || areaPath.split('/')[0] || 'default';
      const projSlug    = slugify(firstSeg);
      const iterPath    = wi.iterationPath || '';
      return {
        id:            wi.id,
        type:          adoTypeToNexusMD(wi.type),
        title:         wi.title || '',
        project:       projSlug,
        state:         wi.state || '',
        assignee:      assigneeId,
        priority:      Number.isFinite(wi.priority) ? wi.priority : 3,
        points:        0,
        tags,
        updated:       timeAgo(changed),
        changedMs:     changed ? new Date(changed).getTime() : null,
        sprint:        iterPath.toLowerCase().includes('sprint') || iterPath.toLowerCase().includes('iteration'),
        iterationPath: iterPath,
        areaPath, area: wi.area || '',
        comments: wi.commentCount || 0, prs: 0, isNew: false,
      };
    };
  }, [TEAM]);

  // Refs so the async load loop always sees current values without needing
  // them as useCallback dependencies (which would restart in-flight loops).
  const filterPredicateRef = React.useRef(() => true);
  const itemsRef           = React.useRef(items);
  const extraItemsRef      = React.useRef(extraItems);
  const mapDtoRef          = React.useRef(mapDto);
  const loadingRef         = React.useRef(false);
  const serverSearchRef    = React.useRef(serverSearch);
  React.useEffect(() => { itemsRef.current      = items;    }, [items]);
  React.useEffect(() => { extraItemsRef.current = extraItems; }, [extraItems]);
  React.useEffect(() => { mapDtoRef.current     = mapDto;   }, [mapDto]);
  React.useEffect(() => { serverSearchRef.current = serverSearch; }, [serverSearch]);

  // Server-side pagination is opt-in: hosts with a work-item search backend pass
  // a serverSearch fetcher. Without it (e.g. the desktop, whose cached ADO
  // snapshot is the full set), the load-more UI and auto-fill loop stay off so
  // there's no doomed fetch to a nonexistent endpoint.
  const paginated = typeof serverSearch === 'function';

  // Core load loop. untilAll=true ignores the filtered-count threshold.
  const doLoad = React.useCallback(async (untilAll = false) => {
    if (loadingRef.current) return;
    const search = serverSearchRef.current;
    if (typeof search !== 'function') return;
    loadingRef.current = true;
    setLoadingMore(true); setLoadMoreErr('');
    try {
      const PAGE   = 300;
      const projectIds = (NexusMDData.PROJECTS || []).map(p => p.id);
      const pred   = filterPredicateRef.current;

      const seenIds = new Set([...itemsRef.current, ...extraItemsRef.current].map(i => i.id));
      let skip           = seenIds.size;
      let filteredGained = 0;
      let accumulated    = [];

      while (untilAll || filteredGained < PAGE) {
        const data = await search({ top: PAGE, skip, projectIds });
        setTotalMatched(data.totalMatched ?? null);

        const mapped    = (data.workItems || []).map(mapDtoRef.current);
        const newUnique = mapped.filter(i => !seenIds.has(i.id));
        newUnique.forEach(i => seenIds.add(i.id));
        accumulated = [...accumulated, ...newUnique];
        filteredGained += newUnique.filter(pred).length;
        skip += PAGE;

        if (!data.hasMore || mapped.length === 0) break;
        // If the page returned items but none were new (sort instability across calls),
        // treat as exhausted to avoid an infinite loop at the same skip offset.
        if (newUnique.length === 0) break;
      }

      if (accumulated.length > 0) {
        setExtraItems(prev => {
          const seen = new Set([...itemsRef.current, ...prev].map(i => i.id));
          return [...prev, ...accumulated.filter(i => !seen.has(i.id))];
        });
      } else {
        // No new unique items found — clamp totalMatched to what we have so
        // the auto-fill guard doesn't re-trigger indefinitely.
        setTotalMatched(seenIds.size);
      }
    } catch (e) {
      setLoadMoreErr(e.message || 'Failed to load');
    } finally { loadingRef.current = false; setLoadingMore(false); }
  }, []); // stable — reads everything through refs

  const [wiTypeStates, setWiTypeStates] = useStateW({});

  // Seed instantly from the last load's cache so board columns/state filters
  // aren't empty on first paint, then overwrite with the current load's real
  // per-project data as soon as it's in NexusMDData (populated by loadAdoData —
  // there is no /api/workitems/states backend; this used to fetch that route,
  // which 404s everywhere, silently forcing the hardcoded STATES fallback below).
  React.useEffect(() => {
    const cached = localStorage.getItem(WI_TYPE_STATES_CACHE_KEY);
    if (cached) { try { setWiTypeStates(JSON.parse(cached)); } catch (_) {} }
  }, []);

  React.useEffect(() => {
    const live = NexusMDData.WI_TYPE_STATES;
    if (!live || Object.keys(live).length === 0) return;
    setWiTypeStates(live);
    try { localStorage.setItem(WI_TYPE_STATES_CACHE_KEY, JSON.stringify(live)); } catch (_) {}
  }, [NexusMDData.WI_TYPE_STATES]);

  React.useEffect(() => {
    if (Object.keys(wiTypeStates).length === 0) return;
    // Union all states from all work item types. With several providers connected,
    // board columns are ADO-only: Jira and GitHub states and projects must not leak in.
    const detectedStates = multiProvider
      ? [...new Set(Object.values(NexusMDData.WI_TYPE_STATES_BY_SOURCE?.ado || {}).flat())]
      : [...new Set(Object.values(wiTypeStates).flat())];
    if (detectedStates.length === 0) return;
    const boardProjects = multiProvider ? PROJECTS.filter(p => p.source !== 'jira' && p.source !== 'github') : PROJECTS;

    setBoardColumnConfig(prev => {
      const useGlobal = boardProjects.length <= 1;
      if (useGlobal) {
        return syncBoardColumns(prev, '__global__', detectedStates);
      }
      let next = prev;
      boardProjects.forEach(p => {
        // Per-project: states from items in that project + global detected states
        const projectItemStates = [...new Set(allItems.filter(w => w.project === p.id).map(w => w.state).filter(Boolean))];
        const combined = [...new Set([...projectItemStates, ...detectedStates])];
        next = syncBoardColumns(next, p.id, combined);
      });
      return next;
    });
  }, [wiTypeStates, PROJECTS, allItems, multiProvider, NexusMDData.WI_TYPE_STATES_BY_SOURCE]);

  const availableStates = useMemoW(() => {
    const itemStates = new Set(allItems.map(w => w.state).filter(Boolean));

    const allEntries = Object.entries(wiTypeStates);
    if (allEntries.length === 0) {
      const base = new Set(NexusMDData.STATES || []);
      itemStates.forEach(s => base.add(s));
      return Array.from(base).sort();
    }
    if (activeTypes.size === 0) {
      const union = new Set(itemStates);
      allEntries.forEach(([, states]) => states.forEach(s => union.add(s)));
      return Array.from(union).sort();
    }
    const union = new Set();
    allEntries
      .filter(([type]) => activeTypes.has(type.toLowerCase()))
      .forEach(([, states]) => states.forEach(s => union.add(s)));
    allItems
      .filter(w => activeTypes.has((w.type || '').toLowerCase()))
      .forEach(w => w.state && union.add(w.state));
    if (union.size === 0) {
      allEntries.forEach(([, states]) => states.forEach(s => union.add(s)));
      itemStates.forEach(s => union.add(s));
    }
    return Array.from(union).sort();
  }, [wiTypeStates, activeTypes, allItems]);

  // Preserve scroll position across silent background data refreshes
  const _wiScrollSaved = React.useRef(null);
  React.useEffect(() => {
    const save = () => { _wiScrollSaved.current = window.scrollY; };
    window.addEventListener('scroll', save, { passive: true });
    return () => window.removeEventListener('scroll', save);
  }, []);
  React.useLayoutEffect(() => {
    if (_wiScrollSaved.current !== null) window.scrollTo(0, _wiScrollSaved.current);
  }, [items]);

  const toggle = (setter) => (val) => setter(prev => {
    const next = new Set(prev);
    if (next.has(val)) next.delete(val); else next.add(val);
    return next;
  });

  const negate = (setter, includeSetter) => (val) => {
    includeSetter(prev => { const n = new Set(prev); n.delete(val); return n; });
    setter(prev => {
      const n = new Set(prev);
      if (n.has(val)) n.delete(val); else n.add(val);
      return n;
    });
  };

  // Single-item predicate — kept in a ref so loadMore's async loop always
  // tests against the current filters without needing them as dependencies.
  const filterPredicate = useMemoW(() => {
    const q = search.toLowerCase();
    return (w) => {
      if (activeProject !== 'all' && w.project !== activeProject) return false;
      if (activeAssignees.size && !activeAssignees.has(w.assignee || 'unassigned')) return false;
      if (activeStates.size    && !activeStates.has(w.state))   return false;
      if (activeTypes.size     && !activeTypes.has(w.type))     return false;
      if (activePrios.size     && !activePrios.has(w.priority)) return false;
      if (negatedStates.size    && negatedStates.has(w.state))                return false;
      if (negatedTypes.size     && negatedTypes.has(w.type))                  return false;
      if (negatedAssignees.size && negatedAssignees.has(w.assignee || 'unassigned')) return false;
      if (negatedPrios.size     && negatedPrios.has(w.priority))              return false;
      if (noTagsOnly && (w.tags || []).length > 0) return false;
      if (!noTagsOnly) {
        if (includedTags.size && !(w.tags || []).some(t => includedTags.has(t))) return false;
        if (excludedTags.size &&  (w.tags || []).some(t => excludedTags.has(t))) return false;
      }
      if (q && !w.title.toLowerCase().includes(q) && !String(w.id).includes(q) &&
          !(w.tags || []).some(t => t.toLowerCase().includes(q))) return false;
      return true;
    };
  }, [activeProject, activeAssignees, activeStates, activeTypes, activePrios,
      negatedStates, negatedTypes, negatedAssignees, negatedPrios,
      search, includedTags, excludedTags, noTagsOnly]);

  React.useEffect(() => { filterPredicateRef.current = filterPredicate; }, [filterPredicate]);

  const filtered = useMemoW(() => allItems.filter(filterPredicate), [allItems, filterPredicate]);

  const activeGrouping = view === 'board' ? boardGrouping : grouping;
  const setGroupOrder = (next) => setGroupOrders(prev => ({ ...(prev || {}), [activeGrouping]: next }));
  const orderGroupList = useMemoW(() => {
    if (activeGrouping === 'none') return [];
    // The board can show every team member, item or not; list them too so they can be placed.
    const extra = view === 'board' && activeGrouping === 'assignee' && showEmptyAssignees
      ? [['unassigned', 'Unassigned'], ...TEAM.map(t => [t.id, t.name])] : [];
    return groupList(view === 'board' ? filtered : sortItems(filtered, sort), activeGrouping, TEAM, PROJECTS || [], extra);
  }, [filtered, activeGrouping, view, sort, showEmptyAssignees, TEAM, PROJECTS]);
  // Jira board columns always show; "Other" only when a rendered card maps to no column.
  const jiraColumnLanes = useMemoW(() => {
    if (!boardColumns) return [];
    const names = boardColumns.map(c => c.name);
    const hasOther = filtered.some(w => !jiraColumnForStatus(boardColumns, w.state));
    return hasOther ? [...names, '__other__'] : names;
  }, [boardColumns, filtered]);

  // Auto-fill: whenever filtered results drop below the page size and more
  // items exist (or we haven't checked yet), kick off a load automatically.
  React.useEffect(() => {
    if (!paginated) return;
    if (loadingMore) return;
    if (loadMoreErr) return;
    if (filtered.length >= 300) return;
    if (totalMatched !== null && allItems.length >= totalMatched) return;
    doLoad();
  }, [paginated, filtered.length, loadingMore, loadMoreErr, totalMatched, allItems.length, doLoad]);

  // Stats for chips
  const stateCounts = useMemoW(() => {
    const c = {};
    allItems.forEach(w => { c[w.state] = (c[w.state] || 0) + 1; });
    return c;
  }, [allItems]);
  const allTags = useMemoW(() => {
    const s = new Set();
    allItems.forEach(w => (w.tags || []).forEach(t => s.add(t)));
    return Array.from(s).sort();
  }, [allItems]);

  // ─ change handlers
  // A state change without an explicit category keeps stateCategory in step with it.
  const withStateCategory = (w, patch) => (('state' in patch) && !('stateCategory' in patch)
    ? { ...patch, stateCategory: NexusMDData.STATE_CATEGORIES_BY_SOURCE?.[w.source || 'ado']?.[patch.state] ?? null }
    : patch);
  const updateItem = (id, patch) => setItems(arr => arr.map(w => w.id === id ? { ...w, ...withStateCategory(w, patch) } : w));
  const moveState = (id, newState) => updateItem(id, { state: newState });
  const cycleTag = (tag) => {
    setNoTagsOnly(false);
    if (includedTags.has(tag)) {
      const inc = new Set(includedTags); inc.delete(tag); setIncludedTags(inc);
      const exc = new Set(excludedTags); exc.add(tag); setExcludedTags(exc);
      return;
    }
    if (excludedTags.has(tag)) {
      const exc = new Set(excludedTags); exc.delete(tag); setExcludedTags(exc);
      return;
    }
    const inc = new Set(includedTags); inc.add(tag); setIncludedTags(inc);
  };
  const clearAllFilters = () => {
    setSearch(''); setActiveProject('all');
    setActiveAssignees(new Set()); setActiveStates(new Set()); setActiveTypes(new Set()); setActivePrios(new Set());
    setNegatedStates(new Set()); setNegatedTypes(new Set()); setNegatedAssignees(new Set()); setNegatedPrios(new Set());
    setIncludedTags(new Set()); setExcludedTags(new Set()); setNoTagsOnly(false);
  };

  const tagsActiveCount = includedTags.size + excludedTags.size + (noTagsOnly ? 1 : 0);
  const hasActiveFilters = search || activeProject !== 'all' || activeAssignees.size ||
    activeStates.size || activeTypes.size || activePrios.size ||
    negatedStates.size || negatedTypes.size || negatedAssignees.size || negatedPrios.size ||
    includedTags.size || excludedTags.size || noTagsOnly;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Work items</h1>
          <div className="sub">
            {allItems.length}{totalMatched !== null && totalMatched > allItems.length ? ` of ${totalMatched}` : ''} loaded
            · {allItems.filter(w => w.sprint).length} in current sprint
            · {filtered.length} match filters
          </div>
        </div>
        <div className="page-head-actions">
          {multiProvider && (
            <div role="group" aria-label="Display mode" style={{ display: 'flex', background: 'var(--surface-2)', borderRadius: 6, padding: 2 }}>
              {[['merged', 'Merged'], ['separate', 'Separate']].map(([v, l]) => (
                <button key={v} className="btn sm ghost" aria-pressed={displayMode === v} onClick={() => setDisplayMode(v)}
                  style={displayMode === v ? { background: 'var(--surface)', boxShadow: 'var(--shadow-sm)' } : null}>{l}</button>
              ))}
            </div>
          )}
          {showProviderPills && <ProviderStatusPills providers={providers} showErrors={hasJiraProvider} />}
          <div style={{ display: 'flex', background: 'var(--surface-2)', borderRadius: 6, padding: 2 }}>
            <button className="btn sm ghost" onClick={() => setView('table')} style={view === 'table' ? { background: 'var(--surface)', boxShadow: 'var(--shadow-sm)' } : null}><Icon name="list" size={14}/> Table</button>
            <button className="btn sm ghost" onClick={() => setView('board')} style={view === 'board' ? { background: 'var(--surface)', boxShadow: 'var(--shadow-sm)' } : null}><Icon name="board" size={14}/> Board</button>
          </div>
          <TriageStatusLine style={{ marginRight: 4 }} />
          <TriageExportButton />
          <button className="btn sm primary" onClick={onCreate}><Icon name="plus" size={13}/> New work item</button>
        </div>
      </div>

      {separate && (
        <div role="tablist" aria-label="Work item source" style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {providers.map(p => (
            <button key={p.id} role="tab" aria-selected={activeSource === p.id} className="btn sm ghost"
              onClick={() => setSourceTab(p.id)}
              style={activeSource === p.id ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : null}>
              {p.label} <span className="muted mono" style={{ fontSize: 11 }}>{items.filter(i => (i.source || 'ado') === p.id).length}</span>
            </button>
          ))}
        </div>
      )}

      {initialNewCount > 0 && !bannerDismissed && (
        <NotificationBanner
          label={`${initialNewCount} work item${initialNewCount !== 1 ? 's' : ''} updated since your last visit`}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}

      {/* ── Filter bar ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>

        {/* Row 1: search + dropdowns + right controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>

          {/* Search */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <Icon name="search" size={13} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text-subtle)', pointerEvents:'none' }}/>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search items..."
              style={{
                height: 30, padding: search ? '0 28px 0 30px' : '0 10px 0 30px',
                border: search ? '1px solid var(--accent-border)' : '1px solid var(--border)',
                borderRadius: 8, background: search ? 'var(--accent-soft)' : 'var(--surface)',
                fontSize: 12.5, outline: 'none', width: 200, color: 'var(--text)',
                transition: 'border-color .15s, background .15s',
              }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{
                position:'absolute', right:6, top:'50%', transform:'translateY(-50%)',
                border:'none', background:'rgba(0,0,0,0.08)', cursor:'pointer', padding:0,
                width:16, height:16, borderRadius:999, display:'flex', alignItems:'center',
                justifyContent:'center', color:'var(--accent)',
              }}>
                <Icon name="x" size={9}/>
              </button>
            )}
          </div>

          <div style={{ width:1, height:18, background:'var(--border)', flexShrink:0 }}/>

          {/* Project */}
          <FilterDropdown label="Project" activeCount={activeProject !== 'all' ? 1 : 0} width={260}>
            <FilterSection title="Project">
              <FilterOption active={activeProject === 'all'} label="All projects" onClick={() => setActiveProject('all')}/>
              {PROJECTS.map(p => (
                <FilterOption key={p.id} active={activeProject === p.id}
                  label={p.name} count={allItems.filter(w => w.project === p.id).length}
                  icon={<span style={{ width:8, height:8, borderRadius:'50%', background:p.color, flexShrink:0 }}/>}
                  onClick={() => setActiveProject(p.id)}/>
              ))}
            </FilterSection>
          </FilterDropdown>

          {/* Type */}
          <FilterDropdown label="Type" activeCount={activeTypes.size + negatedTypes.size} width={260}>
            <FilterSection title="Type">
              {typeFilterOptions.map(t => (
                <FilterOption key={t} active={activeTypes.has(t)} negated={negatedTypes.has(t)}
                  label={t[0].toUpperCase() + t.slice(1)} icon={<TypeIcon type={t}/>}
                  count={allItems.filter(w => w.type === t).length}
                  onClick={(e) => { if (e.detail >= 2) negate(setNegatedTypes, setActiveTypes)(t); else toggle(setActiveTypes)(t); }}/>
              ))}
            </FilterSection>
          </FilterDropdown>

          {/* State */}
          <FilterDropdown label="State" activeCount={activeStates.size + negatedStates.size} width={240}>
            <FilterSection title="State">
              {availableStates.map(s => (
                <FilterOption key={s} active={activeStates.has(s)} negated={negatedStates.has(s)}
                  label={s} count={stateCounts[s] || 0}
                  onClick={(e) => { if (e.detail >= 2) negate(setNegatedStates, setActiveStates)(s); else toggle(setActiveStates)(s); }}/>
              ))}
            </FilterSection>
          </FilterDropdown>

          {/* Assignee */}
          <FilterDropdown label="Assignee" activeCount={activeAssignees.size + negatedAssignees.size} width={240}>
            <FilterSection title="Assignee">
              <FilterOption active={activeAssignees.has('me')} negated={negatedAssignees.has('me')}
                label="Mine" icon={<Avatar who="me" size="xs"/>}
                onClick={(e) => { if (e.detail >= 2) negate(setNegatedAssignees, setActiveAssignees)('me'); else toggle(setActiveAssignees)('me'); }}/>
              <FilterOption active={activeAssignees.has('unassigned')} negated={negatedAssignees.has('unassigned')}
                label="Unassigned"
                onClick={(e) => { if (e.detail >= 2) negate(setNegatedAssignees, setActiveAssignees)('unassigned'); else toggle(setActiveAssignees)('unassigned'); }}/>
              {TEAM.map(t => (
                <FilterOption key={t.id} active={activeAssignees.has(t.id)} negated={negatedAssignees.has(t.id)}
                  label={t.name} icon={<Avatar who={t.id} size="xs"/>}
                  onClick={(e) => { if (e.detail >= 2) negate(setNegatedAssignees, setActiveAssignees)(t.id); else toggle(setActiveAssignees)(t.id); }}/>
              ))}
            </FilterSection>
          </FilterDropdown>

          {/* Priority */}
          <FilterDropdown label="Priority" activeCount={activePrios.size + negatedPrios.size} width={240}>
            <FilterSection title="Priority">
              {priorityFilterOptions.map(p => (
                <FilterOption key={p} active={activePrios.has(p)} negated={negatedPrios.has(p)}
                  label={`P${p}`} icon={<Prio p={p}/>}
                  count={allItems.filter(w => w.priority === p).length}
                  onClick={(e) => { if (e.detail >= 2) negate(setNegatedPrios, setActivePrios)(p); else toggle(setActivePrios)(p); }}/>
              ))}
            </FilterSection>
          </FilterDropdown>

          {/* Tags */}
          <FilterDropdown label="Tags" activeCount={tagsActiveCount} width={300}>
            <FilterSection title="Tags">
              <FilterOption active={noTagsOnly} label="No tags"
                onClick={() => { setNoTagsOnly(v => !v); if (!noTagsOnly) { setIncludedTags(new Set()); setExcludedTags(new Set()); } }}/>
              {allTags.map(t => (
                <FilterOption key={t} active={includedTags.has(t)} danger={excludedTags.has(t)} label={t} onClick={() => cycleTag(t)}/>
              ))}
            </FilterSection>
            {(includedTags.size > 0 || excludedTags.size > 0) && (
              <div style={{ fontSize:11, color:'var(--text-subtle)', paddingTop:4, borderTop:'1px solid var(--border)' }}>
                Click once to include · twice to exclude · again to clear
              </div>
            )}
          </FilterDropdown>

          {/* Right controls */}
          <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
            {view === 'table' && (
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:11.5, color:'var(--text-subtle)', fontWeight:500, whiteSpace:'nowrap' }}>Group by</span>
                <select value={grouping} onChange={e => setGrouping(e.target.value)} style={groupBySelectStyle}>
                  <option value="none">None</option>
                  <option value="assignee">Assignee</option>
                  <option value="state">State</option>
                  <option value="project">Project</option>
                  <option value="priority">Priority</option>
                  <option value="type">Type</option>
                </select>
                {grouping !== 'none' && (
                  <>
                    <GroupOrderMenu grouping={grouping} groups={orderGroupList} order={groupOrders?.[grouping]} setOrder={setGroupOrder}/>
                    <button className="btn sm ghost" onClick={() => setCollapsed(c => {
                      const n = { ...c };
                      const keys = new Set(filtered.map(w =>
                        grouping === 'assignee' ? (w.assignee || 'unassigned') :
                        grouping === 'state'    ? w.state :
                        grouping === 'project'  ? w.project :
                        grouping === 'type'     ? (w.type || 'unknown') :
                        `p${w.priority}`
                      ));
                      keys.forEach(k => { n[k] = true; });
                      return n;
                    })}><Icon name="chevron-right" size={12}/> Collapse all</button>
                    <button className="btn sm ghost" onClick={() => setCollapsed({})}><Icon name="chevron-down" size={12}/> Expand all</button>
                  </>
                )}
              </div>
            )}
            {view === 'board' && (
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:11.5, color:'var(--text-subtle)', fontWeight:500, whiteSpace:'nowrap' }}>Group by</span>
                <select value={boardGrouping} onChange={e => setBoardGrouping(e.target.value)} style={groupBySelectStyle}>
                  <option value="none">None</option>
                  <option value="assignee">Assignee</option>
                  <option value="project">Project</option>
                  <option value="priority">Priority</option>
                  <option value="type">Type</option>
                </select>
                {boardGrouping !== 'none' && (
                  <GroupOrderMenu grouping={boardGrouping} groups={orderGroupList} order={groupOrders?.[boardGrouping]} setOrder={setGroupOrder}/>
                )}
              </div>
            )}
            {view === 'board' && boardGrouping === 'assignee' && (
              <label style={{ display:'flex', alignItems:'center', gap:5, cursor:'pointer', fontSize:12.5, color:'var(--text-muted)', fontWeight:500, userSelect:'none', whiteSpace:'nowrap' }}>
                <input type="checkbox" checked={showEmptyAssignees} onChange={e => setShowEmptyAssignees(e.target.checked)} style={{ cursor:'pointer', accentColor:'var(--accent)' }}/>
                Show empty
              </label>
            )}
            {hasActiveFilters && (
              <button className="btn sm ghost" onClick={clearAllFilters} style={{ color:'var(--danger)', borderColor:'var(--border)' }}>
                <Icon name="x" size={12}/> Clear all
              </button>
            )}
          </div>
        </div>

        {/* Row 2: active filter chips — one per selected value */}
        {hasActiveFilters && (
          <div style={{ display:'flex', alignItems:'center', gap:5, flexWrap:'wrap', paddingLeft:1 }}>
            {search && <ActiveFilterChip label={`"${search}"`} onRemove={() => setSearch('')}/>}
            {activeProject !== 'all' && (() => {
              const proj = PROJECTS.find(p => p.id === activeProject);
              return (
                <ActiveFilterChip
                  label={proj?.name || activeProject}
                  icon={proj ? <span style={{ width:7, height:7, borderRadius:'50%', background:proj.color }}/> : null}
                  onRemove={() => setActiveProject('all')}/>
              );
            })()}
            {[...activeTypes].map(t => (
              <ActiveFilterChip key={`type:${t}`} label={t[0].toUpperCase()+t.slice(1)} icon={<TypeIcon type={t}/>}
                onRemove={() => setActiveTypes(prev => { const n=new Set(prev); n.delete(t); return n; })}/>
            ))}
            {[...negatedTypes].map(t => (
              <ActiveFilterChip key={`ntype:${t}`} negated label={t[0].toUpperCase()+t.slice(1)} icon={<TypeIcon type={t}/>}
                onRemove={() => setNegatedTypes(prev => { const n=new Set(prev); n.delete(t); return n; })}/>
            ))}
            {[...activeStates].map(s => (
              <ActiveFilterChip key={`state:${s}`} label={s}
                onRemove={() => setActiveStates(prev => { const n=new Set(prev); n.delete(s); return n; })}/>
            ))}
            {[...negatedStates].map(s => (
              <ActiveFilterChip key={`nstate:${s}`} negated label={s}
                onRemove={() => setNegatedStates(prev => { const n=new Set(prev); n.delete(s); return n; })}/>
            ))}
            {[...activeAssignees].map(a => {
              const label = a === 'me' ? 'Mine' : a === 'unassigned' ? 'Unassigned' : (TEAM.find(t => t.id === a)?.name || a);
              const icon  = a !== 'me' && a !== 'unassigned' ? <Avatar who={a} size="xs"/> : null;
              return (
                <ActiveFilterChip key={`asgn:${a}`} label={label} icon={icon}
                  onRemove={() => setActiveAssignees(prev => { const n=new Set(prev); n.delete(a); return n; })}/>
              );
            })}
            {[...negatedAssignees].map(a => {
              const label = a === 'me' ? 'Mine' : a === 'unassigned' ? 'Unassigned' : (TEAM.find(t => t.id === a)?.name || a);
              const icon  = a !== 'me' && a !== 'unassigned' ? <Avatar who={a} size="xs"/> : null;
              return (
                <ActiveFilterChip key={`nasgn:${a}`} negated label={label} icon={icon}
                  onRemove={() => setNegatedAssignees(prev => { const n=new Set(prev); n.delete(a); return n; })}/>
              );
            })}
            {[...activePrios].map(p => (
              <ActiveFilterChip key={`prio:${p}`} label={`P${p}`} icon={<Prio p={p}/>}
                onRemove={() => setActivePrios(prev => { const n=new Set(prev); n.delete(p); return n; })}/>
            ))}
            {[...negatedPrios].map(p => (
              <ActiveFilterChip key={`nprio:${p}`} negated label={`P${p}`} icon={<Prio p={p}/>}
                onRemove={() => setNegatedPrios(prev => { const n=new Set(prev); n.delete(p); return n; })}/>
            ))}
            {noTagsOnly && <ActiveFilterChip label="No tags" onRemove={() => setNoTagsOnly(false)}/>}
            {[...includedTags].map(t => (
              <ActiveFilterChip key={`tag:${t}`} label={t}
                onRemove={() => setIncludedTags(prev => { const n=new Set(prev); n.delete(t); return n; })}/>
            ))}
            {[...excludedTags].map(t => (
              <ActiveFilterChip key={`xtag:${t}`} negated label={t}
                onRemove={() => setExcludedTags(prev => { const n=new Set(prev); n.delete(t); return n; })}/>
            ))}
          </div>
        )}
      </div>

      {view === 'table'
        ? <WITable items={filtered} grouping={grouping} groupOrder={groupOrders?.[grouping]} sort={sort} setSort={setSort}
                   selection={selection} setSelection={setSelection}
                   collapsed={collapsed} setCollapsed={setCollapsed}
                   updateItem={updateItem} onOpen={onOpen} team={TEAM} newItemIds={newItemIds}/>
        : <WIBoard items={filtered} updateItem={updateItem} moveState={moveState}
                   onOpen={onOpen} grouping={boardGrouping} groupOrder={groupOrders?.[boardGrouping]} team={TEAM} showEmptyAssignees={showEmptyAssignees}
                   laneMode={laneMode}
                   boardColumns={boardColumns}
                   lanes={laneMode === 'jira-columns' ? jiraColumnLanes
                     : laneMode === 'category' ? CATEGORY_LANES
                     : activeSource === 'jira' ? jiraLanes
                     : activeSource === 'github' ? GITHUB_LANES
                     : getActiveLanes(boardColumnConfig, activeProject, PROJECTS, BOARD_LANES)}
                   newItemIds={newItemIds}/>
      }

      {/* Load more bar */}
      {paginated && (totalMatched === null || allItems.length < totalMatched) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, padding: '10px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)', flex: 1 }}>
            {totalMatched !== null
              ? `Showing ${allItems.length} of ${totalMatched} work items`
              : `Showing ${allItems.length} work items — more may exist`}
          </span>
          {loadMoreErr && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{loadMoreErr}</span>}
          <button className="btn sm ghost" onClick={() => doLoad(false)} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
          {totalMatched !== null && allItems.length < totalMatched && (
            <button className="btn sm ghost" onClick={() => doLoad(true)} disabled={loadingMore}>
              Load all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Inline assignee picker — click to open a small dropdown
// ─────────────────────────────────────────────────────────
function InlineAssigneeCell({ assigneeId, team, onAssign }) {
  const [open, setOpen] = useStateW(false);
  const [pos, setPos] = useStateW(null);
  const ref = React.useRef(null);
  const btnRef = React.useRef(null);
  const popRef = React.useRef(null);

  const reposition = React.useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 178)) });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    reposition();
    // Popover is portaled to <body>; close only when a click misses BOTH the trigger and the popover.
    const onDown = (e) => {
      if (!ref.current?.contains(e.target) && !popRef.current?.contains(e.target)) setOpen(false);
    };
    const onScroll = () => reposition();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, reposition]);

  const member = team.find(t => t.id === assigneeId);

  const optStyle = {
    display: 'flex', alignItems: 'center', gap: 7, width: '100%',
    padding: '5px 8px', borderRadius: 7, border: 'none', background: 'none',
    cursor: 'pointer', fontSize: 12.5, color: 'var(--text)', textAlign: 'left',
    fontFamily: 'var(--sans)',
  };

  return (
    <div ref={ref} style={{ display: 'inline-block' }}>
      <button
        ref={btnRef}
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'none'; }}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, background: open ? 'var(--surface-2)' : 'none',
          border: '1px solid transparent', cursor: 'pointer', padding: '2px 5px 2px 3px',
          borderRadius: 6, transition: 'background .1s', fontFamily: 'var(--sans)',
        }}
      >
        {member
          ? <><Avatar who={member.id} size="xs"/><span className="muted" style={{ fontSize: 12 }}>{member.name.split(' ')[0]}</span></>
          : <span className="muted" style={{ fontSize: 12 }}>Unassigned</span>
        }
        <Icon name="chevron-down" size={9} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
      </button>
      {open && pos && createPortal(
        <div ref={popRef} onClick={e => e.stopPropagation()} style={{
          position: 'fixed', top: pos.top, left: pos.left, zIndex: 2000,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: 'var(--shadow-pop)',
          minWidth: 170, maxHeight: 260, overflowY: 'auto', padding: 4,
        }}>
          <button
            onClick={e => { e.stopPropagation(); onAssign(null); setOpen(false); }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
            style={{ ...optStyle, color: 'var(--text-muted)' }}
          >
            <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--border)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon name="team" size={11}/>
            </span>
            Unassigned
            {!assigneeId && <Icon name="check" size={10} style={{ marginLeft: 'auto', color: 'var(--accent)' }}/>}
          </button>
          {team.map(t => (
            <button
              key={t.id}
              onClick={e => { e.stopPropagation(); onAssign(t.id); setOpen(false); }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
              style={{ ...optStyle, fontWeight: t.id === assigneeId ? 600 : 400 }}
            >
              <Avatar who={t.id} size="xs"/>
              {t.name}
              {t.id === assigneeId && <Icon name="check" size={10} style={{ marginLeft: 'auto', color: 'var(--accent)' }}/>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// InlineTagsCell — click-to-edit tag list (card + table)
// ─────────────────────────────────────────────────────────
function InlineTagsCell({ tags = [], onTagsChange }) {
  const { data: NexusMDData } = useNexusData();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [pos, setPos] = React.useState(null);
  const ref = React.useRef(null);
  const btnRef = React.useRef(null);
  const popRef = React.useRef(null);

  // Position the portaled popover under the trigger, clamped to the viewport.
  const reposition = React.useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      top: r.bottom + 4,
      left: Math.max(8, Math.min(r.left, window.innerWidth - 218)),
    });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    reposition();
    // The popover is portaled to <body>, so a click inside it is outside `ref`;
    // close only when the click misses BOTH the trigger and the popover.
    const onDown = e => {
      if (!ref.current?.contains(e.target) && !popRef.current?.contains(e.target)) {
        setOpen(false); setQuery('');
      }
    };
    // Keep the fixed-position popover glued to the trigger as ancestors scroll.
    const onScroll = () => reposition();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, reposition]);

  const knownTags = React.useMemo(() => {
    const s = new Set();
    (NexusMDData.WORK_ITEMS || []).forEach(wi => { (wi.tags || []).forEach(t => { if (t) s.add(t); }); });
    return [...s].sort((a, b) => a.localeCompare(b));
  }, []);

  const filteredTags = knownTags.filter(t => !tags.includes(t) && (!query || t.toLowerCase().includes(query.toLowerCase())));
  const canCreate = query.trim() && !knownTags.some(t => t.toLowerCase() === query.trim().toLowerCase()) && !tags.includes(query.trim());
  const addTag = tag => { const t = tag.trim(); if (!t || tags.includes(t)) return; onTagsChange([...tags, t]); setQuery(''); };
  const removeTag = tag => onTagsChange(tags.filter(t => t !== tag));

  return (
    <div ref={ref} style={{ display: 'inline-flex' }}>
      <button
        ref={btnRef}
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 3, flexWrap: 'nowrap',
          background: open ? 'var(--surface-2)' : 'none', border: '1px solid transparent',
          cursor: 'pointer', padding: '2px 5px 2px 3px', borderRadius: 6,
          transition: 'background .1s', fontFamily: 'var(--sans)', maxWidth: 220,
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'none'; }}
      >
        {tags.length === 0
          ? <span className="muted" style={{ fontSize: 11.5 }}>Tags</span>
          : <>
              {tags.slice(0, 2).map(t => <span key={t} className="tag" style={{ fontSize: 10.5 }}>{t}</span>)}
              {tags.length > 2 && <span className="muted mono" style={{ fontSize: 10.5 }}>+{tags.length - 2}</span>}
            </>
        }
        <Icon name="chevron-down" size={9} style={{ color: 'var(--text-subtle)', flexShrink: 0, marginLeft: 1 }}/>
      </button>

      {open && pos && createPortal(
        <div ref={popRef} onClick={e => e.stopPropagation()} style={{
          position: 'fixed', top: pos.top, left: pos.left, zIndex: 2000,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: 'var(--shadow-pop)',
          minWidth: 210, maxHeight: 300, display: 'flex', flexDirection: 'column', padding: 8, gap: 6,
        }}>
          {tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {tags.map(t => (
                <span key={t} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  background: 'var(--accent-soft)', color: 'var(--accent)',
                  borderRadius: 5, padding: '2px 7px', fontSize: 11.5, fontWeight: 500,
                }}>
                  {t}
                  <span style={{ cursor: 'pointer', opacity: 0.7, fontSize: 13, lineHeight: 1 }}
                    onMouseDown={e => { e.preventDefault(); removeTag(t); }}>×</span>
                </span>
              ))}
            </div>
          )}
          <input
            value={query} onChange={e => setQuery(e.target.value)} autoFocus
            onKeyDown={e => {
              if ((e.key === 'Enter' || e.key === ',') && query.trim()) { e.preventDefault(); addTag(query.trim()); }
              if (e.key === 'Escape') { setOpen(false); setQuery(''); }
            }}
            placeholder="Add tag…"
            style={{
              border: '1px solid var(--border)', borderRadius: 6, outline: 'none',
              padding: '5px 8px', fontSize: 12.5, background: 'var(--surface-2)',
              color: 'var(--text)', fontFamily: 'var(--sans)',
            }}
          />
          {(filteredTags.length > 0 || canCreate) && (
            <div style={{ overflowY: 'auto' }}>
              {filteredTags.slice(0, 10).map(t => (
                <button key={t} onMouseDown={e => { e.preventDefault(); addTag(t); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px', borderRadius: 6, border: 0, background: 'transparent', cursor: 'pointer', fontSize: 12.5, color: 'var(--text)', fontFamily: 'var(--sans)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >{t}</button>
              ))}
              {canCreate && (
                <button onMouseDown={e => { e.preventDefault(); addTag(query.trim()); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px', borderRadius: 6, border: 0, background: 'transparent', cursor: 'pointer', fontSize: 12.5, color: 'var(--accent)', fontFamily: 'var(--sans)', borderTop: filteredTags.length ? '1px solid var(--border)' : 'none' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >+ Create "{query.trim()}"</button>
              )}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Table view (with grouping)
// ─────────────────────────────────────────────────────────
function WITable({ items, grouping, groupOrder, sort, setSort, selection, setSelection, collapsed, setCollapsed, updateItem, onOpen, team, newItemIds = new Set() }) {
  const { data: NexusMDData, workItemSource } = useNexusData();
  const TEAM = team || NexusMDData.TEAM || [];
  const [tableDragId, setTableDragId] = useStateW(null);
  const [tableCfg] = usePersisted('nexusmd.fields.wiTable', []);
  const visibleCols = resolveFields(WI_TABLE_COLUMNS, tableCfg).filter(f => f.visible);

  const patchWI = (id, ops) => patchWorkItem(workItemSource, id, ops);

  const onDropState = async (state) => {
    if (!tableDragId) return;
    const id = tableDragId;
    const prev = items.find(w => w.id === id);
    setTableDragId(null);
    updateItem(id, { state });
    if (!(await patchWI(id, [['/fields/System.State', state]])) && prev) updateItem(id, { state: prev.state });
  };

  const onDropAssignee = async (assigneeId) => {
    if (!tableDragId) return;
    const member = TEAM.find(t => t.id === assigneeId);
    updateItem(tableDragId, { assignee: assigneeId || null });
    await patchWI(tableDragId, [['/fields/System.AssignedTo', member?.name || null]]);
    setTableDragId(null);
  };

  const sorted = sortItems(items, sort);

  const titleColWidth = 280;

  const groups = useMemoW(() => {
    if (grouping === 'none') return [{ key: '__all__', label: null, items: sorted }];
    const map = new Map();
    sorted.forEach(w => {
      let key, label;
      if (grouping === 'assignee') {
        key = w.assignee || 'unassigned';
        const m = TEAM.find(t => t.id === w.assignee);
        label = m ? m.name : 'Unassigned';
      } else if (grouping === 'state') { key = w.state; label = w.state; }
      else if (grouping === 'project') {
        key = w.project; label = NexusMDData.PROJECTS.find(p => p.id === w.project)?.name || w.project;
      } else if (grouping === 'priority') { key = `p${w.priority}`; label = `Priority ${w.priority}`; }
      else if (grouping === 'type')     { key = w.type || 'unknown'; label = w.type || 'Unknown'; }
      if (!map.has(key)) map.set(key, { key, label, items: [] });
      map.get(key).items.push(w);
    });
    return orderGroups(Array.from(map.values()), groupOrder);
  }, [sorted, grouping, groupOrder]);

  const toggleSel = (id) => setSelection(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const allChecked = items.length > 0 && items.every(w => selection.has(w.id));
  const headerSelToggle = () => {
    if (allChecked) setSelection(new Set());
    else setSelection(new Set(items.map(w => w.id)));
  };

  const headFor = (key) => {
    switch (key) {
      case 'id':       return <SortHeader key="id" col="id" label="ID" sort={sort} setSort={setSort}/>;
      case 'type':     return <th key="type">Type</th>;
      case 'title':    return <SortHeader key="title" col="title" label="Title" sort={sort} setSort={setSort}/>;
      case 'project':  return <th key="project">Project</th>;
      case 'state':    return <th key="state">State</th>;
      case 'assignee': return <th key="assignee">Assignee</th>;
      case 'priority': return <SortHeader key="priority" col="priority" label="P" sort={sort} setSort={setSort}/>;
      case 'tags':     return <th key="tags">Tags</th>;
      case 'updated':  return <SortHeader key="updated" col="updated" label="Updated" sort={sort} setSort={setSort}/>;
      default:         return null;
    }
  };

  const cellFor = (key, w) => {
    switch (key) {
      case 'id': return (
        <td key="id" className="id" onClick={e=>e.stopPropagation()}>
          <WorkItemIdLink w={w} />
          {newItemIds.has(w.id) && <span style={{ fontSize:9, fontWeight:700, background:'var(--accent)', color:'var(--accent-fg)', padding:'1px 5px', borderRadius:3, textTransform:'uppercase', letterSpacing:'0.05em', marginLeft:6 }}>New</span>}
        </td>);
      case 'type': return <td key="type"><TypeIcon type={w.type}/></td>;
      case 'title': return (
        <td key="title" className="title">
          <span className="truncate" style={{ display: 'inline-block', maxWidth: titleColWidth, verticalAlign: 'middle' }}>{w.title}</span>
          {w.comments > 0 && <span className="muted mono" style={{ fontSize: 10.5, marginLeft: 8 }}><Icon name="comment" size={10}/> {w.comments}</span>}
          {w.prs > 0 && (
            <button
              type="button"
              className="mono"
              title="View linked pull requests"
              onClick={e => { e.stopPropagation(); navigateToPRs(w.id); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 6, fontSize: 10.5, border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)' }}
            ><Icon name="pr" size={10}/> {w.prs}</button>
          )}
        </td>);
      case 'project': return <td key="project"><ProjectChip id={w.project}/></td>;
      case 'state': return <td key="state"><StateDot state={w.state} withLabel/></td>;
      case 'assignee': return (
        <td key="assignee" onClick={e => e.stopPropagation()}>
          <InlineAssigneeCell assigneeId={w.assignee} team={TEAM} onAssign={async (assigneeId) => { const member = TEAM.find(t => t.id === assigneeId); updateItem(w.id, { assignee: assigneeId || null }); await patchWI(w.id, [['/fields/System.AssignedTo', member?.name || null]]); }} />
        </td>);
      case 'priority': return <td key="priority"><Prio p={w.priority}/></td>;
      case 'tags': return (
        <td key="tags" onClick={e => e.stopPropagation()}>
          <InlineTagsCell tags={w.tags || []} onTagsChange={async newTags => { updateItem(w.id, { tags: newTags }); await patchWI(w.id, [['/fields/System.Tags', newTags.join('; ')]]); }} />
        </td>);
      case 'updated': return <td key="updated" className="muted mono" style={{ fontSize: 11 }}>{w.updated} ago</td>;
      default: return null;
    }
  };

  return (
    <React.Fragment>
    <div className="card">
      <div style={{ overflowX: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 16, paddingRight: 0 }}/>
            <th style={{ width: 28, paddingRight: 4 }} onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={allChecked} onChange={headerSelToggle} style={{ cursor: 'pointer' }}/>
            </th>
            {visibleCols.map(f => headFor(f.key))}
            <th style={{ width: 32 }}/>
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <React.Fragment key={g.key}>
              {g.label !== null && (
                <tr style={{ background: 'var(--surface-2)' }} onClick={() => setCollapsed(c => ({ ...c, [g.key]: !c[g.key] }))}>
                  <td colSpan={2 + visibleCols.length + 1} style={{ height: 32, fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Icon name={collapsed[g.key] ? 'chevron-right' : 'chevron-down'} size={11}/>
                      {grouping === 'assignee' && g.key !== 'unassigned' && <Avatar who={g.key} size="xs"/>}
                      {grouping === 'type' && <TypeIcon type={g.key}/>}
                      <span>{g.label}</span>
                      <span className="muted mono" style={{ fontSize: 10.5, fontWeight: 500 }}>{g.items.length}</span>
                    </span>
                  </td>
                </tr>
              )}
              {!collapsed[g.key] && g.items.map(w => (
                <tr key={w.id}
                    className={`${selection.has(w.id) ? 'selected' : ''}${tableDragId === w.id ? ' dragging' : ''}`}
                    draggable
                    onDragStart={e => { e.dataTransfer.setData('text/plain', String(w.id)); setTableDragId(w.id); }}
                    onDragEnd={() => setTableDragId(null)}
                    onClick={() => onOpen(w)}
                    onMouseEnter={() => { clearTimeout(_wiHoverTimer); _wiHoverTimer = setTimeout(() => WorkItemDetail.prefetch(w.id, w.project), 100); }}
                    onMouseLeave={() => clearTimeout(_wiHoverTimer)}
                    style={newItemIds.has(w.id) ? { background: 'color-mix(in srgb, var(--accent) 7%, var(--surface))', boxShadow: 'inset 3px 0 0 var(--accent)' } : undefined}>
                  <td style={{ width: 16, paddingRight: 0, paddingLeft: 6, cursor: 'grab' }}>
                    <span className="drag-handle" style={{ display: 'flex', flexDirection: 'column', gap: 2, color: 'var(--text-subtle)', opacity: 0, transition: 'opacity 0.15s' }}>
                      {[0,1].map(i => (<span key={i} style={{ display: 'flex', gap: 2 }}><span style={{ width: 2, height: 2, borderRadius: '50%', background: 'currentColor' }}/><span style={{ width: 2, height: 2, borderRadius: '50%', background: 'currentColor' }}/></span>))}
                    </span>
                  </td>
                  <td onClick={(e) => { e.stopPropagation(); toggleSel(w.id); }} style={{ paddingRight: 4 }}>
                    <input type="checkbox" checked={selection.has(w.id)} onChange={()=>{}} style={{ cursor: 'pointer' }}/>
                  </td>
                  {visibleCols.map(f => cellFor(f.key, w))}
                  <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                    <MenuButton items={[
                      { label: 'Open detail', icon: <Icon name="eye" size={12}/>, onClick: () => onOpen(w) },
                      { label: 'Edit', icon: <Icon name="edit" size={12}/>, kbd: 'E' },
                      { label: 'Copy link', icon: <Icon name="link" size={12}/>, kbd: '⌘.' },
                      { label: 'Mark done', icon: <Icon name="check" size={12}/>, onClick: () => updateItem(w.id, { state: 'Done' }) },
                    ]}/>
                  </td>
                </tr>
              ))}
            </React.Fragment>
          ))}
          {items.length === 0 && (
            <tr><td colSpan={12} className="empty">No work items match your filters</td></tr>
          )}
        </tbody>
      </table>
      </div>

      {selection.size > 0 && (
        <BulkBar count={selection.size} onClear={() => setSelection(new Set())} team={TEAM}
          onAssign={async (assigneeId) => {
            const selectedIds = Array.from(selection);
            const assigneeName = assigneeId ? TEAM.find(t=>t.id===assigneeId)?.name||'' : '';
            selectedIds.forEach(id => updateItem(id, { assignee: assigneeId||null }));
            setSelection(new Set());
            await Promise.all(selectedIds.map(id =>
              patchWI(id, [['/fields/System.AssignedTo', assigneeName || null]])
            ));
          }}
          onMarkDone={async () => {
            const selected = items.filter(w => selection.has(w.id));
            setSelection(new Set());
            const failures = [];
            await Promise.all(selected.map(async w => {
              if (itemCategory(w) === 'Completed') return;
              try {
                if (workItemSource?.moveToCategory) {
                  const r = await workItemSource.moveToCategory(w.id, 'Completed', w);
                  updateItem(w.id, { state: r.state, stateCategory: r.stateCategory });
                } else {
                  updateItem(w.id, { state: 'Done' });
                  if (!(await patchWI(w.id, [['/fields/System.State', 'Done']]))) failures.push(`${displayIdOf(w)}: save failed`);
                }
              } catch (e) {
                failures.push(`${displayIdOf(w)}: ${e?.message || 'failed'}`);
              }
            }));
            if (failures.length) toast?.(`✗ ${failures.length} of ${selected.length} not marked done — ${failures.join('; ')}`, 'error');
          }}
        />
      )}
    </div>
    <DragContextBar visible={tableDragId != null} team={TEAM} onDropState={onDropState} onDropAssignee={onDropAssignee}/>
    </React.Fragment>
  );
}

function BulkBar({ count, onClear, team, onAssign, onMarkDone }) {
  const [showAssign, setShowAssign] = useStateW(false);
  const barStyle = { color: 'var(--bg)' };
  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: 'var(--text)', color: 'var(--bg)', padding: '8px 12px',
      borderRadius: 10, boxShadow: 'var(--shadow-pop)', display: 'flex', alignItems: 'center',
      gap: 8, fontSize: 13, zIndex: 60
    }}>
      <span style={{ fontWeight: 600 }}>{count} selected</span>
      <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.15)' }}/>
      {showAssign ? (
        <React.Fragment>
          <select defaultValue="" onChange={e => { if (e.target.value !== '') { onAssign?.(e.target.value); setShowAssign(false); } }}
            style={{ height: 28, padding: '0 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.1)', color: 'var(--bg)', fontSize: 12.5 }}>
            <option value="" disabled>Pick a team member…</option>
            <option value="">Unassigned</option>
            {(team||[]).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button className="btn sm ghost" style={barStyle} onClick={() => setShowAssign(false)}><Icon name="x" size={12}/></button>
        </React.Fragment>
      ) : (
        <button className="btn sm ghost" style={barStyle} onClick={() => setShowAssign(true)}><Icon name="team" size={12}/> Assign</button>
      )}
      <button className="btn sm ghost" style={barStyle} onClick={() => { onMarkDone?.(); }}><Icon name="check" size={12}/> Mark done</button>
      <button className="btn sm ghost" style={barStyle} onClick={onClear}><Icon name="x" size={12}/></button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Board view — drag between state lanes + drag context bar
// ─────────────────────────────────────────────────────────

const BOARD_LANE_COLORS = {
  'Backlog':     'var(--text-subtle)',
  'To Do':       'var(--text-muted)',
  'Active':      'var(--info)',
  'In Progress': 'var(--info)',
  'In Review':   'var(--violet)',
  'Blocked':     'var(--danger)',
  'Resolved':    'var(--success)',
  'Done':        'var(--success)',
  'Closed':      'var(--text-subtle)',
  'Proposed':    'var(--text-muted)',
  'InProgress':  'var(--info)',
  'Completed':   'var(--success)',
};
const laneColor = (state) => BOARD_LANE_COLORS[state] || 'var(--text-muted)';

// Fallback lane list used when no persisted board column config exists yet.
const BOARD_LANES = ['Backlog', 'To Do', 'In Progress', 'In Review', 'Blocked', 'Done'];

const PRIORITY_LABELS = { 1: 'Critical', 2: 'High', 3: 'Medium', 4: 'Low' };

// ── DragContextBar ─────────────────────────────────────────
// Springs up from the bottom when a card is being dragged.
// Drop on a state pill → change state. Drop on an avatar → reassign.
function DragContextBar({ visible, team, onDropState, onDropAssignee, lanes = BOARD_LANES, laneLabel = (s) => s }) {
  const [hovered, setHovered] = React.useState(null);

  React.useEffect(() => { if (!visible) setHovered(null); }, [visible]);

  return (
    <div style={{
      position: 'fixed',
      bottom: visible ? 24 : -110,
      left: '50%',
      transform: 'translateX(-50%)',
      transition: 'bottom 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)',
      zIndex: 80,
      display: 'flex',
      alignItems: 'center',
      gap: 5,
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: '7px 12px',
      boxShadow: '0 16px 48px rgba(0,0,0,0.22), 0 4px 12px rgba(0,0,0,0.1)',
      userSelect: 'none',
      pointerEvents: visible ? 'all' : 'none',
      maxWidth: 'calc(100vw - 32px)',
      overflowX: 'auto',
    }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-subtle)', flexShrink: 0, marginRight: 3 }}>
        Move to
      </span>

      {lanes.map(state => {
        const key = `state:${state}`;
        const isHov = hovered === key;
        const col = laneColor(state);
        return (
          <div
            key={state}
            onDragOver={e => { e.preventDefault(); setHovered(key); }}
            onDragLeave={() => setHovered(null)}
            onDrop={e => { e.preventDefault(); setHovered(null); onDropState(state); }}
            style={{
              height: 28,
              padding: '0 9px',
              borderRadius: 7,
              border: `1px solid ${isHov ? col : 'var(--border)'}`,
              background: isHov ? `color-mix(in srgb, ${col} 14%, var(--surface))` : 'var(--surface-2)',
              color: isHov ? col : 'var(--text-muted)',
              display: 'inline-flex', alignItems: 'center', gap: 5,
              cursor: 'crosshair', fontSize: 12, fontWeight: isHov ? 600 : 500,
              transition: 'all 0.1s ease',
              transform: isHov ? 'translateY(-2px) scale(1.05)' : 'none',
              flexShrink: 0, whiteSpace: 'nowrap',
            }}
          >
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: col, flexShrink: 0 }} />
            {laneLabel(state)}
          </div>
        );
      })}

      {team.length > 0 && (
        <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0, margin: '0 4px' }} />
      )}

      {team.length > 0 && (
        <React.Fragment>
          <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-subtle)', flexShrink: 0, marginRight: 3 }}>
            Assign
          </span>
          {/* Unassign target */}
          {(() => {
            const key = 'assignee:__none__';
            const isHov = hovered === key;
            return (
              <div
                onDragOver={e => { e.preventDefault(); setHovered(key); }}
                onDragLeave={() => setHovered(null)}
                onDrop={e => { e.preventDefault(); setHovered(null); onDropAssignee(null); }}
                title="Remove assignee"
                style={{
                  width: 28, height: 28, borderRadius: 7,
                  border: `1px solid ${isHov ? 'var(--border)' : 'var(--border)'}`,
                  background: isHov ? 'var(--surface-2)' : 'transparent',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'crosshair', color: 'var(--text-subtle)', fontSize: 15,
                  transition: 'all 0.1s ease',
                  transform: isHov ? 'scale(1.15)' : 'none',
                  flexShrink: 0,
                }}
              >—</div>
            );
          })()}
          {team.map(member => {
            const key = `assignee:${member.id}`;
            const isHov = hovered === key;
            return (
              <div
                key={member.id}
                onDragOver={e => { e.preventDefault(); setHovered(key); }}
                onDragLeave={() => setHovered(null)}
                onDrop={e => { e.preventDefault(); setHovered(null); onDropAssignee(member.id); }}
                title={member.name}
                style={{
                  width: 30, height: 30, borderRadius: 8,
                  border: `2px solid ${isHov ? 'var(--accent)' : 'transparent'}`,
                  outline: isHov ? '3px solid color-mix(in srgb, var(--accent) 22%, transparent)' : 'none',
                  outlineOffset: 1,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'crosshair',
                  transition: 'all 0.1s ease',
                  transform: isHov ? 'translateY(-3px) scale(1.2)' : 'none',
                  flexShrink: 0,
                }}
              >
                <Avatar who={member.id} size="xs" />
              </div>
            );
          })}
        </React.Fragment>
      )}
    </div>
  );
}

// Same hue formula as Avatar (app-components.jsx), so a person's card accent
// matches their avatar color.
function personColor(id) {
  const hueSeed = (id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = (hueSeed * 47) % 360;
  return `oklch(0.75 0.1 ${hue})`;
}

function BoardCard({ w, dragId, onDragStart, onDragEnd, onOpen, team = [], onAssign, onTagsChange, grouping = 'none', projects = [], isNew = false, showState = false, singleLineTitle = false }) {
  const { data: NexusMDData } = useNexusData();
  const [cfg] = usePersisted('nexusmd.fields.wiCard', []);
  const resolved = resolveFields(WI_CARD_FIELDS, cfg).filter(f => f.visible);
  const visible = new Set(resolved.map(f => f.key));
  const metaFrag = {
    assignee: () => (
      <div key="assignee" onClick={e => e.stopPropagation()}>
        <InlineAssigneeCell assigneeId={w.assignee} team={team} onAssign={onAssign} />
      </div>
    ),
    tags: () => (
      <div key="tags" onClick={e => e.stopPropagation()}>
        <InlineTagsCell tags={w.tags || []} onTagsChange={onTagsChange} />
      </div>
    ),
    points: () => <span key="points" className="muted mono" style={{ fontSize: 10.5 }}>{w.points} pts</span>,
    comments: () => (w.comments > 0 ? <span key="comments" className="muted mono" style={{ fontSize: 10.5 }}><Icon name="comment" size={10}/> {w.comments}</span> : null),
    prs: () => (w.prs > 0 ? (
      <button
        key="prs"
        type="button"
        className="mono"
        title="View linked pull requests"
        onClick={e => { e.stopPropagation(); navigateToPRs(w.id); }}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)' }}
      ><Icon name="pr" size={10}/> {w.prs}</button>
    ) : null),
  };
  const detailKeys = ['assignee', 'tags', 'points'];
  const countKeys = ['comments', 'prs'];
  const detailFields = resolved.filter(f => detailKeys.includes(f.key));
  const countFields = resolved.filter(f => countKeys.includes(f.key));
  const isDragging = dragId === w.id;
  // Cards are accented by project, except when the board is already grouped
  // by project — the group header covers that, so accent by assignee instead
  // to add a dimension rather than repeat the grouping.
  const accentColor = grouping === 'project'
    ? (w.assignee ? personColor(w.assignee) : null)
    : (projects.find(p => p.id === w.project)?.color || null);
  return (
    <div
      className={`board-card ${isDragging ? 'dragging' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(w)}
      onMouseEnter={() => { clearTimeout(_wiHoverTimer); _wiHoverTimer = setTimeout(() => WorkItemDetail.prefetch(w.id, w.project), 100); }}
      onMouseLeave={() => clearTimeout(_wiHoverTimer)}
      style={{
        boxShadow: isNew ? 'inset 3px 0 0 var(--accent)' : (accentColor ? `inset 3px 0 0 ${accentColor}` : undefined),
        background: isNew ? 'color-mix(in srgb, var(--accent) 7%, var(--surface))' : undefined,
        ...(isDragging ? { opacity: 0.45, transform: 'rotate(1.5deg) scale(0.97)' } : {}),
      }}
    >
      <div className="board-card-head">
        <TypeIcon type={w.type}/>
        <WorkItemIdLink w={w} fontSize={11.5} />
        {showState && <span className="muted" style={{ fontSize: 10.5 }}>{w.state}</span>}
        {isNew && <span style={{ fontSize:9, fontWeight:700, background:'var(--accent)', color:'var(--accent-fg)', padding:'1px 5px', borderRadius:3, textTransform:'uppercase', letterSpacing:'0.05em', flexShrink:0 }}>New</span>}

        <span className="spacer"/>
        {visible.has('priority') && <Prio p={w.priority}/>}
        <span style={{
          display: 'flex', flexDirection: 'column', gap: 2, padding: '0 2px',
          color: 'var(--text-subtle)', opacity: 0, transition: 'opacity 0.15s',
        }} className="drag-handle">
          {[0,1,2].map(i => (
            <span key={i} style={{ display: 'flex', gap: 2 }}>
              <span style={{ width: 2.5, height: 2.5, borderRadius: '50%', background: 'currentColor' }}/>
              <span style={{ width: 2.5, height: 2.5, borderRadius: '50%', background: 'currentColor' }}/>
            </span>
          ))}
        </span>
      </div>
      <div className="board-card-title"
        title={singleLineTitle ? w.title : undefined}
        style={singleLineTitle ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } : undefined}>{w.title}</div>
      <div className="board-card-meta">
        {detailFields.map(f => metaFrag[f.key]())}
        <span className="spacer"/>
        {countFields.map(f => metaFrag[f.key]())}
      </div>
      {visible.has('updated') && w.updated && w.updated !== '—' && (
        <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 5 }}
             title={w.changedMs ? new Date(w.changedMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}>
          Updated {w.updated} ago
        </div>
      )}
    </div>
  );
}

// A lane header button, styled with the header's existing "add" button. Inline styles here and in
// BoardLanes, not base.css, so a Work-only release carries them (the stylesheet ships with the shell).
function LaneToggle({ label, icon, onToggle }) {
  return (
    <span role="button" tabIndex={0} className="add" aria-label={label} title={label}
      style={{ marginLeft: 0 }}
      onClick={onToggle}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}>
      <Icon name={icon} size={12}/>
    </span>
  );
}

// Widest a widened lane grows to fit its titles on one line; longer titles are cut with an ellipsis.
const WIDE_LANE_MAX = 'min(900px, 85vw)';

function BoardLanes({ items, groupKey, dragId, overKey, onDragStart, onDragEnd, onLaneOver, onLaneDrop, onOpen, lanes = BOARD_LANES, team = [], onAssign, onTagsChange, grouping = 'none', projects = [], newItemIds = new Set(), laneMode = 'state', reachable = null, boardColumns = null, collapsedLanes = {}, onToggleLane, widenedLanes = {}, onToggleWide }) {
  // Lanes collapse or widen one swimlane at a time, keyed "<group>::<lane>".
  const isLaneCollapsed = (state) => !!collapsedLanes[`${groupKey}::${state}`];
  const isLaneWide = (state) => !isLaneCollapsed(state) && !!widenedLanes[`${groupKey}::${state}`];
  const track = (s) => (isLaneCollapsed(s) ? '40px' : isLaneWide(s) ? 'max-content' : '300px');
  return (
    <div className="board" style={{ gridTemplateColumns: lanes.map(track).join(' ') }}>
      {lanes.map(state => {
        const laneItems = laneMode === 'category'
          ? items.filter(w => itemCategory(w) === state)
          : laneMode === 'jira-columns'
            ? items.filter(w => (jiraColumnForStatus(boardColumns, w.state)?.name ?? '__other__') === state)
            : items.filter(w => w.state === state || adoStateToNexusMD(w.state) === state);
        const laneLabel = laneMode === 'category' ? CATEGORY_LABELS[state] : state === '__other__' ? 'Other' : state;
        const dimmed = !!reachable && !reachable.has(state);
        const isOver = overKey === `${groupKey}::${state}`;
        const laneCollapsed = isLaneCollapsed(state);
        const laneWide = isLaneWide(state);
        const toggleBtn = onToggleLane && (
          <LaneToggle label={`${laneCollapsed ? 'Expand' : 'Collapse'} ${laneLabel}`}
            icon={laneCollapsed ? 'chevron-right' : 'chevron-left'}
            onToggle={() => onToggleLane(`${groupKey}::${state}`)}/>
        );
        const wideBtn = onToggleWide && (
          <LaneToggle label={`${laneWide ? 'Narrow' : 'Widen'} ${laneLabel}`}
            icon={laneWide ? 'collapse' : 'expand'}
            onToggle={() => onToggleWide(`${groupKey}::${state}`)}/>
        );
        return (
          <div
            key={state}
            className={`lane${laneCollapsed ? ' collapsed' : ''}`}
            onDragOver={e => { e.preventDefault(); onLaneOver(`${groupKey}::${state}`); }}
            onDrop={e => { e.preventDefault(); onLaneDrop(state, groupKey); }}
            style={{
              ...(laneCollapsed ? { padding: '8px 4px', alignItems: 'center' } : {}),
              ...(laneWide ? { minWidth: 300, maxWidth: WIDE_LANE_MAX } : {}),
              ...(isOver ? { background: 'var(--accent-soft)', borderColor: 'var(--accent-border)' } : {}),
              ...(dimmed ? { opacity: 0.4 } : {}),
            }}
          >
            {laneCollapsed ? (
              // A narrow strip: toggle, then the count and the name running down it.
              <div className="lane-head" style={{ flexDirection: 'column', padding: 0, gap: 8 }}>
                {toggleBtn}
                <span className="lane-dot" style={{ background: laneColor(state) }}/>
                <span className="count">{laneItems.length}</span>
                <h4 style={{ writingMode: 'vertical-rl', whiteSpace: 'nowrap' }}>{laneLabel}</h4>
              </div>
            ) : (
            <div className="lane-head">
              <span className="lane-dot" style={{ background: laneColor(state) }}/>
              <h4>{laneLabel}</h4>
              <span className="count">{laneItems.length}</span>
              <span className="add" title="Add item"><Icon name="plus" size={12}/></span>
              {wideBtn}
              {toggleBtn}
            </div>
            )}
            {!laneCollapsed && <div className="lane-list">
              {laneItems.map(w => (
                <BoardCard
                  key={w.id}
                  w={w}
                  dragId={dragId}
                  onDragStart={e => { e.dataTransfer.setData('text/plain', String(w.id)); onDragStart(w.id); }}
                  onDragEnd={onDragEnd}
                  onOpen={onOpen}
                  team={team}
                  onAssign={assigneeId => onAssign?.(w.id, assigneeId)}
                  onTagsChange={newTags => onTagsChange?.(w.id, newTags)}
                  grouping={grouping}
                  projects={projects}
                  isNew={newItemIds.has(w.id)}
                  showState={laneMode === 'category' || laneMode === 'jira-columns'}
                  singleLineTitle={laneWide}
                />
              ))}
              {laneItems.length === 0 && (
                <div style={{
                  padding: 16, textAlign: 'center', color: 'var(--text-subtle)', fontSize: 11.5,
                  border: `1px dashed ${isOver ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 8,
                  background: isOver ? 'var(--accent-soft)' : 'transparent',
                  transition: 'all 0.1s',
                }}>
                  {isOver ? 'Release to move here' : 'Drop items here'}
                </div>
              )}
            </div>}
          </div>
        );
      })}
    </div>
  );
}

function WIBoard({ items, updateItem, moveState, onOpen, grouping = 'none', groupOrder, team = [], showEmptyAssignees = false, lanes = BOARD_LANES, newItemIds = new Set(), laneMode = 'state', boardColumns = null }) {
  const { data: NexusMDData, workItemSource } = useNexusData();
  const [dragId,    setDragId]    = useStateW(null);
  const [overKey,   setOverKey]   = useStateW(null);
  const [collapsed, setCollapsed] = useCollapsedGroups('nexusmd.wi.collapsed.board', grouping);
  const [collapsedLanes, setCollapsedLanes] = useCollapsedGroups('nexusmd.wi.collapsed.lanes', grouping);
  const [widenedLanes, setWidenedLanes] = useCollapsedGroups('nexusmd.wi.widened.lanes', grouping);

  const PROJECTS = NexusMDData.PROJECTS || [];

  const patchWI = (id, ops) => patchWorkItem(workItemSource, id, ops);

  const groups = useMemoW(() => {
    if (grouping === 'none') return [{ key: '__all__', label: null, icon: null, items }];
    const map = new Map();
    items.forEach(w => {
      let key, label;
      if (grouping === 'assignee') {
        key = w.assignee || 'unassigned';
        const member = team.find(t => t.id === w.assignee);
        label = member ? member.name : 'Unassigned';
      } else if (grouping === 'project') {
        key = w.project;
        label = PROJECTS.find(p => p.id === w.project)?.name || w.project;
      } else if (grouping === 'priority') {
        key = `p${w.priority}`;
        label = `P${w.priority} — ${PRIORITY_LABELS[w.priority] || w.priority}`;
      } else if (grouping === 'type') {
        key = w.type || 'unknown';
        label = w.type ? w.type.charAt(0).toUpperCase() + w.type.slice(1) : 'Unknown';
      }
      if (!map.has(key)) map.set(key, { key, label, items: [] });
      map.get(key).items.push(w);
    });
    // Optionally show all team members + Unassigned even when they have 0 items
    if (grouping === 'assignee' && showEmptyAssignees) {
      if (!map.has('unassigned')) map.set('unassigned', { key: 'unassigned', label: 'Unassigned', items: [] });
      team.forEach(member => {
        if (!map.has(member.id)) map.set(member.id, { key: member.id, label: member.name, items: [] });
      });
    }
    const arr = Array.from(map.values());
    if (grouping === 'priority') arr.sort((a, b) => a.key.localeCompare(b.key));
    return orderGroups(arr, groupOrder);
  }, [items, grouping, groupOrder, team, PROJECTS, showEmptyAssignees]);

  const [reachable, setReachable] = useStateW(null);
  const dragRef = React.useRef(null);

  // On a state- or column-lane board, dim lanes a Jira item's workflow can't reach.
  const onDragStart = (id) => {
    setDragId(id);
    dragRef.current = id;
    // Column mode: only board columns are drop targets, so 'Other' is dimmed from the start.
    setReachable(laneMode === 'jira-columns' && boardColumns ? new Set(boardColumns.map(c => c.name)) : null);
    if ((laneMode === 'state' || laneMode === 'jira-columns') && isJiraId(id) && workItemSource?.availableTargetStates) {
      const current = items.find(w => w.id === id)?.state;
      workItemSource.availableTargetStates(id)
        .then(states => {
          if (!states || dragRef.current !== id) return;
          if (laneMode === 'jira-columns') {
            const ok = new Set([...states, current].map(s => String(s || '').toLowerCase()));
            setReachable(new Set(boardColumns.filter(c => c.statuses.some(s => ok.has(s.toLowerCase()))).map(c => c.name)));
          } else {
            setReachable(new Set([...states, current]));
          }
        })
        .catch(() => {});
    }
  };
  const endDrag = () => { setDragId(null); setOverKey(null); setReachable(null); dragRef.current = null; };
  const onDragEnd = endDrag;
  const onLaneOver  = (key) => setOverKey(key);

  const moveToCategory = async (id, category) => {
    const item = items.find(w => w.id === id);
    if (!item || itemCategory(item) === category) return;
    if (!workItemSource?.moveToCategory) { toast?.('✗ Moving between categories is not supported here', 'error'); return; }
    try {
      const r = await workItemSource.moveToCategory(id, category, item);
      updateItem(id, { state: r.state, stateCategory: r.stateCategory });
    } catch (e) {
      toast?.('✗ ' + (e?.message || 'Move failed'), 'error');
    }
  };

  const moveToColumn = async (id, laneKey) => {
    const item = items.find(w => w.id === id);
    const column = boardColumns?.find(c => c.name === laneKey);
    if (!item || !column) return false; // "Other" isn't a drop target
    if (jiraColumnForStatus([column], item.state)) return true; // already in this column
    if (!workItemSource?.moveToStatuses) { toast?.('✗ Moving between columns is not supported here', 'error'); return false; }
    try {
      const r = await workItemSource.moveToStatuses(id, column.statuses, item);
      updateItem(id, { state: r.state, stateCategory: r.stateCategory });
      return true;
    } catch (e) {
      toast?.('✗ ' + (e?.message || 'Move failed'), 'error');
      return false;
    }
  };

  // Drop on a lane column — also updates grouping field when card crosses swimlanes
  const onLaneDrop = async (state, groupKey) => {
    if (dragId == null) return;
    const id = dragId;
    const prev = items.find(w => w.id === id);
    endDrag();
    const assigneeChange = grouping === 'assignee' && groupKey && groupKey !== '__all__';
    const assigneeId = assigneeChange ? (groupKey === 'unassigned' ? null : groupKey) : undefined;
    const member = assigneeChange ? team.find(t => t.id === assigneeId) : null;
    if (laneMode === 'category') {
      await moveToCategory(id, state);
      if (assigneeChange && prev?.assignee !== assigneeId) {
        updateItem(id, { assignee: assigneeId });
        if (!(await patchWI(id, [['/fields/System.AssignedTo', member?.name || null]]))) updateItem(id, { assignee: prev?.assignee ?? null });
      }
      return;
    }
    if (laneMode === 'jira-columns') {
      const moved = await moveToColumn(id, state);
      if (moved && assigneeChange && prev?.assignee !== assigneeId) {
        updateItem(id, { assignee: assigneeId });
        if (!(await patchWI(id, [['/fields/System.AssignedTo', member?.name || null]]))) updateItem(id, { assignee: prev?.assignee ?? null });
      }
      return;
    }
    const patches = [['/fields/System.State', state]];
    const updates = { state };
    if (assigneeChange) {
      patches.push(['/fields/System.AssignedTo', member?.name || null]);
      updates.assignee = assigneeId;
    }
    updateItem(id, updates);
    if (!(await patchWI(id, patches)) && prev) updateItem(id, { state: prev.state, assignee: prev.assignee });
  };

  // Drop on the context bar — state target
  const onDropState = async (state) => {
    if (dragId == null) return;
    const id = dragId;
    const prev = items.find(w => w.id === id);
    endDrag();
    if (laneMode === 'category') { await moveToCategory(id, state); return; }
    if (laneMode === 'jira-columns') { await moveToColumn(id, state); return; }
    moveState(id, state);
    if (!(await patchWI(id, [['/fields/System.State', state]])) && prev) updateItem(id, { state: prev.state });
  };

  // Drop on the context bar — assignee target
  const onDropAssignee = async (assigneeId) => {
    if (dragId == null) return;
    const member = team.find(t => t.id === assigneeId);
    updateItem(dragId, { assignee: assigneeId || null });
    await patchWI(dragId, [['/fields/System.AssignedTo', member?.name || null]]);
    endDrag();
  };

  const toggleCollapsed = (key) => setCollapsed(c => ({ ...c, [key]: !c[key] }));
  const toggleLane = (key) => setCollapsedLanes(c => ({ ...c, [key]: !c[key] }));
  const toggleWide = (key) => setWidenedLanes(c => ({ ...c, [key]: !c[key] }));

  const onAssignCard = async (id, assigneeId) => {
    const member = team.find(t => t.id === assigneeId);
    updateItem(id, { assignee: assigneeId || null });
    await patchWI(id, [['/fields/System.AssignedTo', member?.name || null]]);
  };

  const onTagsCard = async (id, newTags) => {
    updateItem(id, { tags: newTags });
    await patchWI(id, [['/fields/System.Tags', newTags.join('; ')]]);
  };

  const laneProps = { dragId, overKey, onDragStart, onDragEnd, onLaneOver, onLaneDrop, onOpen, lanes, team, onAssign: onAssignCard, onTagsChange: onTagsCard, grouping, projects: PROJECTS, newItemIds, laneMode, reachable, boardColumns, collapsedLanes, onToggleLane: toggleLane, widenedLanes, onToggleWide: toggleWide };

  const boardContent = grouping === 'none' ? (
    <BoardLanes items={items} groupKey="__all__" {...laneProps} />
  ) : (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className="btn sm ghost" onClick={() => {
          const next = {};
          groups.forEach(g => { next[g.key] = true; });
          setCollapsed(next);
        }}><Icon name="chevron-right" size={12}/> Collapse all</button>
        <button className="btn sm ghost" onClick={() => { setCollapsed({}); setCollapsedLanes({}); }}>
          <Icon name="chevron-down" size={12}/> Expand all
        </button>
      </div>
      {groups.map((group, idx) => {
        const isCollapsed = !!collapsed[group.key];
        const totalPts = group.items.reduce((s, w) => s + (w.points || 0), 0);
        return (
          <div key={group.key} style={{ marginBottom: idx < groups.length - 1 ? 4 : 0 }}>
            <div
              onClick={() => toggleCollapsed(group.key)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 6px', cursor: 'pointer', userSelect: 'none', borderRadius: 8, transition: 'background .1s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={13} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
              {grouping === 'assignee' && group.key !== 'unassigned' && <Avatar who={group.key} size="xs"/>}
              {grouping === 'priority' && <Prio p={parseInt(group.key.replace('p', ''), 10)}/>}
              {grouping === 'project' && (() => {
                const proj = PROJECTS.find(p => p.id === group.key);
                return proj ? <span style={{ width: 8, height: 8, borderRadius: '50%', background: proj.color, flexShrink: 0 }}/> : null;
              })()}
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{group.label}</span>
              <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-subtle)', background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '1px 7px', borderRadius: 4 }}>
                {group.items.length}
              </span>
              {totalPts > 0 && <span style={{ fontSize: 11, color: 'var(--text-subtle)', fontFamily: 'var(--mono)' }}>{totalPts} pts</span>}
            </div>
            {!isCollapsed && (
              <div style={{ paddingBottom: 16 }}>
                <BoardLanes items={group.items} groupKey={group.key} {...laneProps} />
              </div>
            )}
            {idx < groups.length - 1 && <div style={{ height: 1, background: 'var(--border)', marginBottom: 4 }}/>}
          </div>
        );
      })}
    </div>
  );

  return (
    <React.Fragment>
      {boardContent}
      <DragContextBar
        visible={dragId != null}
        team={team}
        lanes={laneMode === 'jira-columns' ? lanes.filter(l => l !== '__other__') : lanes}
        laneLabel={laneMode === 'category' ? (s => CATEGORY_LABELS[s]) : undefined}
        onDropState={onDropState}
        onDropAssignee={onDropAssignee}
      />
    </React.Fragment>
  );
}
