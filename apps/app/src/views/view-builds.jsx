import React from 'react';
import { Icon } from '../icons.jsx';
import { adoGet, adoPost, adoPatch, getAdoConfig } from '../ado-client.js';
import { toast } from '../toast.jsx';
import { refreshNow } from '../refresh.js';
import { HelmData } from '../data.jsx';
import { ColHead } from '@nexusmd/ui';
import { useSourceFilter, SourceSwitch } from '../source-switch.jsx';
import { NotificationBanner, Sheet } from '../components.jsx';
import { BuildArtifactsSheet } from './build-artifacts-sheet.jsx';
// view-builds.jsx — Build pipelines status view

// Grid template shared between header and every build row
// The columns the user can hide (the status dot and the actions always stay), with their widths.
const COLS = [['build', 'Build', '100px'], ['actor', 'Triggered by', 'minmax(120px,1fr)'], ['branch', 'Branch', '160px'],
  ['commit', 'Commit', '72px'], ['reason', 'Reason', '130px'], ['duration', 'Duration', '72px'], ['date', 'Date', '148px']];
const orderedCols = (saved) => {
  const known = COLS.map(c => c[0]);
  const first = (Array.isArray(saved) ? saved : []).filter((id, i, a) => known.includes(id) && a.indexOf(id) === i);
  return [...first, ...known.filter(id => !first.includes(id))];
};
// With the stretchy "Triggered by" column hidden, the actions column takes the spare width instead, so the rows
// still fill the table.
const gridFor = (hidden, order) => ['28px', ...order.filter(id => !hidden.includes(id)).map(id => COLS.find(c => c[0] === id)[2]),
  hidden.includes('actor') ? 'minmax(140px, 1fr)' : '140px'].join(' ');
// The narrowest the table can be with these columns: the card's fixed minimum width used to ignore hidden columns.
const minWidthFor = (hidden, order) => {
  const w = order.filter(id => !hidden.includes(id)).map(id => parseInt(String(COLS.find(c => c[0] === id)[2]).replace(/^minmax\((\d+)px.*$/, '$1'), 10));
  const cells = w.length + 2;
  return 28 + 140 + w.reduce((a, b) => a + b, 0) + (cells - 1) * 8 + 28;
};

// On a phone the table's ~770px of fixed columns cannot fit, so each build becomes a small card: status, number and
// date on the first line, who/what next, then the actions wrapping underneath.
const PHONE_QUERY = '(max-width:600px)';
const PHONE_ROW = { display:'flex', flexWrap:'wrap', alignItems:'center', gap:'4px 10px', padding:'10px 14px' };
function usePhone() {
  const [phone, setPhone] = React.useState(() => !!window.matchMedia?.(PHONE_QUERY).matches);
  React.useEffect(() => {
    const mq = window.matchMedia?.(PHONE_QUERY);
    if (!mq) return;
    const on = e => setPhone(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

// The build statuses the Status menu can pick between.
const STATUS_OPTS = [['success', 'Passed', 'var(--success)'], ['failed', 'Failed', 'var(--danger)'], ['acknowledged', 'Acknowledged', 'var(--warning)'],
  ['partial', 'Partial', 'var(--warning)'], ['running', 'Running', 'var(--info)'], ['cancelled', 'Cancelled', 'var(--text-muted)']];

// A button with a menu under it. The menu is fixed to the window, so the table's scroll box cannot clip it, and it
// closes on an outside tap, Escape, or scrolling the page.
function DropMenu({ label, icon, active, badge, align = 'left', children }) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState(null);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!e || !ref.current || !ref.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); document.removeEventListener('keydown', key); };
  }, [open]);
  const toggle = () => {
    if (!open) {
      const r = ref.current.getBoundingClientRect();
      const width = Math.min(300, window.innerWidth - 16);
      const left = Math.max(8, Math.min(align === 'right' ? r.right - width : r.left, window.innerWidth - width - 8));
      setPos({ left, top: r.bottom + 4, width, maxHeight: Math.max(160, window.innerHeight - r.bottom - 16) });
    }
    setOpen(o => !o);
  };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="btn sm ghost" aria-haspopup="true" aria-expanded={open} onClick={toggle} style={active ? { color: 'var(--accent)' } : undefined}>
        {icon && <Icon name={icon} size={12}/>} {label}
        {badge != null && <span style={{ marginLeft: 4, fontSize: 10.5, fontWeight: 600 }}>{badge}</span>}
        <Icon name="arrow-right" size={10} style={{ transform: 'rotate(90deg)', opacity: 0.5, marginLeft: 2 }}/>
      </button>
      {open && pos && (
        <div role="menu" style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight, overflowY: 'auto', zIndex: 300,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-pop)', padding: '6px 0' }}>
          {children}
        </div>
      )}
    </div>
  );
}

