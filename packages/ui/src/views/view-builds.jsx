import React from 'react'
// view-builds.jsx — Build pipelines status view. Shared across web + desktop.
// Build list arrives via props; org/project context + queue/cancel actions use
// useNexusData(). The /api/builds/* action endpoints are served by the web host;
// on desktop they degrade gracefully (the buttons surface an error toast).
import { FilterChip, Stat } from '../components.jsx'
import { Avatar, NotificationBanner, ProjectChip, usePersisted } from '../app-components.jsx'
import { Icon } from '../icons.jsx'
import { toast } from '../toast.jsx'
import { useNexusData } from '../data-context.jsx'
import { formatDateTime, resolveFields, BUILDS_TABLE_COLUMNS } from '@nexusmd/core'

export function BuildsView({ builds, acknowledgedBuilds, setAcknowledgedBuilds, newItemIds = new Set(), onOpenBuild }) {
  const { data: NexusMDData } = useNexusData()
  const [buildsCfg] = usePersisted('nexusmd.fields.buildsTable', [])
  const visibleBuildCols = resolveFields(BUILDS_TABLE_COLUMNS, buildsCfg).filter(f => f.visible)
  const buildGrid = visibleBuildCols.map(c => c.width).join(' ')
  const [initialNewCount] = React.useState(() => newItemIds.size)
  const [bannerDismissed, setBannerDismissed] = React.useState(false)
  const [collapsed,        setCollapsed]        = React.useState({})
  const [resultFilter,     setResultFilter]     = usePersisted('nexusmd.builds.resultFilter', 'all')
  const [sortDir,          setSortDir]          = usePersisted('nexusmd.builds.sortDir', 'desc')
  const [hiddenPipelines,  setHiddenPipelines]  = usePersisted('nexusmd.builds.hiddenPipelines', [], { sync: true })
  const [pipelineMenuOpen, setPipelineMenuOpen] = React.useState(false)
  const [deployStatus,     setDeployStatus]     = React.useState(null)
  const [actioning,        setActioning]        = React.useState(new Set())

  const acknowledgedSet = React.useMemo(() => new Set(acknowledgedBuilds || []), [acknowledgedBuilds])
  const toggleAck = (id) => setAcknowledgedBuilds(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  )
  const dispStatus = (b) => (b.status === 'failed' && acknowledgedSet.has(b.id)) ? 'acknowledged' : b.status
  const pipelineMenuRef = React.useRef(null)

  // Close pipeline menu on outside click
  React.useEffect(() => {
    if (!pipelineMenuOpen) return
    const onDoc = e => {
      if (pipelineMenuRef.current && !pipelineMenuRef.current.contains(e.target))
        setPipelineMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [pipelineMenuOpen])

  const deployToUat = async () => {
    if (!confirm('Trigger a UAT deployment? This will queue the configured UAT pipeline in Azure DevOps.')) return
    setDeployStatus('deploying')
    try {
      const res = await fetch('/api/builds/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Reason: 'Deploy to UAT — triggered from NexusMD dashboard' }),
      })
      if (!res.ok) { const t = await res.text(); throw new Error(t || res.statusText) }
      setDeployStatus('ok')
      setTimeout(() => setDeployStatus(null), 4000)
    } catch (err) {
      setDeployStatus('err')
      alert('Deploy failed: ' + err.message)
      setTimeout(() => setDeployStatus(null), 4000)
    }
  }

  const setActioning_ = (id, on) => setActioning(prev => {
    const n = new Set(prev); on ? n.add(id) : n.delete(id); return n
  })

  const cancelBuild = async (b) => {
    if (!confirm(`Cancel build #${b.id} (${b.pipeline})?`)) return
    setActioning_(b.id, true)
    try {
      const r = await fetch(`/api/builds/${b.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: b.project }),
      })
      if (!r.ok) throw new Error(await r.text())
      toast?.(`Build #${b.id} cancelled`, 'success')
    } catch (e) {
      toast?.('Cancel failed: ' + e.message, 'error')
    } finally { setActioning_(b.id, false) }
  }

  const rerunBuild = async (b) => {
    setActioning_(b.id, true)
    try {
      const r = await fetch('/api/builds/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project:    b.project,
          pipelineId: b.definitionId,
          branch:     b.branch.startsWith('refs/') ? b.branch : `refs/heads/${b.branch}`,
          reason:     `Manual re-run of build #${b.id} from NexusMD dashboard`,
        }),
      })
      if (!r.ok) throw new Error(await r.text())
      toast?.(`Build queued for ${b.pipeline}`, 'success')
    } catch (e) {
      toast?.('Rerun failed: ' + e.message, 'error')
    } finally { setActioning_(b.id, false) }
  }

  // ── Summary counts ──────────────────────────────────────────
  const passing      = builds.filter(b => b.status === 'success').length
  const failing      = builds.filter(b => b.status === 'failed' && !acknowledgedSet.has(b.id)).length
  const acknowledged = builds.filter(b => b.status === 'failed' && acknowledgedSet.has(b.id)).length
  const running      = builds.filter(b => b.status === 'running').length
  const cancelled    = builds.filter(b => b.status === 'cancelled').length

  const resultCounts = {
    all:          builds.length,
    success:      passing,
    failed:       failing,
    acknowledged: acknowledged,
    partial:      builds.filter(b => b.status === 'partial').length,
    running:      running,
    cancelled:    cancelled,
  }

  // ── All unique "<project>::<pipeline>" combos ───────────────
  const allPipelineKeys = React.useMemo(() => {
    const seen = new Set()
    builds.forEach(b => seen.add(`${b.project || 'Unknown'}::${b.pipeline || 'Pipeline'}`))
    return Array.from(seen).sort()
  }, [builds])

  const hiddenSet = React.useMemo(() => new Set(hiddenPipelines), [hiddenPipelines])

  const togglePipeline = key =>
    setHiddenPipelines(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    )
  const showAllPipelines  = () => setHiddenPipelines([])
  const hideAllPipelines  = () => setHiddenPipelines([...allPipelineKeys])
  const visibleCount = allPipelineKeys.length - hiddenPipelines.length

  // ── Filter + sort ───────────────────────────────────────────
  const filteredBuilds = React.useMemo(() => {
    let list
    if (resultFilter === 'all') {
      list = builds
    } else if (resultFilter === 'acknowledged') {
      list = builds.filter(b => b.status === 'failed' && acknowledgedSet.has(b.id))
    } else if (resultFilter === 'failed') {
      list = builds.filter(b => b.status === 'failed' && !acknowledgedSet.has(b.id))
    } else {
      list = builds.filter(b => b.status === resultFilter)
    }
    list = list.filter(b => !hiddenSet.has(`${b.project || 'Unknown'}::${b.pipeline || 'Pipeline'}`))
    return [...list].sort((a, b) => {
      const da = a.finishTime ? new Date(a.finishTime).getTime() : 0
      const db = b.finishTime ? new Date(b.finishTime).getTime() : 0
      return sortDir === 'desc' ? db - da : da - db
    })
  }, [builds, resultFilter, hiddenSet, sortDir, acknowledgedSet])

  // ── Group by project, then pipeline ──────────────────────────
  const grouped = React.useMemo(() => {
    const projectMap = new Map()
    filteredBuilds.forEach(b => {
      const projKey = b.project || 'Unknown'
      if (!projectMap.has(projKey)) projectMap.set(projKey, new Map())
      const pipelineMap = projectMap.get(projKey)
      const pipeKey = b.pipeline || 'Pipeline'
      if (!pipelineMap.has(pipeKey)) pipelineMap.set(pipeKey, [])
      pipelineMap.get(pipeKey).push(b)
    })
    return Array.from(projectMap.entries()).map(([project, pipelineMap]) => ({
      project,
      pipelines: Array.from(pipelineMap.entries()).map(([name, runs]) => ({ name, runs })),
      runCount: Array.from(pipelineMap.values()).reduce((n, runs) => n + runs.length, 0),
    }))
  }, [filteredBuilds])

  // Full history for the project-level sparkline (unfiltered), keyed by project.
  const projectHistory = React.useMemo(() => {
    const map = new Map()
    builds.forEach(b => {
      const k = b.project || 'Unknown'
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(dispStatus(b))
    })
    return map
  }, [builds, acknowledgedSet])

  // Full history for pipeline sparklines (unfiltered), keyed by "<project>::<pipeline>"
  // so two projects that happen to share a pipeline name don't bleed into each other.
  const pipelineHistory = React.useMemo(() => {
    const map = new Map()
    builds.forEach(b => {
      const k = `${b.project || 'Unknown'}::${b.pipeline || 'Pipeline'}`
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(dispStatus(b))
    })
    return map
  }, [builds, acknowledgedSet])

  // Project → pipeline names, for the visibility filter dropdown's sub-headings.
  const projectPipelines = React.useMemo(() => {
    const map = new Map()
    builds.forEach(b => {
      const proj = b.project || 'Unknown'
      if (!map.has(proj)) map.set(proj, new Set())
      map.get(proj).add(b.pipeline || 'Pipeline')
    })
    return Array.from(map.entries())
      .map(([project, names]) => ({ project, pipelines: Array.from(names).sort() }))
      .sort((a, b) => a.project.localeCompare(b.project))
  }, [builds])

  const dotClass   = { success: 'success', failed: 'failed', partial: 'partial', running: 'running', acknowledged: 'partial', cancelled: 'cancelled' }
  const sparkColor = { success: 'var(--success)', failed: 'var(--danger)', partial: 'var(--warning)', running: 'var(--info)', acknowledged: 'var(--warning)', cancelled: 'var(--text-muted)' }
  const reasonLabel = { manual: 'Manual', batchedCI: 'CI', individualCI: 'CI', schedule: 'Scheduled', pullRequest: 'PR', buildCompletion: 'Trigger' }

  const buildHead = (key) => {
    switch (key) {
      case 'status':      return <div key="status"/>;
      case 'build':       return <ColHead key="build">Build</ColHead>;
      case 'project':     return <ColHead key="project">Project</ColHead>;
      case 'triggeredBy': return <ColHead key="triggeredBy">Triggered by</ColHead>;
      case 'branch':      return <ColHead key="branch"><Icon name="git-branch" size={11} style={{ marginRight:3, opacity:0.7 }}/>Branch</ColHead>;
      case 'commit':      return <ColHead key="commit">Commit</ColHead>;
      case 'reason':      return <ColHead key="reason">Reason</ColHead>;
      case 'duration':    return <ColHead key="duration">Duration</ColHead>;
      case 'date':        return <ColHead key="date" sortable sortDir={sortDir} onSort={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}>Date</ColHead>;
      case 'actions':     return <div key="actions"/>;
      default:            return null;
    }
  };

  const buildCell = (key, b) => {
    switch (key) {
      case 'status':
        return (
          <div key="status" style={{ display:'flex', justifyContent:'center' }}>
            <div className={`build-dot ${dotClass[dispStatus(b)]}`}/>
          </div>
        );
      case 'build':
        return (
          <div key="build" className="mono" style={{ fontSize:12, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', display:'flex', alignItems:'center', gap:5 }}>
            {NexusMDData.ORG && b.project
              ? <a href={`https://dev.azure.com/${encodeURIComponent(NexusMDData.ORG)}/${encodeURIComponent(b.project)}/_build/results?buildId=${b.id}`}
                  target="_blank" rel="noopener" onClick={e => e.stopPropagation()}
                  style={{ color:'var(--accent)', textDecoration:'none' }}>#{b.id}</a>
              : <span>#{b.id}</span>
            }
            {newItemIds.has(b.id) && <span style={{ fontSize:9, fontWeight:700, background:'var(--accent)', color:'var(--accent-fg)', padding:'1px 5px', borderRadius:3, textTransform:'uppercase', letterSpacing:'0.05em', flexShrink:0 }}>New</span>}
          </div>
        );
      case 'project':
        return <div key="project" style={{ overflow:'hidden' }}><ProjectChip id={b.project}/></div>;
      case 'triggeredBy':
        return (
          <div key="triggeredBy" style={{ minWidth:0 }}>
            {b.failureReason
              ? <span style={{ fontSize:12.5, color: dispStatus(b) === 'acknowledged' ? 'var(--warning)' : 'var(--danger)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', display:'block' }}
                  title={b.failureReason}>{b.failureReason}</span>
              : <span style={{ display:'flex', alignItems:'center', gap:5, overflow:'hidden' }}>
                  <Avatar who={b.actor} size="xs"/>
                  <span style={{ fontSize:12.5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{b.actor}</span>
                </span>
            }
          </div>
        );
      case 'branch':
        return (
          <div key="branch" style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            <span style={{
              display:'inline-flex', alignItems:'center', gap:4,
              fontSize:11.5, padding:'2px 7px', borderRadius:4,
              background:'var(--surface-2)', border:'1px solid var(--border)',
              maxWidth:'100%', overflow:'hidden', textOverflow:'ellipsis',
              fontFamily:'var(--mono)',
            }} title={b.branch}>{b.branch}</span>
          </div>
        );
      case 'commit':      return <div key="commit" className="mono muted" style={{ fontSize:11.5 }}>{b.commit}</div>;
      case 'reason':
        return (
          <div key="reason">
            {b.reason
              ? <span className="pill" style={{ fontSize:10.5, textTransform:'capitalize' }}>
                  {reasonLabel[b.reason] || b.reason}
                </span>
              : <span className="muted" style={{ fontSize:11.5 }}>—</span>
            }
          </div>
        );
      case 'duration':    return <div key="duration" className="build-meta">{b.duration}</div>;
      case 'date':        return <div key="date" className="build-meta mono" title={b.finishTime ? new Date(b.finishTime).toLocaleString() : ''}>{formatDateTime(b.finishTime)}</div>;
      case 'actions':
        return (
          <div key="actions" style={{ display:'flex', justifyContent:'flex-end', gap:4 }}>
            {/* Cancel — running builds only */}
            {b.status === 'running' && (
              <button className="btn sm ghost" title="Cancel this build"
                style={{ color:'var(--danger)' }}
                disabled={actioning.has(b.id)}
                onClick={e => { e.stopPropagation(); cancelBuild(b) }}>
                <Icon name="x" size={12}/> {actioning.has(b.id) ? '…' : 'Cancel'}
              </button>
            )}
            {/* Rerun — completed builds */}
            {b.status !== 'running' && b.definitionId > 0 && (
              <button className="btn sm ghost" title="Re-run this pipeline"
                disabled={actioning.has(b.id)}
                onClick={e => { e.stopPropagation(); rerunBuild(b) }}>
                <Icon name="refresh" size={12}/> {actioning.has(b.id) ? '…' : 'Rerun'}
              </button>
            )}
            {/* Ack / Unack — failed builds */}
            {b.status === 'failed' && (
              acknowledgedSet.has(b.id)
                ? <button className="btn sm ghost" title="Remove acknowledgement"
                    style={{ color:'var(--warning)', borderColor:'var(--warning)' }}
                    onClick={e => { e.stopPropagation(); toggleAck(b.id) }}>
                    <Icon name="x" size={12}/> Unack
                  </button>
                : <button className="btn sm ghost" title="Acknowledge this failure"
                    onClick={e => { e.stopPropagation(); toggleAck(b.id) }}>
                    <Icon name="check" size={12}/> Ack
                  </button>
            )}
            {/* Bug — failed and cancelled only */}
            {(b.status === 'failed' || b.status === 'cancelled') && (
              <button className="btn sm ghost" onClick={e => {
                e.stopPropagation()
                window.dispatchEvent(new CustomEvent('nexusmd:create-wi', {
                  detail: {
                    type: 'Bug',
                    title: `Build ${b.status}: ${b.pipeline}`,
                    description: `Build #${b.id}\nBranch: ${b.branch}\nReason: ${b.failureReason || b.status}`,
                    project: (NexusMDData.CONFIG_PROJECTS || [])[0] || '',
                    tags: 'build;ci',
                  }
                }))
              }}><Icon name="plus" size={12}/> Bug</button>
            )}
          </div>
        );
      default:            return null;
    }
  };

  return (
    <div>
      {/* ── Page header ── */}
      <div className="page-head">
        <div>
          <h1>Builds</h1>
          <div className="sub">{passing} passing · {failing} failing{acknowledged > 0 ? ` · ${acknowledged} acknowledged` : ''} · {running} running{cancelled > 0 ? ` · ${cancelled} cancelled` : ''}</div>
        </div>
        <div className="page-head-actions">
          <button className="btn sm" disabled={deployStatus === 'deploying'} onClick={deployToUat}
            style={deployStatus === 'ok' ? { borderColor:'var(--success)', color:'var(--success)' }
                 : deployStatus === 'err' ? { borderColor:'var(--danger)', color:'var(--danger)' } : {}}>
            <Icon name={deployStatus === 'ok' ? 'check' : deployStatus === 'err' ? 'x' : 'send'} size={13}/>
            {deployStatus === 'deploying' ? ' Deploying…' : deployStatus === 'ok' ? ' Queued!' : deployStatus === 'err' ? ' Failed' : ' Deploy to UAT'}
          </button>
          <button className="btn sm ghost"><Icon name="refresh" size={13}/> Refresh</button>
        </div>
      </div>

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
      <div className="card">
        <div className="card-head" style={{ flexWrap:'wrap', gap:6 }}>
          <h3>Recent builds</h3>
          <span className="muted" style={{ fontSize:11.5 }}>Across all pipelines</span>
          <div className="spacer"/>

          {/* Result filters */}
          <FilterChip active={resultFilter === 'all'}     count={resultCounts.all}     onClick={() => setResultFilter('all')}>All</FilterChip>
          <FilterChip active={resultFilter === 'success'} count={resultCounts.success} onClick={() => setResultFilter('success')}
            icon={<span style={{ width:6, height:6, borderRadius:'50%', background:'var(--success)' }}/>}>Passed</FilterChip>
          <FilterChip active={resultFilter === 'failed'}  count={resultCounts.failed}  onClick={() => setResultFilter('failed')}
            icon={<span style={{ width:6, height:6, borderRadius:'50%', background:'var(--danger)' }}/>}>Failed</FilterChip>
          <FilterChip active={resultFilter === 'acknowledged'} count={resultCounts.acknowledged} onClick={() => setResultFilter('acknowledged')}
            icon={<span style={{ width:6, height:6, borderRadius:'50%', background:'var(--warning)' }}/>}>Acknowledged</FilterChip>
          <FilterChip active={resultFilter === 'partial'} count={resultCounts.partial} onClick={() => setResultFilter('partial')}
            icon={<span style={{ width:6, height:6, borderRadius:'50%', background:'var(--warning)' }}/>}>Partial</FilterChip>
          <FilterChip active={resultFilter === 'running'} count={resultCounts.running} onClick={() => setResultFilter('running')}
            icon={<span style={{ width:6, height:6, borderRadius:'50%', background:'var(--info)' }}/>}>Running</FilterChip>
          <FilterChip active={resultFilter === 'cancelled'} count={resultCounts.cancelled} onClick={() => setResultFilter('cancelled')}
            icon={<span style={{ width:6, height:6, borderRadius:'50%', background:'var(--text-muted)' }}/>}>Cancelled</FilterChip>

          <div style={{ width:1, height:16, background:'var(--border)', margin:'0 2px' }}/>

          {/* Pipeline visibility */}
          <div style={{ position:'relative' }} ref={pipelineMenuRef}>
            <button className="btn sm ghost" onClick={() => setPipelineMenuOpen(o => !o)}
              style={hiddenPipelines.length > 0 ? { color:'var(--accent)' } : {}}>
              <Icon name="filter" size={12}/> Pipelines
              <span style={{
                marginLeft:4, fontSize:10.5, fontWeight:600,
                color: hiddenPipelines.length > 0 ? 'var(--accent)' : 'var(--text-subtle)',
              }}>
                {visibleCount}/{allPipelineKeys.length}
              </span>
              <Icon name="arrow-right" size={10} style={{ transform:'rotate(90deg)', opacity:0.5, marginLeft:2 }}/>
            </button>
            {pipelineMenuOpen && (
              <div style={{
                position:'absolute', right:0, top:'110%', zIndex:60,
                background:'var(--surface)', border:'1px solid var(--border)',
                borderRadius:10, boxShadow:'var(--shadow-pop)',
                padding:'6px 0', minWidth:220, maxHeight:320, overflowY:'auto',
              }}>
                {/* Select all / none */}
                <div style={{
                  display:'flex', gap:6, padding:'4px 12px 8px',
                  borderBottom:'1px solid var(--border)', marginBottom:4,
                }}>
                  <button className="btn sm ghost" style={{ flex:1, fontSize:11 }} onClick={showAllPipelines}>Show all</button>
                  <button className="btn sm ghost" style={{ flex:1, fontSize:11 }} onClick={hideAllPipelines}>Hide all</button>
                </div>
                {projectPipelines.map(({ project, pipelines }) => (
                  <React.Fragment key={project}>
                    <div style={{
                      padding: '6px 12px 2px', fontSize: 10, fontWeight: 700,
                      color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}>
                      {project}
                    </div>
                    {pipelines.map(name => {
                      const key = `${project}::${name}`
                      const visible = !hiddenSet.has(key)
                      const hist = (pipelineHistory.get(key) || []).slice(0, 5)
                      return (
                        <label key={key} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '6px 12px', cursor: 'pointer', userSelect: 'none',
                          opacity: visible ? 1 : 0.45,
                        }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <input type="checkbox" checked={visible} onChange={() => togglePipeline(key)}
                            style={{ cursor: 'pointer', accentColor: 'var(--accent)', flexShrink: 0 }}/>
                          <span style={{ flex: 1, fontSize: 12.5, fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {name}
                          </span>
                          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                            {hist.map((s, i) => (
                              <span key={i} style={{
                                width: 6, height: 6, borderRadius: 2, flexShrink: 0,
                                background: sparkColor[s] || 'var(--text-subtle)', opacity: 0.8,
                              }}/>
                            ))}
                          </div>
                        </label>
                      )
                    })}
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>

          <div style={{ width:1, height:16, background:'var(--border)', margin:'0 2px' }}/>
          <button className="btn sm ghost" onClick={() => {
            const n = {}
            grouped.forEach(pg => {
              n[pg.project] = true
              pg.pipelines.forEach(g => { n[`${pg.project}::${g.name}`] = true })
            })
            setCollapsed(n)
          }}><Icon name="chevron-right" size={12}/> Collapse all</button>
          <button className="btn sm ghost" onClick={() => setCollapsed({})}><Icon name="chevron-down" size={12}/> Expand all</button>
        </div>

        {/* ── Column headers ── */}
        <div style={{
          display:'grid', gridTemplateColumns: buildGrid,
          padding:'0 14px', gap:8,
          borderBottom:'2px solid var(--border)',
          background:'var(--surface-2)',
          position:'sticky', top:0, zIndex:10,
        }}>
          {visibleBuildCols.map(f => buildHead(f.key))}
        </div>

        {/* ── Project / pipeline groups ── */}
        <div className="card-body flush">
          {grouped.map(pg => {
            const projHistory = (projectHistory.get(pg.project) || []).slice(0, 10)
            const projCollapsed = collapsed[pg.project]
            return (
              <React.Fragment key={pg.project}>
                {/* Project header */}
                <div
                  style={{
                    padding: '8px 14px', background: 'var(--surface-2)',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 700,
                  }}
                  onClick={() => setCollapsed(c => ({ ...c, [pg.project]: !c[pg.project] }))}>
                  <Icon name={projCollapsed ? 'chevron-right' : 'chevron-down'} size={12}/>
                  {visibleBuildCols.some(f => f.key === 'project') && <ProjectChip id={pg.project}/>}
                  <span className="muted mono" style={{ fontSize: 10.5 }}>{pg.runCount} run{pg.runCount !== 1 ? 's' : ''}</span>
                  <div style={{ display: 'flex', gap: 3, marginLeft: 4 }} title="Last 10 build results across this project (newest first)">
                    {projHistory.map((status, i) => (
                      <span key={i} style={{
                        width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                        background: sparkColor[status] || 'var(--text-subtle)', opacity: 0.85,
                      }}/>
                    ))}
                  </div>
                </div>

                {!projCollapsed && pg.pipelines.map(g => {
                  const key = `${pg.project}::${g.name}`
                  const history = (pipelineHistory.get(key) || []).slice(0, 10)
                  return (
                    <React.Fragment key={key}>
                      {/* Pipeline header */}
                      <div
                        style={{
                          padding: '7px 14px 7px 30px', background: 'var(--surface-2)',
                          borderBottom: '1px solid var(--border)',
                          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                        }}
                        onClick={() => setCollapsed(c => ({ ...c, [key]: !c[key] }))}>
                        <Icon name={collapsed[key] ? 'chevron-right' : 'chevron-down'} size={11}/>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{g.name}</span>
                        <span className="muted mono" style={{ fontSize: 10.5 }}>{g.runs.length} run{g.runs.length !== 1 ? 's' : ''}</span>
                        <div style={{ display: 'flex', gap: 3, marginLeft: 4 }} title="Last 10 build results (newest first)">
                          {history.map((status, i) => (
                            <span key={i} style={{
                              width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                              background: sparkColor[status] || 'var(--text-subtle)', opacity: 0.85,
                            }}/>
                          ))}
                        </div>
                      </div>

                      {/* Build rows */}
                      {!collapsed[key] && g.runs.map(b => {
                        const isNew = newItemIds.has(b.id)
                        return (
                          <div key={`${key}-${b.id}`}
                            className="build-row"
                            style={{ display: 'grid', gridTemplateColumns: buildGrid, alignItems: 'center', gap: 8, padding: '0 14px', cursor: 'pointer',
                              ...(isNew ? { background: 'color-mix(in srgb, var(--accent) 7%, var(--surface))', boxShadow: 'inset 3px 0 0 var(--accent)' } : {}),
                            }}
                            onClick={() => onOpenBuild?.(b)}>
                            {visibleBuildCols.map(f => buildCell(f.key, b))}
                          </div>
                        )
                      })}
                    </React.Fragment>
                  )
                })}
              </React.Fragment>
            )
          })}
          {grouped.length === 0 && (
            <div className="empty">No builds match the selected filter.</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Column header helper ──────────────────────────────────────
function ColHead({ children, sortable, sortDir, onSort }) {
  return (
    <div
      onClick={sortable ? onSort : undefined}
      style={{
        fontSize:11, fontWeight:600, color:'var(--text-muted)',
        textTransform:'uppercase', letterSpacing:'0.05em',
        padding:'8px 0', display:'flex', alignItems:'center', gap:4,
        userSelect:'none',
        cursor: sortable ? 'pointer' : 'default',
        whiteSpace:'nowrap',
      }}
      onMouseEnter={e => { if (sortable) e.currentTarget.style.color = 'var(--text)' }}
      onMouseLeave={e => { if (sortable) e.currentTarget.style.color = 'var(--text-muted)' }}>
      {children}
      {sortable && (
        <Icon
          name={sortDir === 'desc' ? 'arrow-down' : 'arrow-up'}
          size={10}
          style={{ opacity:0.7 }}
        />
      )}
    </div>
  )
}
