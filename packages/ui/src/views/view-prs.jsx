import React from 'react'
// view-prs.jsx — Pull Requests list view. Shared across web + desktop.
// PR list arrives via props; team/me + refresh come from useNexusData().

import { FilterChip } from '../components.jsx'
import { Avatar, NotificationBanner, usePersisted } from '../app-components.jsx'
import { Icon } from '../icons.jsx'
import { useNexusData, useEffectiveNeedsMe, useEffectiveTeamActivity } from '../data-context.jsx'
import { resolveFields, PR_CARD_FIELDS } from '@nexusmd/core'

const { useState: useStatePR, useMemo: useMemoPR } = React

function NeedsMeCriteriaPopover({ criteria, onChange, onClose }) {
  const ref = React.useRef(null)
  React.useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  const toggleVote = (v) => {
    const votes = criteria.votes || [0]
    const next = votes.includes(v) ? votes.filter(x => x !== v) : [...votes, v]
    if (!next.length) return
    onChange({ ...criteria, votes: next })
  }

  return (
    <div ref={ref} style={{
      position: 'absolute', top: '100%', left: 0, zIndex: 100, marginTop: 4,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 8, boxShadow: 'var(--shadow-pop)', padding: '10px 12px', width: 252,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Count as "needs my review"
      </div>
      {[[0, 'Pending (no vote)'], [-5, 'Waiting for author'], [-10, 'Rejected'], [5, 'Approved with suggestions'], [10, 'Approved']].map(([v, label]) => (
        <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer', padding: '3px 0' }}>
          <input type="checkbox" checked={(criteria.votes || [0]).includes(v)}
            onChange={() => toggleVote(v)} style={{ margin: 0 }}/>
          {label}
        </label>
      ))}
      <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0 6px' }}/>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Filters
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer', padding: '3px 0' }}>
        <input type="checkbox" checked={!!criteria.includeDrafts}
          onChange={() => onChange({ ...criteria, includeDrafts: !criteria.includeDrafts })} style={{ margin: 0 }}/>
        Include drafts
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer', padding: '3px 0' }}>
        <input type="checkbox" checked={!!criteria.excludeMine}
          onChange={() => onChange({ ...criteria, excludeMine: !criteria.excludeMine })} style={{ margin: 0 }}/>
        Exclude PRs I authored
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer', padding: '3px 0' }}>
        <input type="checkbox" checked={!!criteria.excludeConflicts}
          onChange={() => onChange({ ...criteria, excludeConflicts: !criteria.excludeConflicts })} style={{ margin: 0 }}/>
        Exclude PRs with merge conflicts
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer', padding: '3px 0' }}>
        <input type="checkbox" checked={!!criteria.onlyActive}
          onChange={() => onChange({ ...criteria, onlyActive: !criteria.onlyActive })} style={{ margin: 0 }}/>
        Only active PRs
      </label>
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5, padding: '5px 0 2px' }}>
        <span>Minimum age</span>
        <select value={criteria.minAgeDays || 0}
          onChange={(e) => onChange({ ...criteria, minAgeDays: parseInt(e.target.value, 10) || 0 })}
          style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', cursor: 'pointer' }}>
          <option value={0}>Any</option>
          <option value={1}>&ge; 1 day</option>
          <option value={3}>&ge; 3 days</option>
          <option value={7}>&ge; 7 days</option>
        </select>
      </label>
    </div>
  )
}