function BuildsView({ builds: allBuilds, acknowledgedBuilds, setAcknowledgedBuilds, newItemIds = new Set() }) {
  const src = useSourceFilter('builds', allBuilds);
  const builds = src.filtered;
  const [initialNewCount] = React.useState(() => newItemIds.size);
  const [bannerDismissed, setBannerDismissed] = React.useState(false);
  const [collapsed,        setCollapsed]        = usePersisted('helm.builds.collapsed', {});
  const [statuses,         setStatuses]         = usePersisted('helm.builds.statuses', []);
  const [sortDir,          setSortDir]          = usePersisted('helm.builds.sortDir', 'desc');
  const [hiddenCols,      setHiddenCols]      = usePersisted('helm.builds.hiddenCols', []);
  const [colOrderSaved, setColOrder] = usePersisted('helm.builds.colOrder', []);
  const colOrder = orderedCols(colOrderSaved);
  const BUILD_GRID = gridFor(hiddenCols, colOrder);
  const moveCol = (id, dir) => {
    const i = colOrder.indexOf(id), j = i + dir;
    if (j < 0 || j >= colOrder.length) return;
    const n = [...colOrder]; [n[i], n[j]] = [n[j], n[i]]; setColOrder(n);
  };
  const col = (id) => !hiddenCols.includes(id);
  // A cell takes its place from the saved column order (the phone card lays out by its own rules).
  const colPos = (id) => 1 + colOrder.filter(x => !hiddenCols.includes(x)).indexOf(id);
  const W = ({ id, children }) => (phone ? children : <div style={{ order: colPos(id), minWidth: 0 }}>{children}</div>);
  const [hiddenPipelines,  setHiddenPipelines]  = usePersisted('helm.builds.hiddenPipelines', [], { sync: true });
  const [deployStatus,     setDeployStatus]     = React.useState(null);
  const [actioning,        setActioning]        = React.useState(new Set());
  const [artifactBuild,    setArtifactBuild]    = React.useState(null);
  const [detailBuild,      setDetailBuild]      = React.useState(null);
  const phone = usePhone();

  const acknowledgedSet = React.useMemo(() => new Set(acknowledgedBuilds || []), [acknowledgedBuilds]);
  const toggleAck = (id) => setAcknowledgedBuilds(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );
  const dispStatus = (b) => (b.status === 'failed' && acknowledgedSet.has(b.id)) ? 'acknowledged' : b.status;
  const deployToUat = async () => {
    if (!confirm('Trigger a UAT deployment? This will queue the configured UAT pipeline in Azure DevOps.')) return;
    setDeployStatus('deploying');
    try {
      const { uatProject, uatPipelineId, uatBranch } = getAdoConfig();
      if (!uatProject || !uatPipelineId) throw new Error('UAT project or pipeline ID not configured in Settings.');
      const proj = encodeURIComponent(uatProject);
      await adoPost(`${proj}/_apis/build/builds?api-version=7.0`, {
        definition: { id: uatPipelineId },
        sourceBranch: uatBranch || 'refs/heads/uat',
        reason: 'Deploy to UAT — triggered from Helm dashboard',
      });
      setDeployStatus('ok');
      setTimeout(() => setDeployStatus(null), 4000);
    } catch (err) {
      setDeployStatus('err');
      alert('Deploy failed: ' + err.message);
      setTimeout(() => setDeployStatus(null), 4000);
    }
  };

  const setActioning_ = (id, on) => setActioning(prev => {
    const n = new Set(prev); on ? n.add(id) : n.delete(id); return n;
  });

  const cancelBuild = async (b) => {
    if (!confirm(`Cancel build #${b.id} (${b.pipeline})?`)) return;
    setActioning_(b.id, true);
    try {
      const proj = encodeURIComponent(b.project || (HelmData.CONFIG_PROJECTS || [])[0] || '');
      await adoPatch(`${proj}/_apis/build/builds/${b.id}?api-version=7.0`, { status: 'cancelling' });
      toast?.(`Build #${b.id} cancelled`, 'success');
    } catch (e) {
      toast?.('Cancel failed: ' + e.message, 'error');
    } finally { setActioning_(b.id, false); }
  };

  const rerunBuild = async (b) => {
    setActioning_(b.id, true);
    try {
      const proj = encodeURIComponent(b.project || (HelmData.CONFIG_PROJECTS || [])[0] || '');
      await adoPost(`${proj}/_apis/build/builds?api-version=7.0`, {
        definition: { id: b.definitionId },
        sourceBranch: b.branch.startsWith('refs/') ? b.branch : `refs/heads/${b.branch}`,
        reason: `Manual re-run of build #${b.id} from Helm dashboard`,
      });
      toast?.(`Build queued for ${b.pipeline}`, 'success');
    } catch (e) {
      toast?.('Rerun failed: ' + e.message, 'error');
    } finally { setActioning_(b.id, false); }
  };

  // ── Summary counts ──────────────────────────────────────────
  const passing      = builds.filter(b => b.status === 'success').length;
  const failing      = builds.filter(b => b.status === 'failed' && !acknowledgedSet.has(b.id)).length;
  const acknowledged = builds.filter(b => b.status === 'failed' && acknowledgedSet.has(b.id)).length;
  const running      = builds.filter(b => b.status === 'running').length;
  const cancelled    = builds.filter(b => b.status === 'cancelled').length;

  const resultCounts = {
    all:          builds.length,
    success:      passing,
    failed:       failing,
    acknowledged: acknowledged,
    partial:      builds.filter(b => b.status === 'partial').length,
    running:      running,
    cancelled:    cancelled,
  };

  // ── All unique pipeline names ───────────────────────────────
  const allPipelines = React.useMemo(() => {
    const seen = new Set();
    builds.forEach(b => seen.add(b.pipeline || 'Pipeline'));
    return Array.from(seen).sort();
  }, [builds]);

  const hiddenSet = React.useMemo(() => new Set(hiddenPipelines), [hiddenPipelines]);

  const togglePipeline = name =>
    setHiddenPipelines(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  const showAllPipelines  = () => setHiddenPipelines([]);
  const hideAllPipelines  = () => setHiddenPipelines([...allPipelines]);
  const visibleCount = allPipelines.length - hiddenPipelines.length;

  // ── Filter + sort ───────────────────────────────────────────
  const filteredBuilds = React.useMemo(() => {
    const kindOf = (b) => (b.status === 'failed' ? (acknowledgedSet.has(b.id) ? 'acknowledged' : 'failed') : b.status);
    let list = statuses.length ? builds.filter(b => statuses.includes(kindOf(b))) : builds;
    list = list.filter(b => !hiddenSet.has(b.pipeline || 'Pipeline'));
    return [...list].sort((a, b) => {
      const da = a.finishTime ? new Date(a.finishTime).getTime() : 0;
      const db = b.finishTime ? new Date(b.finishTime).getTime() : 0;
      return sortDir === 'desc' ? db - da : da - db;
    });
  }, [builds, statuses, hiddenSet, sortDir, acknowledgedSet]);

  // ── Group by pipeline ───────────────────────────────────────
  const grouped = React.useMemo(() => {
    const map = new Map();
    filteredBuilds.forEach(b => {
      const k = b.pipeline || 'Pipeline';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(b);
    });
    return Array.from(map.entries()).map(([name, runs]) => ({ name, runs }));
  }, [filteredBuilds]);

  // Full history for sparklines (unfiltered)
  const pipelineHistory = React.useMemo(() => {
    const map = new Map();
    builds.forEach(b => {
      const k = b.pipeline || 'Pipeline';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(dispStatus(b));
    });
    return map;
  }, [builds, acknowledgedSet]);

  const dotClass   = { success: 'success', failed: 'failed', partial: 'partial', running: 'running', acknowledged: 'partial', cancelled: 'cancelled' };
  const sparkColor = { success: 'var(--success)', failed: 'var(--danger)', partial: 'var(--warning)', running: 'var(--info)', acknowledged: 'var(--warning)', cancelled: 'var(--text-muted)' };
  const reasonLabel = { manual: 'Manual', batchedCI: 'CI', individualCI: 'CI', schedule: 'Scheduled', pullRequest: 'PR', buildCompletion: 'Trigger' };

  return (
    <React.Fragment>
      <div className="m-appbar wrap">
        <div className="m-ab-lead">
          <h1>Builds</h1>
          <div className="m-ab-sub">{passing} passing · {failing} failing{acknowledged > 0 ? ` · ${acknowledged} acknowledged` : ''} · {running} running{cancelled > 0 ? ` · ${cancelled} cancelled` : ''}</div>
        </div>
        <div className="m-ab-actions">
          <button type="button" className="btn sm" disabled={deployStatus === 'deploying'} onClick={deployToUat}
            style={deployStatus === 'ok' ? { borderColor:'var(--success)', color:'var(--success)' }
                 : deployStatus === 'err' ? { borderColor:'var(--danger)', color:'var(--danger)' } : {}}>
            <Icon name={deployStatus === 'ok' ? 'check' : deployStatus === 'err' ? 'x' : 'send'} size={13}/>
            {deployStatus === 'deploying' ? ' Deploying…' : deployStatus === 'ok' ? ' Queued!' : deployStatus === 'err' ? ' Failed' : ' Deploy to UAT'}
          </button>
          <button type="button" className="btn sm ghost" onClick={refreshNow}><Icon name="refresh" size={13}/> Refresh</button>
        </div>
      </div>

      <div className="m-screen">
        <SourceSwitch {...src}/>
      {initialNewCount > 0 && !bannerDismissed && (
        <NotificationBanner
          label={`${initialNewCount} new build result${initialNewCount !== 1 ? 's' : ''} since your last visit`}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}

      {/* ── Stats ── */}
      <div className="stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <Stat label="Passing"      value={passing} meta="Last 24h"                 trend={{ dir:'up',   value:'+3'   }} accent="var(--success)" spark={[3,4,5,4,5,6,6,5,5,passing]} sparkColor="var(--success)"/>
        <Stat label="Failing"      value={failing} meta={acknowledged > 0 ? `${acknowledged} acknowledged` : "All clear"} trend={{ dir:'flat', value:'·'   }} accent={failing ? 'var(--danger)' : null} spark={[1,1,0,1,1,2,1,1,1,failing]} sparkColor="var(--danger)"/>
        <Stat label="Avg duration" value="5m 42s"  meta="vs 6m 11s last week"      trend={{ dir:'down', value:'-5%' }} spark={[6.5,6.4,6.2,6.0,5.9,5.8,5.7,5.6,5.7,5.7]} sparkColor="var(--info)"/>
      </div>

      {/* ── Builds table card ── */}
      <div style={{ overflowX:'auto' }}>
      <div className="card m-bld-card" style={{ minWidth: phone ? Math.min(880, minWidthFor(hiddenCols, colOrder)) : minWidthFor(hiddenCols, colOrder) }}>
        <div className="card-head" style={{ flexWrap:'wrap', gap:6 }}>
          {/* Status filter */}
          <DropMenu label={statuses.length === 0 ? 'All statuses' : statuses.length === 1 ? STATUS_OPTS.find(o => o[0] === statuses[0])[1] : `${statuses.length} statuses`}
            icon="filter" active={statuses.length > 0} badge={resultCounts.all}>
            <label style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 12px', cursor:'pointer', userSelect:'none' }}>
              <input type="checkbox" checked={statuses.length === 0} style={{ accentColor:'var(--accent)' }} onChange={() => setStatuses([])}/>
              <span style={{ flex:1, fontSize:12.5, fontWeight:600 }}>All</span>
              <span className="muted" style={{ fontSize:11.5 }}>{resultCounts.all}</span>
            </label>
            {STATUS_OPTS.map(([id, text, color]) => (
              <label key={id} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 12px', cursor:'pointer', userSelect:'none' }}>
                <input type="checkbox" checked={statuses.includes(id)} style={{ accentColor:'var(--accent)' }}
                  onChange={() => setStatuses(st => (st.includes(id) ? st.filter(x => x !== id) : [...st, id]))}/>
                <span style={{ width:6, height:6, borderRadius:'50%', background:color }}/>
                <span style={{ flex:1, fontSize:12.5 }}>{text}</span>
                <span className="muted" style={{ fontSize:11.5 }}>{resultCounts[id] ?? 0}</span>
              </label>
            ))}
          </DropMenu>

          {/* Pipeline visibility */}
          <DropMenu label="Pipelines" icon="filter" active={hiddenPipelines.length > 0} badge={`${visibleCount}/${allPipelines.length}`}>
                {/* Select all / none */}
                <div style={{
                  display:'flex', gap:6, padding:'4px 12px 8px',
                  borderBottom:'1px solid var(--border)', marginBottom:4,
                }}>
                  <button className="btn sm ghost" style={{ flex:1, fontSize:11 }} onClick={showAllPipelines}>Show all</button>
                  <button className="btn sm ghost" style={{ flex:1, fontSize:11 }} onClick={hideAllPipelines}>Hide all</button>
                </div>
                {allPipelines.map(name => {
                  const visible = !hiddenSet.has(name);
                  const hist = (pipelineHistory.get(name) || []).slice(0, 5);
                  return (
                    <label key={name} style={{
                      display:'flex', alignItems:'center', gap:8,
                      padding:'6px 12px', cursor:'pointer', userSelect:'none',
                      opacity: visible ? 1 : 0.45,
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <input type="checkbox" checked={visible} onChange={() => togglePipeline(name)}
                        style={{ cursor:'pointer', accentColor:'var(--accent)', flexShrink:0 }}/>
                      <span style={{ flex:1, fontSize:12.5, fontWeight:500, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {name}
                      </span>
                      {/* Mini sparkline */}
                      <div style={{ display:'flex', gap:2, flexShrink:0 }}>
                        {hist.map((s, i) => (
                          <span key={i} style={{
                            width:6, height:6, borderRadius:2, flexShrink:0,
                            background: sparkColor[s] || 'var(--text-subtle)', opacity:0.8,
                          }}/>
                        ))}
                      </div>
                    </label>
                  );
                })}
          </DropMenu>

          {/* Columns */}
          <DropMenu label="Columns" icon="filter" active={hiddenCols.length > 0} badge={`${COLS.length - hiddenCols.filter(h => COLS.some(c => c[0] === h)).length}/${COLS.length}`} align="right">
            {colOrder.map((id, i) => (
              <div key={id} style={{ display:'flex', alignItems:'center', gap:4, padding:'2px 8px 2px 12px' }}>
                <label style={{ display:'flex', alignItems:'center', gap:8, flex:1, padding:'4px 0', cursor:'pointer', userSelect:'none' }}>
                  <input type="checkbox" checked={col(id)} style={{ accentColor:'var(--accent)' }}
                    onChange={() => setHiddenCols(h => h.includes(id) ? h.filter(x => x !== id) : [...h, id])}/>
                  <span style={{ fontSize:12.5 }}>{COLS.find(c => c[0] === id)[1]}</span>
                </label>
                <button type="button" className="btn sm ghost" aria-label={`Move ${COLS.find(c => c[0] === id)[1]} left`} disabled={i === 0} onClick={() => moveCol(id, -1)}><Icon name="arrow-up" size={12}/></button>
                <button type="button" className="btn sm ghost" aria-label={`Move ${COLS.find(c => c[0] === id)[1]} right`} disabled={i === colOrder.length - 1} onClick={() => moveCol(id, 1)}><Icon name="arrow-down" size={12}/></button>
              </div>
            ))}
          </DropMenu>

          <div style={{ width:1, height:16, background:'var(--border)', margin:'0 2px' }}/>
          {(() => {
            const allCollapsed = grouped.length > 0 && grouped.every(g => collapsed[g.name]);
            return (
              <button className="btn sm ghost" onClick={() => {
                if (allCollapsed) { setCollapsed({}); return; }
                const n = {}; grouped.forEach(g => { n[g.name] = true; }); setCollapsed(n);
              }}><Icon name={allCollapsed ? 'chevron-down' : 'chevron-right'} size={12}/> {allCollapsed ? 'Expand all' : 'Collapse all'}</button>
            );
          })()}
        </div>

        {/* ── Column headers ── */}
        <div style={{
          display: phone ? 'none' : 'grid', gridTemplateColumns: BUILD_GRID,
          padding:'0 14px', gap:8,
          borderBottom:'2px solid var(--border)',
          background:'var(--surface-2)',
          position:'sticky', top:0, zIndex:10,
        }}>
          {/* Status */}
          <div style={{ order: 0 }}/>
          {/* Build # */}
          {col('build') && <W id="build"><ColHead>Build</ColHead></W>}
          {/* Triggered by */}
          {col('actor') && <W id="actor"><ColHead>Triggered by</ColHead></W>}
          {/* Branch */}
          {col('branch') && <W id="branch"><ColHead><Icon name="git-branch" size={11} style={{ marginRight:3, opacity:0.7 }}/>Branch</ColHead></W>}
          {/* Commit */}
          {col('commit') && <W id="commit"><ColHead>Commit</ColHead></W>}
          {/* Reason */}
          {col('reason') && <W id="reason"><ColHead>Reason</ColHead></W>}
          {/* Duration */}
          {col('duration') && <W id="duration"><ColHead>Duration</ColHead></W>}
          {/* Date — sortable */}
          {col('date') && <W id="date"><ColHead
            sortable
            sortDir={sortDir}
            onSort={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
          >Date</ColHead></W>}
          {/* Actions */}
          <div style={{ order: 99 }}/>
        </div>

        {/* ── Pipeline groups ── */}
        <div className="card-body flush">
          {grouped.map(g => {
            const history = (pipelineHistory.get(g.name) || []).slice(0, 10);
            return (
              <React.Fragment key={g.name}>
                {/* Group header */}
                <div
                  style={{
                    padding:'7px 14px', background:'var(--surface-2)',
                    borderBottom:'1px solid var(--border)',
                    display:'flex', alignItems:'center', gap:8, cursor:'pointer',
                  }}
                  onClick={() => setCollapsed(c => ({ ...c, [g.name]: !c[g.name] }))}>
                  <Icon name={collapsed[g.name] ? 'chevron-right' : 'chevron-down'} size={11}/>
                  <span style={{ fontSize:12, fontWeight:600, color:'var(--text)' }}>{g.name}</span>
                  <span className="muted mono" style={{ fontSize:10.5 }}>{g.runs.length} run{g.runs.length !== 1 ? 's' : ''}</span>
                  {/* Sparkline */}
                  <div style={{ display:'flex', gap:3, marginLeft:4 }} title="Last 10 build results (newest first)">
                    {history.map((status, i) => (
                      <span key={i} style={{
                        width:8, height:8, borderRadius:2, flexShrink:0,
                        background: sparkColor[status] || 'var(--text-subtle)', opacity:0.85,
                      }}/>
                    ))}
                  </div>
                </div>

                {/* Build rows */}
                {!collapsed[g.name] && g.runs.map(b => {
                  const isNew = newItemIds.has(b.id);
                  return (
                  <div key={`${g.name}-${b.id}`}
                    className="build-row" role="button" tabIndex={0}
                    onClick={() => setDetailBuild(b)}
                    onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) setDetailBuild(b); }}
                    style={{ ...(phone ? PHONE_ROW : { display:'grid', gridTemplateColumns: BUILD_GRID, alignItems:'center', gap:8, padding:'0 14px' }), cursor:'pointer',
                      ...(isNew ? { background: 'color-mix(in srgb, var(--accent) 7%, var(--surface))', boxShadow: 'inset 3px 0 0 var(--accent)' } : {}),
                    }}>

                    {/* Status dot */}
                    <div style={{ display:'flex', justifyContent:'center', order:0 }}>
                      <div className={`build-dot ${dotClass[dispStatus(b)]}`}/>
                    </div>

                    {/* Build # */}
{col('build') && (<W id="build">
                    <div className="mono" style={{ fontSize:12, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', display:'flex', alignItems:'center', gap:5, ...(phone ? { order:1 } : null) }}>
                      {(b.source === 'github' ? b.url : HelmData.ORG && b.project)
                        ? <a href={b.source === 'github' ? b.url : `https://dev.azure.com/${encodeURIComponent(HelmData.ORG)}/${encodeURIComponent(b.project)}/_build/results?buildId=${b.id}`}
                            target="_blank" rel="noopener" onClick={e => e.stopPropagation()}
                            style={{ color:'var(--accent)', textDecoration:'none' }}>#{b.id}</a>
                        : <span>#{b.id}</span>
                      }
                      {isNew && <span style={{ fontSize:9, fontWeight:700, background:'var(--accent)', color:'var(--accent-fg)', padding:'1px 5px', borderRadius:3, textTransform:'uppercase', letterSpacing:'0.05em', flexShrink:0 }}>New</span>}
                    </div>
</W>)}

                    {/* Triggered by / failure reason */}
{col('actor') && (<W id="actor">
                    <div style={{ minWidth:0, ...(phone ? { order:3, flex:'1 1 100%' } : null) }}>
                      {b.failureReason
                        ? <span style={{ fontSize:12.5, color: dispStatus(b) === 'acknowledged' ? 'var(--warning)' : 'var(--danger)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', display:'block' }}
                            title={b.failureReason}>{b.failureReason}</span>
                        : <span style={{ display:'flex', alignItems:'center', gap:5, overflow:'hidden' }}>
                            <Avatar who={b.actor} size="xs"/>
                            <span style={{ fontSize:12.5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{b.actor}</span>
                          </span>
                      }
                    </div>
</W>)}

                    {/* Branch */}
{col('branch') && (<W id="branch">
                    <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', ...(phone ? { order:4, maxWidth:'55%' } : null) }}>
                      <span style={{
                        display:'inline-flex', alignItems:'center', gap:4,
                        fontSize:11.5, padding:'2px 7px', borderRadius:4,
                        background:'var(--surface-2)', border:'1px solid var(--border)',
                        maxWidth:'100%', overflow:'hidden', textOverflow:'ellipsis',
                        fontFamily:'var(--mono)',
                      }} title={b.branch}>{b.branch}</span>
                    </div>
</W>)}

                    {/* Commit */}
{col('commit') && (<W id="commit">
                    <div className="mono muted" style={{ fontSize:11.5, ...(phone ? { order:4 } : null) }}>{b.commit}</div>
</W>)}

                    {/* Reason */}
{col('reason') && (<W id="reason">
                    <div style={phone ? { display:'none' } : undefined}>
                      {b.reason
                        ? <span className="pill" style={{ fontSize:10.5, textTransform:'capitalize' }}>
                            {reasonLabel[b.reason] || b.reason}
                          </span>
                        : <span className="muted" style={{ fontSize:11.5 }}>—</span>
                      }
                    </div>
</W>)}

                    {/* Duration */}
{col('duration') && (<W id="duration">
                    <div className="build-meta" style={phone ? { order:4 } : undefined}>{b.duration}</div>
</W>)}

                    {/* Date */}
{col('date') && (<W id="date">
                    <div className="build-meta" style={phone ? { order:2, marginLeft:'auto' } : undefined} title={b.finishTime ? new Date(b.finishTime).toLocaleString() : ''}>
                      {b.when}
                    </div>
</W>)}

                    {/* Actions */}
                    <div style={{ display:'flex', justifyContent: phone ? 'flex-start' : 'flex-end', gap:4, ...(phone ? { order:5, flex:'1 1 100%', flexWrap:'wrap', paddingTop:2 } : { order:99 }) }}>
                      {/* Cancel — running builds only */}
                      {b.status === 'running' && b.source !== 'github' && (
                        <button className="btn sm ghost" title="Cancel this build"
                          style={{ color:'var(--danger)' }}
                          disabled={actioning.has(b.id)}
                          onClick={e => { e.stopPropagation(); cancelBuild(b); }}>
                          <Icon name="x" size={12}/> {actioning.has(b.id) ? '…' : 'Cancel'}
                        </button>
                      )}
                      {/* Rerun — completed builds */}
                      {b.status !== 'running' && b.definitionId > 0 && b.source !== 'github' && (
                        <button className="btn sm ghost" title="Re-run this pipeline"
                          disabled={actioning.has(b.id)}
                          onClick={e => { e.stopPropagation(); rerunBuild(b); }}>
                          <Icon name="refresh" size={12}/> {actioning.has(b.id) ? '…' : 'Rerun'}
                        </button>
                      )}
                      {/* Ack / Unack — failed builds */}
                      {b.status === 'failed' && (
                        acknowledgedSet.has(b.id)
                          ? <button className="btn sm ghost" title="Remove acknowledgement"
                              style={{ color:'var(--warning)', borderColor:'var(--warning)' }}
                              onClick={e => { e.stopPropagation(); toggleAck(b.id); }}>
                              <Icon name="x" size={12}/> Unack
                            </button>
                          : <button className="btn sm ghost" title="Acknowledge this failure"
                              onClick={e => { e.stopPropagation(); toggleAck(b.id); }}>
                              <Icon name="check" size={12}/> Ack
                            </button>
                      )}
                      {/* Bug — failed and cancelled only */}
                      {(b.status === 'failed' || b.status === 'cancelled') && (
                        <button className="btn sm ghost" onClick={e => {
                          e.stopPropagation();
                          window.dispatchEvent(new CustomEvent('helm:create-wi', {
                            detail: {
                              type: 'Bug',
                              title: `Build ${b.status}: ${b.pipeline}`,
                              description: `Build #${b.id}\nBranch: ${b.branch}\nReason: ${b.failureReason || b.status}`,
                              project: (HelmData.CONFIG_PROJECTS || [])[0] || '',
                              tags: 'build;ci',
                            }
                          }));
                        }}><Icon name="plus" size={12}/> Bug</button>
                      )}
                    </div>

                  </div>
                  );
                })}
              </React.Fragment>
            );
          })}
          {grouped.length === 0 && (
            <div className="empty">No builds match the selected filter.</div>
          )}
        </div>
      </div>
      </div>
      </div>
      <Sheet open={!!detailBuild} icon="build" title={detailBuild ? `${detailBuild.pipeline || 'Pipeline'} #${detailBuild.id}` : ''} sub={detailBuild ? dispStatus(detailBuild) : ''}
        onClose={() => setDetailBuild(null)}>
        {detailBuild && (() => {
          const b = detailBuild;
          const webUrl = b.source === 'github' ? b.url : (HelmData.ORG && b.project ? `https://dev.azure.com/${encodeURIComponent(HelmData.ORG)}/${encodeURIComponent(b.project)}/_build/results?buildId=${b.id}` : '');
          const facts = [
            ['Status', dispStatus(b)], ['Branch', b.branch], ['Commit', b.commit], ['Triggered by', b.actor],
            ['Reason', reasonLabel[b.reason] || b.reason], ['Duration', b.duration], ['Finished', b.finishTime ? new Date(b.finishTime).toLocaleString() : b.when],
          ].filter(([, v]) => v);
          return (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {b.failureReason && <div className="m-error">{b.failureReason}</div>}
              <div>
                {facts.map(([k, v]) => (
                  <div key={k} className="set-row" style={{ padding:'6px 0' }}>
                    <div className="info"><div className="d">{k}</div></div>
                    <div className="mono" style={{ fontSize:12.5, textAlign:'right', overflowWrap:'anywhere' }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {webUrl && (
                  <a className="btn m-btn-lg" href={webUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration:'none' }}>
                    <Icon name="link" size={14}/> {b.source === 'github' ? 'Open in GitHub' : 'Open in Azure DevOps'}
                  </a>
                )}
                {b.status !== 'running' && (
                  <button type="button" className="btn m-btn-lg" onClick={() => { setArtifactBuild(b); setDetailBuild(null); }}>
                    <Icon name="download" size={14}/> Artifacts
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      </Sheet>

      <BuildArtifactsSheet build={artifactBuild} onClose={() => setArtifactBuild(null)}/>
    </React.Fragment>
  );
}

export { BuildsView };


