import React from 'react'
// view-tests.jsx — Tests dashboard: pipeline runs + pass/fail summaries.
// Shared across web + desktop. Bulk data arrives via props; org/project context
// (for deep links + bug creation) comes from useNexusData().

import { FilterChip, Stat } from '../components.jsx'
import { NotificationBanner, ProjectChip, usePersisted } from '../app-components.jsx'
import { Icon } from '../icons.jsx'
import { useNexusData } from '../data-context.jsx'
import { formatDateTime, resolveFields, TESTS_TABLE_COLUMNS } from '@nexusmd/core'

const { useState: useStateT, useMemo: useMemoT } = React

export function TestsView({ tests, acknowledgedTests, setAcknowledgedTests, newItemIds = new Set() }) {
  const { data: NexusMDData } = useNexusData()
  const [initialNewCount] = useStateT(() => newItemIds.size)
  const [bannerDismissed, setBannerDismissed] = useStateT(false)
  const [pipeline,    setPipeline]    = usePersisted('nexusmd.tests.pipeline', 'all')
  const [results,     setResults]     = usePersisted('nexusmd.tests.results',  new Set())
  const [collapsed,   setCollapsed]   = useStateT({})
  const [expandedRun, setExpandedRun] = useStateT(null)
  const [page,        setPage]        = useStateT(1)
  const [pageSize,    setPageSize]    = usePersisted('nexusmd.tests.pageSize', 25)
  const [testsCfg]    = usePersisted('nexusmd.fields.testsTable', [])
  const visibleTestCols = resolveFields(TESTS_TABLE_COLUMNS, testsCfg).filter(f => f.visible)
  const testsGrid = visibleTestCols.map(c => c.width).join(' ')

  const acknowledgedSet = useMemoT(() => new Set(acknowledgedTests || []), [acknowledgedTests])
  const toggleAck = (id) => setAcknowledgedTests(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  )
  const dispResult = (run) =>
    (run.result === 'failed' && acknowledgedSet.has(run.id)) ? 'acknowledged' : run.result

  const pipelines = useMemoT(
    () => [...new Set((tests || []).map(t => t.pipeline).filter(Boolean))].sort(),
    [tests]
  )
  const statuses = useMemoT(
    () => [...new Set((tests || []).map(t => t.result).filter(Boolean))].sort(),
    [tests]
  )

  const filtered = useMemoT(() => {
    let out = tests || []
    if (pipeline !== 'all') out = out.filter(t => t.pipeline === pipeline)
    if (results.size) out = out.filter(t => results.has(dispResult(t)))
    return out.slice().sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0))
  }, [tests, pipeline, results, acknowledgedSet])

  // Reset to page 1 when filters change
  React.useEffect(() => { setPage(1) }, [pipeline, results, pageSize])

  const totalRuns    = filtered.length
  const totalTests   = filtered.reduce((s, t) => s + (t.totalTests || 0), 0)
  const totalPassed  = filtered.reduce((s, t) => s + (t.passedTests || 0), 0)
  const totalFailed  = filtered.reduce((s, t) => s + (t.failedTests || 0), 0)
  const passRate     = totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : null

  const acknowledgedCount = (tests || []).filter(t => t.result === 'failed' && acknowledgedSet.has(t.id)).length
  const failedCount       = (tests || []).filter(t => t.result === 'failed' && !acknowledgedSet.has(t.id)).length

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage   = Math.min(page, totalPages)

  const pageSlice = useMemoT(() => {
    const start = (safePage - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, safePage, pageSize])

  const grouped = useMemoT(() => {
    const map = new Map()
    pageSlice.forEach(t => {
      if (!map.has(t.pipeline)) map.set(t.pipeline, [])
      map.get(t.pipeline).push(t)
    })
    return Array.from(map.entries()).map(([name, runs]) => ({ name, runs }))
  }, [pageSlice])

  const toggleResult = (r) =>
    setResults(prev => {
      const next = new Set(prev)
      if (next.has(r)) next.delete(r); else next.add(r)
      return next
    })

  const pillForResult = (r, runId) => {
    if (r === 'acknowledged') {
      return <span className="pill warning">acknowledged</span>
    }
    const map = {
      succeeded:          'success',
      failed:             'danger',
      partiallySucceeded: 'warning',
      inProgress:         'info',
      canceled:           '',
      notStarted:         '',
    }
    const cls = map[r] || ''
    return <span className={`pill ${cls}`}>{r}</span>
  }

  const testCell = (key, run, g) => {
    switch (key) {
      case 'result':
        return (
          <div key="result" style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            {pillForResult(dispResult(run), run.id)}
          </div>
        )
      case 'run':
        return (
          <div key="run" style={{ minWidth: 0 }}>
            <div className="build-title" style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
              {NexusMDData.ORG && run.project
                ? <a href={`https://dev.azure.com/${encodeURIComponent(NexusMDData.ORG)}/${encodeURIComponent(run.project)}/_build/results?buildId=${run.id}&view=ms.vss-test-web.build-test-results-tab`} target="_blank" rel="noopener" onClick={e=>e.stopPropagation()} style={{color:'var(--accent)',textDecoration:'none'}}>#{run.id}</a>
                : <span>#{run.id}</span>}
              {newItemIds.has(run.id) && <span style={{ fontSize:9, fontWeight:700, background:'var(--accent)', color:'var(--accent-fg)', padding:'1px 5px', borderRadius:3, textTransform:'uppercase', letterSpacing:'0.05em' }}>New</span>}
              <span style={{ color:'var(--text-muted)', fontWeight:400 }}>· {run.branch || 'main'}</span>
            </div>
            <div className="build-meta" style={{ color: dispResult(run) === 'acknowledged' ? 'var(--warning)' : undefined }}>
              {run.totalTests != null
                ? `${run.passedTests || 0} passed · ${run.failedTests || 0} failed · ${run.totalTests} total`
                : 'No test run totals'}
            </div>
          </div>
        )
      case 'project':
        return <div key="project" style={{ overflow:'hidden' }}><ProjectChip id={run.project}/></div>
      case 'duration':
        return <div key="duration" className="build-meta">{run.duration || '-'}</div>
      case 'date':
        return (
          <div key="date" className="build-meta mono" title={run.startTime ? new Date(run.startTime).toLocaleString() : ''}>
            {formatDateTime(run.startTime)}
          </div>
        )
      case 'actions':
        return (
          <div key="actions" style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
            {run.result === 'failed' && (
              acknowledgedSet.has(run.id)
                ? <button className="btn sm ghost" title="Remove acknowledgement"
                    style={{ color:'var(--warning)', borderColor:'var(--warning)' }}
                    onClick={() => toggleAck(run.id)}>
                    <Icon name="x" size={12}/> Unack
                  </button>
                : <button className="btn sm ghost" title="Acknowledge this failure"
                    onClick={() => toggleAck(run.id)}>
                    <Icon name="check" size={12}/> Ack
                  </button>
            )}
            <button className="btn sm ghost" onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}>
              <Icon name={expandedRun === run.id ? 'chevron-up' : 'chevron-down'} size={12}/> Details
            </button>
            <button className="btn sm ghost" onClick={() => {
              window.dispatchEvent(new CustomEvent('nexusmd:create-wi', {
                detail: {
                  type: 'Bug',
                  title: `Test failure: ${g.name}`,
                  description: `Run #${run.id}\nPipeline: ${g.name}\nBranch: ${run.branch || 'main'}\nFailed tests: ${run.failedTests || 0}/${run.totalTests || 0}`,
                  project: (NexusMDData.CONFIG_PROJECTS || [])[0] || '',
                  tags: 'test;qa',
                }
              }))
            }}><Icon name="plus" size={12}/> Bug</button>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Tests</h1>
          <div className="sub">
            {totalRuns} runs · {totalTests ? `${totalPassed}/${totalTests} passed` : 'No test totals available'}
            {acknowledgedCount > 0 ? ` · ${acknowledgedCount} acknowledged` : ''}
          </div>
        </div>
      </div>

      {initialNewCount > 0 && !bannerDismissed && (
        <NotificationBanner
          label={`${initialNewCount} new test result${initialNewCount !== 1 ? 's' : ''} since your last visit`}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}

      <div className="filter-bar">
        <FilterChip active={pipeline === 'all'} count={tests.length} onClick={() => setPipeline('all')}>
          All pipelines
        </FilterChip>
        {pipelines.map(p => (
          <FilterChip
            key={p}
            active={pipeline === p}
            count={tests.filter(t => t.pipeline === p).length}
            onClick={() => setPipeline(p)}>
            {p}
          </FilterChip>
        ))}
      </div>

      <div className="filter-bar" style={{ marginTop: -6 }}>
        {statuses.map(r => (
          <FilterChip
            key={r}
            active={results.has(r)}
            count={r === 'failed' ? failedCount : tests.filter(t => t.result === r).length}
            onClick={() => toggleResult(r)}
            icon={r === 'failed' ? <span style={{ width:6, height:6, borderRadius:'50%', background:'var(--danger)' }}/> : undefined}>
            {r}
          </FilterChip>
        ))}
        {acknowledgedCount > 0 && (
          <FilterChip
            active={results.has('acknowledged')}
            count={acknowledgedCount}
            onClick={() => toggleResult('acknowledged')}
            icon={<span style={{ width:6, height:6, borderRadius:'50%', background:'var(--warning)' }}/>}>
            Acknowledged
          </FilterChip>
        )}
      </div>

      <div className="stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <Stat label="Runs" value={totalRuns} meta="Filtered selection" />
        <Stat label="Pass Rate" value={passRate == null ? '—' : `${passRate}%`}
          meta={totalTests ? `${failedCount} failed${acknowledgedCount > 0 ? ` · ${acknowledgedCount} ack'd` : ''}` : 'No totals'} />
        <Stat label="Failed Tests" value={totalFailed} meta="Across filtered runs"
          accent={totalFailed > 0 ? 'var(--danger)' : null}/>
      </div>

      <div className="card">
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
          <button className="btn sm ghost" onClick={() => {
            const n = {}; grouped.forEach(g => { n[g.name] = true }); setCollapsed(n)
          }}><Icon name="chevron-right" size={12}/> Collapse all</button>
          <button className="btn sm ghost" onClick={() => setCollapsed({})}><Icon name="chevron-down" size={12}/> Expand all</button>
        </div>
        {grouped.map(g => (
          <React.Fragment key={g.name}>
            <div style={{
              padding: '8px 14px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)',
              fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer'
            }} onClick={() => setCollapsed(c => ({ ...c, [g.name]: !c[g.name] }))}>
              <Icon name={collapsed[g.name] ? 'chevron-right' : 'chevron-down'} size={11}/>
              {g.name}
              <span className="muted mono" style={{ fontSize: 10.5, fontWeight: 500 }}>{g.runs.length}</span>
            </div>
            {!collapsed[g.name] && g.runs.map(run => {
              const isNew = newItemIds.has(run.id)
              return (
              <React.Fragment key={`${g.name}-${run.id}`}>
              <div className="build-row" style={{ gridTemplateColumns: testsGrid,
                ...(isNew ? { background: 'color-mix(in srgb, var(--accent) 7%, var(--surface))', boxShadow: 'inset 3px 0 0 var(--accent)' } : {}),
              }}>
                {visibleTestCols.map(f => testCell(f.key, run, g))}
              </div>
              {expandedRun === run.id && (
                <div style={{ padding: '8px 14px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Run #{run.id} · {run.pipeline} · {run.branch || 'main'}
                  </div>
                  <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span className="pill success">Passed: {run.passedTests ?? '-'}</span>
                    <span className="pill danger">Failed: {run.failedTests ?? '-'}</span>
                    <span className="pill">Total: {run.totalTests ?? '-'}</span>
                  </div>
                </div>
              )}
              </React.Fragment>
              )
            })}
          </React.Fragment>
        ))}
        {grouped.length === 0 && <div className="empty">No test runs match.</div>}
      </div>

      {totalRuns > 0 && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:12, padding:'8px 4px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:12.5, color:'var(--text-muted)' }}>
              {((safePage-1)*pageSize)+1}–{Math.min(safePage*pageSize, totalRuns)} of {totalRuns} runs
            </span>
            <div style={{ display:'flex', alignItems:'center', gap:5 }}>
              <span style={{ fontSize:11.5, color:'var(--text-subtle)', fontWeight:500 }}>Per page:</span>
              <select
                value={pageSize}
                onChange={e => setPageSize(Number(e.target.value))}
                style={{
                  height:26, padding:'0 20px 0 7px', border:'1px solid var(--border)',
                  borderRadius:6, background:'var(--surface)', fontSize:12,
                  color:'var(--text)', cursor:'pointer', appearance:'none',
                  backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%238a857d' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                  backgroundRepeat:'no-repeat', backgroundPosition:'right 6px center',
                  outline:'none', fontFamily:'var(--sans)',
                }}
              >
                {[10,25,50,100].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          {totalPages > 1 && (
            <div style={{ display:'flex', alignItems:'center', gap:4 }}>
              <button className="btn sm ghost" disabled={safePage <= 1} onClick={() => setPage(1)} title="First page">«</button>
              <button className="btn sm ghost" disabled={safePage <= 1} onClick={() => setPage(p => p - 1)}>
                <Icon name="chevron-left" size={13}/>
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 2)
                .reduce((acc, p, i, arr) => {
                  if (i > 0 && p - arr[i-1] > 1) acc.push('…')
                  acc.push(p)
                  return acc
                }, [])
                .map((p, i) => p === '…'
                  ? <span key={`ellipsis-${i}`} style={{ padding:'0 4px', color:'var(--text-subtle)', fontSize:12 }}>…</span>
                  : <button key={p} className="btn sm ghost" onClick={() => setPage(p)}
                      style={{ minWidth:30, fontWeight: p===safePage ? 700 : 400, background: p===safePage ? 'var(--accent-soft)' : undefined, color: p===safePage ? 'var(--accent)' : undefined }}>
                      {p}
                    </button>
                )}
              <button className="btn sm ghost" disabled={safePage >= totalPages} onClick={() => setPage(p => p + 1)}>
                <Icon name="chevron-right" size={13}/>
              </button>
              <button className="btn sm ghost" disabled={safePage >= totalPages} onClick={() => setPage(totalPages)} title="Last page">»</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