function TeamActivityCriteriaPopover({ criteria, onChange, onClose }) {
  const ref = React.useRef(null)
  React.useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  return (
    <div ref={ref} style={{
      position: 'absolute', top: '100%', left: 0, zIndex: 100, marginTop: 4,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 8, boxShadow: 'var(--shadow-pop)', padding: '10px 12px', width: 252,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Team activity filters
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer', padding: '3px 0' }}>
        <input type="checkbox" checked={!!criteria.includeDrafts}
          onChange={() => onChange({ ...criteria, includeDrafts: !criteria.includeDrafts })} style={{ margin: 0 }}/>
        Include drafts
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer', padding: '3px 0' }}>
        <input type="checkbox" checked={!!criteria.excludeConflicts}
          onChange={() => onChange({ ...criteria, excludeConflicts: !criteria.excludeConflicts })} style={{ margin: 0 }}/>
        Exclude PRs with merge conflicts
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer', padding: '3px 0' }}>
        <input type="checkbox" checked={!!criteria.onlyActive}
          onChange={() => onChange({ ...criteria, onlyActive: !criteria.onlyActive })} style={{ margin: 0 }}/>
        Only active PRs
      </label>
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5, padding: '5px 0 2px' }}>
        <span>Minimum age</span>
        <select value={criteria.minAgeDays || 0}
          onChange={(e) => onChange({ ...criteria, minAgeDays: parseInt(e.target.value, 10) || 0 })}
          style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', cursor: 'pointer' }}>
          <option value={0}>Any</option>
          <option value={1}>&ge; 1 day</option>
          <option value={3}>&ge; 3 days</option>
          <option value={7}>&ge; 7 days</option>
        </select>
      </label>
    </div>
  )
}

