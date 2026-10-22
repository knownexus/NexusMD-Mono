import React from 'react'
import { worktreeName, branchLabel, worktreeId, wordMatch, matchesFilter, branchState, branchMeta, repoPills } from '@nexusmd/core'

const TONE_BADGE = { bad: 'bad', warn: 'warn', info: 'info', ok: 'ok', muted: '' }

function BranchRow({ tree, selected, onSelect }) {
  const name = worktreeName(tree), branch = branchLabel(tree)
  // A linked worktree's folder is named when it differs from the branch; the main checkout is the default, so it isn't.
  const meta = branchMeta(tree, { worktree: name !== branch && name !== 'checkout' ? name : null })
  return (
    <button type="button" className="nx-gw-row" aria-current={selected ? 'true' : undefined}
      aria-label={`${name} → ${branch}, ${meta.map(m => m.text).join(', ')}`} title={`${tree.repo} → ${branch}`}
      onClick={() => onSelect({ kind: 'worktree', id: worktreeId(tree) })}>
      <span className="nx-gw-dot" data-tone={branchState(tree).tone} />
      <span className="nx-gw-row-body">
        <span className="nx-gw-row-title">{branch}</span>
        <span className="nx-gw-row-meta">
          {meta.map(m => <span key={m.text} className="nx-gw-t" data-tone={m.tone} data-strong={m.strong || undefined}>{m.text}</span>)}
        </span>
      </span>
    </button>
  )
}

const treeShown = (t, query, filter) => matchesFilter(t, filter) && wordMatch(`${t.repo} ${branchLabel(t)} ${worktreeName(t)}`, query)

/**
 * The worktrees the list shows, top to bottom, for j / k: narrowed by query/filter and, without a
 * query, leaving out folded repositories (pass collapsed = [] to ignore folding).
 */
export function visibleTrees({ repos, scoped, query = '', filter = 'all', collapsed = [] }) {
  const unfolded = !!query.trim()
  return repos.flatMap(r => (unfolded || !collapsed.includes(r.name)
    ? scoped.worktrees.filter(t => t.repo === r.name && treeShown(t, query, filter))
    : []))
}

/**
 * The group's repositories and their branches, narrowed by query/filter. Repo headers show
 * "N branches" and status pills instead of a file count; rows show only non-default facts.
 * `query` word-matches "repo branch worktree"; `filter` is a BRANCH_FILTERS id.
 */
export function BranchList({ repos, scoped, errors, collapsed, onToggleRepo, onSetCollapsed = () => {}, selected, onSelect, query = '', filter = 'all', onClearFilters = () => {} }) {
  // The selected row stays in view when j / k move past the list's edge.
  const listRef = React.useRef(null)
  React.useEffect(() => { listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest' }) }, [selected])
  const narrowed = !!query.trim() || filter !== 'all'
  const groups = repos.map(r => {
    const all = scoped.worktrees.filter(t => t.repo === r.name)
    const trees = all.filter(t => treeShown(t, query, filter))
    const branches = filter === 'all' ? scoped.inactiveBranches.filter(b => b.repo === r.name && wordMatch(`${b.repo} ${b.name}`, query)) : []
    return { name: r.name, all, trees, branches, error: errors.find(e => e.repo === r.name) }
  }).filter(g => g.trees.length || g.branches.length || (g.error && !narrowed))

  if (!groups.length) {
    return narrowed
      ? <div className="nx-empty">No branches match. <button type="button" className="nx-link" onClick={onClearFilters}>Clear filters</button></div>
      : <div className="nx-empty">No repositories in this group yet.</div>
  }
  const shown = groups.map(g => g.name)
  const allCollapsed = shown.every(n => collapsed.includes(n))
  const noneCollapsed = !shown.some(n => collapsed.includes(n))
  return (
    <div className="nx-gw-list" ref={listRef}>
      <div role="group" aria-label="Fold repositories" style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <span className="nx-gw-list-keys" title="Next / previous branch"><span className="kbd">j</span><span className="kbd">k</span></span>
        <button className="btn sm ghost" disabled={noneCollapsed} onClick={() => onSetCollapsed(collapsed.filter(n => !shown.includes(n)))}>Expand all</button>
        <button className="btn sm ghost" disabled={allCollapsed} onClick={() => onSetCollapsed([...collapsed, ...shown.filter(n => !collapsed.includes(n))])}>Collapse all</button>
      </div>
      {groups.map(g => {
        // A search unfolds everything it found.
        const open = !collapsed.includes(g.name) || !!query.trim()
        const n = g.all.length
        return (
          <section key={g.name} aria-label={g.name}>
            <button type="button" className="nx-gw-repo-head" aria-expanded={open} onClick={() => onToggleRepo(g.name)}>
              <span className="nx-gw-caret">{open ? '▾' : '▸'}</span>
              <span className="nx-gw-repo-name">{g.name}</span>
              <span className="nx-gw-repo-count">{`${n} ${n === 1 ? 'branch' : 'branches'}`}</span>
              <span className="nx-gw-pills">
                {repoPills(g.all).map(p => <span key={p.text} className={`nx-badge ${TONE_BADGE[p.tone]}`}>{p.text}</span>)}
              </span>
            </button>
            {g.error && <div role="alert" style={{ color: 'var(--danger)', padding: '6px 10px', fontSize: 12.5 }}>{g.error.message}</div>}
            {open && (g.trees.length > 0 || g.branches.length > 0) && (
              <div className="nx-gw-rows">
                {g.trees.map(t => <BranchRow key={t.path} tree={t} selected={selected === worktreeId(t)} onSelect={onSelect} />)}
                {g.branches.map(b => (
                  <button key={b.id} className="nx-branch-row" aria-current={selected === b.id ? 'true' : undefined} onClick={() => onSelect({ kind: 'branch', id: b.id })}>
                    <span className="nx-mono">{`◇ ${b.name}`}</span><span>not checked out</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