export function PRView({ prs, onOpen, onOpenLink, needsMeCriteria, setNeedsMeCriteria, newItemIds = new Set() }) {
  const { data: NexusMDData, api: NexusMDApi } = useNexusData()
  const effectiveNeedsMe = useEffectiveNeedsMe()
  const effectiveTeamActivity = useEffectiveTeamActivity()
  const [initialNewCount] = useStatePR(() => newItemIds.size)
  const [bannerDismissed, setBannerDismissed] = useStatePR(false)
  const [filter,   setFilter]   = usePersisted('nexusmd.pr.filter',   'needsMe')
  const [search,   setSearch]   = useStatePR('')
  const [grouping, setGrouping] = usePersisted('nexusmd.pr.grouping', 'author')
  const [collapsed, setCollapsed] = useStatePR({})
  const [showCriteriaPopover, setShowCriteriaPopover] = useStatePR(false)
  const [teamActivityCriteria, setTeamActivityCriteria] = usePersisted('nexusmd.pr.teamActivityCriteria', { onlyActive: true })
  const [showTeamActivityPopover, setShowTeamActivityPopover] = useStatePR(false)
  const [focusedWI, setFocusedWI] = useStatePR(null)
  React.useEffect(() => {
    const nav = window.NexusMDNav
    if (nav?.pendingFilter?.workItemId != null) {
      setFocusedWI(nav.pendingFilter.workItemId)
      window.NexusMDNav = null   // consume, like the planner view does
    }
  }, [])
  const criteria = needsMeCriteria || { votes: [0], includeDrafts: false }
  const { TEAM } = NexusMDData

  // Preserve scroll position across silent background data refreshes
  const _prScrollSaved = React.useRef(null)
  React.useEffect(() => {
    const save = () => { _prScrollSaved.current = window.scrollY }
    window.addEventListener('scroll', save, { passive: true })
    return () => window.removeEventListener('scroll', save)
  }, [])
  React.useLayoutEffect(() => {
    if (_prScrollSaved.current !== null) window.scrollTo(0, _prScrollSaved.current)
  }, [prs])

  const counts = {
    all:       prs.length,
    needsMe:   prs.filter(p => effectiveNeedsMe(p, criteria)).length,
    teamActivity: prs.filter(p => effectiveTeamActivity(p, teamActivityCriteria)).length,
    active:    prs.filter(p => p.status === 'active').length,
    drafts:    prs.filter(p => p.status === 'draft').length,
    merged:    prs.filter(p => p.status === 'merged').length,
    stale:     prs.filter(p => p.status === 'active' && p.age && (p.age.endsWith('d') && parseInt(p.age) >= 3)).length,
    failing:   prs.filter(p => p.ciStatus === 'failed').length,
    conflicts: prs.filter(p => p.hasConflicts).length,
  }

  const filtered = useMemoPR(() => {
    if (focusedWI != null) {
      return prs.filter(p => (p.linkedWorkItems || []).some(w => w.id === focusedWI))
    }
    let out = prs
    if (filter === 'needsMe') out = out.filter(p => effectiveNeedsMe(p, criteria))
    else if (filter === 'teamActivity') out = out.filter(p => effectiveTeamActivity(p, teamActivityCriteria))
    else if (filter === 'active') out = out.filter(p => p.status === 'active')
    else if (filter === 'drafts') out = out.filter(p => p.status === 'draft')
    else if (filter === 'merged') out = out.filter(p => p.status === 'merged')
    else if (filter === 'stale')  out = out.filter(p => p.status === 'active' && p.age && (p.age.endsWith('d') && parseInt(p.age) >= 3))
    else if (filter === 'failing') out = out.filter(p => p.ciStatus === 'failed')
    if (search) {
      const q = search.toLowerCase()
      out = out.filter(p => p.title.toLowerCase().includes(q) || p.branch.toLowerCase().includes(q) || String(p.id).includes(q))
    }
    return out
  }, [prs, filter, search, criteria, teamActivityCriteria, focusedWI])

  // Group
  const grouped = useMemoPR(() => {
    if (grouping === 'none') return [{ key: '__all__', label: null, items: filtered }]
    const map = new Map()
    filtered.forEach(p => {
      let key, label
      if (grouping === 'author') { key = p.author; label = TEAM.find(t => t.id === p.author)?.name || p.author }
      else if (grouping === 'status') { key = p.status; label = p.status[0].toUpperCase() + p.status.slice(1) }
      else if (grouping === 'repo') { key = p.repo; label = p.repo }
      if (!map.has(key)) map.set(key, { key, label, items: [] })
      map.get(key).items.push(p)
    })
    return Array.from(map.values())
  }, [filtered, grouping])

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Pull requests</h1>
          <div className="sub">{counts.active} active · {counts.drafts} drafts · {counts.needsMe} awaiting your review</div>
        </div>
        <div className="page-head-actions">
          <button className="btn sm ghost"><Icon name="filter" size={13}/> Filter</button>
          <button className="btn sm" onClick={() => NexusMDApi?.load().catch(() => {})}><Icon name="refresh" size={13}/> Refresh</button>
        </div>
      </div>

      {focusedWI != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', marginBottom: 10, borderRadius: 8, background: 'var(--accent-soft)', border: '1px solid var(--accent-border)', fontSize: 13 }}>
          <Icon name="pr" size={13} />
          <span>Showing pull requests for work item <strong>#{focusedWI}</strong></span>
          <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => setFocusedWI(null)}>Clear</button>
        </div>
      )}

      {initialNewCount > 0 && !bannerDismissed && (
        <NotificationBanner
          label={`${initialNewCount} pull request${initialNewCount !== 1 ? 's' : ''} updated since your last visit`}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}

      <div className="filter-bar">
        <div style={{ position: 'relative' }}>
          <Icon name="search" size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }}/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search PRs…" style={{
            height: 28, padding: '0 10px 0 28px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', fontSize: 12.5, outline: 'none', width: 220
          }}/>
        </div>
        <div className="filter-sep"/>
        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          <FilterChip active={filter === 'needsMe'} count={counts.needsMe} onClick={() => setFilter('needsMe')}
            icon={<span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }}/>}>Needs my review</FilterChip>
          <button className="btn icon ghost sm" title="Customise criteria"
            style={{ height: 24, width: 24, padding: 0, flexShrink: 0 }}
            onClick={e => { e.stopPropagation(); setShowCriteriaPopover(v => !v) }}>
            <Icon name="settings" size={11}/>
          </button>
          {showCriteriaPopover && setNeedsMeCriteria && (
            <NeedsMeCriteriaPopover criteria={criteria} onChange={setNeedsMeCriteria} onClose={() => setShowCriteriaPopover(false)}/>
          )}
        </div>
        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          <FilterChip active={filter === 'teamActivity'} count={counts.teamActivity} onClick={() => setFilter('teamActivity')}
            icon={<Icon name="team" size={11}/>}>Team activity</FilterChip>
          <button className="btn icon ghost sm" title="Customise criteria"
            style={{ height: 24, width: 24, padding: 0, flexShrink: 0 }}
            onClick={e => { e.stopPropagation(); setShowTeamActivityPopover(v => !v) }}>
            <Icon name="settings" size={11}/>
          </button>
          {showTeamActivityPopover && (
            <TeamActivityCriteriaPopover criteria={teamActivityCriteria} onChange={setTeamActivityCriteria} onClose={() => setShowTeamActivityPopover(false)}/>
          )}
        </div>
        <FilterChip active={filter === 'active'} count={counts.active} onClick={() => setFilter('active')}>Active</FilterChip>
        <FilterChip active={filter === 'drafts'} count={counts.drafts} onClick={() => setFilter('drafts')}>Drafts</FilterChip>
        <FilterChip active={filter === 'merged'} count={counts.merged} onClick={() => setFilter('merged')}>Merged</FilterChip>
        <div className="filter-sep"/>
        <FilterChip active={filter === 'stale'} count={counts.stale} onClick={() => setFilter('stale')}
          icon={<Icon name="clock" size={11}/>}>Stale (3+ days)</FilterChip>
        <FilterChip active={filter === 'failing'} count={counts.failing} onClick={() => setFilter('failing')}
          icon={<span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--danger)' }}/>}>CI failing</FilterChip>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="muted" style={{ fontSize: 11.5 }}>Group by</span>
          <select value={grouping} onChange={e => setGrouping(e.target.value)} style={{
            height: 28, padding: '0 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', fontSize: 12.5
          }}>
            <option value="none">None</option>
            <option value="author">Author</option>
            <option value="status">Status</option>
            <option value="repo">Repo</option>
          </select>
        </div>
      </div>

      <div className="card">
        {grouping !== 'none' && (
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
            <button className="btn sm ghost" onClick={() => {
              const next = {}
              grouped.forEach(g => { next[g.key] = true })
              setCollapsed(next)
            }}><Icon name="chevron-right" size={12}/> Collapse all</button>
            <button className="btn sm ghost" onClick={() => setCollapsed({})}><Icon name="chevron-down" size={12}/> Expand all</button>
          </div>
        )}
        {grouped.map(g => (
          <React.Fragment key={g.key}>
            {g.label !== null && (
              <div style={{
                padding: '8px 14px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)',
                fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8
              }} onClick={() => setCollapsed(c => ({ ...c, [g.key]: !c[g.key] }))}>
                <Icon name={collapsed[g.key] ? 'chevron-right' : 'chevron-down'} size={11}/>
                {grouping === 'author' && <Avatar who={g.key} size="xs"/>}
                {g.label}
                <span className="muted mono" style={{ fontSize: 10.5, fontWeight: 500 }}>{g.items.length}</span>
              </div>
            )}
            {!collapsed[g.key] && g.items.map(p => <PRRow key={p.id} pr={p} onOpen={onOpen} onOpenLink={onOpenLink}/>)}
          </React.Fragment>
        ))}
        {filtered.length === 0 && <div className="empty">No pull requests match.</div>}
      </div>
    </div>
  )
}

// Maps an ADO reviewer vote value to its display treatment.
// Vote values: 10 = Approved, 5 = Approved with suggestions,
// 0 = No vote (pending), -5 = Waiting for author, -10 = Rejected.
function reviewerVoteDisplay(vote) {
  if (vote === 10 || vote === 5) {
    return { label: 'Approved', glyph: '✓', color: 'var(--success)' }
  }
  if (vote === -10) {
    return { label: 'Rejected', glyph: '✕', color: 'var(--danger)' }
  }
  if (vote === -5) {
    return { label: 'Waiting for author', glyph: '!', color: 'var(--warning)' }
  }
  return { label: 'Pending', glyph: '…', color: 'var(--text-subtle)' }
}

function PRRow({ pr, onOpen, onOpenLink }) {
  const { data: NexusMDData } = useNexusData()
  // Use reviewerDetails so each avatar reflects that person's actual vote,
  // rather than marking the first N reviewers approved by list position.
  const [cfg] = usePersisted('nexusmd.fields.prCard', [])
  const order = resolveFields(PR_CARD_FIELDS, cfg).filter(f => f.visible).map(f => f.key)
  const reviewers = (pr.reviewerDetails || []).slice(0, 4)
  const wiList = (pr.linkedWorkItems || []).map(wi => wi.id)

  const subFrag = {
    author: () => (<React.Fragment key="author"><Avatar who={pr.author} size="xs"/><span style={{ fontWeight: 500 }}>{pr.authorName || NexusMDData.TEAM.find(t=>t.id===pr.author)?.name?.split(' ')[0] || pr.author}</span></React.Fragment>),
    branch: () => (<React.Fragment key="branch"><Icon name="git-branch" size={10}/><span>{pr.branch}</span></React.Fragment>),
    age: () => (<span key="age">opened {pr.age} ago</span>),
    linkedWorkItems: () => (wiList.length ? <React.Fragment key="wi">{wiList.map(wiId => <span key={wiId} className="pill" style={{ fontSize: 10, color: 'var(--accent)', background: 'var(--accent-soft)', border: '1px solid var(--accent-border)', cursor: 'pointer' }}>#{wiId}</span>)}</React.Fragment> : null),
  }
  const metaFrag = {
    changes: () => (<span key="changes" className="pr-checks" title={`+${pr.additions} −${pr.deletions}`}><span style={{ color: 'var(--success)' }}>+{pr.additions}</span><span style={{ color: 'var(--danger)' }}>−{pr.deletions}</span></span>),
    comments: () => ((pr.comments > 0 || pr.unresolvedComments > 0) ? (
      <span key="comments" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 3, color: pr.unresolvedComments > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
        <Icon name="comment" size={11}/>{pr.comments}
        {pr.unresolvedComments > 0 && <span title={`${pr.unresolvedComments} unresolved`} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--warning)', flexShrink: 0 }}/>}
      </span>) : null),
    ci: () => {
      const map = { success: 'success', failed: 'danger', running: 'info', partial: 'warning' }
      return map[pr.ciStatus] ? <span key="ci" className={`pill ${map[pr.ciStatus]}`} style={{ fontSize: 10 }}>CI</span> : null
    },
    reviewers: () => (
      <div key="reviewers" className="pr-reviewers" style={{ gap: 4 }}>
        {reviewers.map((r, i) => { const display = reviewerVoteDisplay(r.vote); const name = NexusMDData.TEAM.find(t => t.id === r.id)?.name || r.name || r.id; return (
          <span key={`${r.id}-${i}`} style={{ position: 'relative', display: 'inline-flex' }} title={`${name}: ${display.label}`}>
            <Avatar who={r.id} size="xs"/>
            <span style={{ position: 'absolute', bottom: -2, right: -2, width: 10, height: 10, borderRadius: '50%', border: '1.5px solid var(--surface)', background: display.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 6, color: 'white' }}>{display.glyph}</span>
          </span>) })}
      </div>),
  }

  const subKeys = order.filter(k => subFrag[k])
  const metaKeys = order.filter(k => metaFrag[k])
  const subEls = subKeys
    .map(k => ({ k, el: subFrag[k]() }))
    .filter(x => x.el)

  return (
    <div className="pr-row" onClick={() => onOpen(pr)}>
      <div className={`pr-status ${pr.status}`}>
        {pr.status === 'merged' ? <Icon name="merge" size={14}/> : <Icon name="pr" size={14}/>}
      </div>
      <div className="pr-info">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {pr.url
            ? <a href={pr.url} target="_blank" rel="noopener" className="pr-title truncate" style={{ textDecoration: 'none', color: 'inherit' }} onClick={e => e.stopPropagation()}>{pr.title}</a>
            : <span className="pr-title truncate">{pr.title}</span>}
          {pr.draft && <span className="pill" style={{ fontSize: 10 }}>DRAFT</span>}
          {pr.hasConflicts && <span className="pill danger" style={{ fontSize: 10 }}><Icon name="alert" size={9}/> Conflicts</span>}
        </div>
        <div className="pr-sub">
          <span>#{pr.id}</span>
          {subEls.map(({ k, el }) => (<React.Fragment key={`sep-${k}`}><span>·</span>{el}</React.Fragment>))}
        </div>
      </div>
      <div className="pr-meta">
        {pr.url && (
          <button
            type="button"
            data-testid="pr-open-link"
            className="btn sm ghost"
            title="Open pull request in Azure DevOps"
            onClick={(e) => {
              e.stopPropagation()
              if (onOpenLink) onOpenLink(pr.url)
              else window.open(pr.url, '_blank', 'noopener')
            }}
            style={{ flexShrink: 0 }}
          >
            <Icon name="link" size={12} />
          </button>
        )}
        {metaKeys.map(k => metaFrag[k]())}
      </div>
    </div>
  )
}
