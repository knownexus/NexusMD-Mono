import React from 'react'
import { worktreeName, branchLabel, worktreeSummary, worktreeId } from '@nexusmd/core'

function trackingParts(t) {
  if (t.error) return [t.error]
  return [
    t.operation || null,
    `↑${t.ahead}`, `↓${t.behind}`,
    !t.upstream ? 'no upstream' : t.upstreamGone ? 'upstream missing' : null,
  ].filter(Boolean)
}

function TreeRow({ tree, selected, onSelect }) {
  const s = worktreeSummary(tree)
  const name = worktreeName(tree), branch = branchLabel(tree)
  const changes = s.changed ? `${s.changed} changed` : 'clean'
  // The branch leads on screen; the accessible name keeps the worktree too, as two rows can share a branch label.
  return (
    <button className={`nx-tree-row${tree.error ? ' err' : ''}`} aria-current={selected ? 'true' : undefined}
      aria-label={`${name} → ${branch}, ${tree.error || changes}`} onClick={() => onSelect({ kind: 'worktree', id: worktreeId(tree) })}>
      <span className="nx-row" style={{ width: '100%' }}>
        <span className="nx-strong nx-trunc" style={{ flex: 1 }} title={`${name} → ${branch}`}>{branch}</span>
        {!tree.error && <span className={`nx-badge ${s.changed ? 'warn' : ''}`}>{changes}</span>}
      </span>
      <span className="nx-tree-meta">
        {name !== branch && <span className="nx-mono">{name}</span>}
        {trackingParts(tree).map(p => <span key={p}>{p}</span>)}
        {s.staged > 0 && <span>{`${s.staged} staged`}</span>}
      </span>
    </button>
  )
}

/**
 * The group's repositories, one card each, with their worktrees and branches that aren't checked out.
 * The whole title bar folds a card; Expand all / Collapse all act on the cards shown here only.
 */
export function RepoCards({ repos, scoped, errors, collapsed, onToggleRepo, onSetCollapsed = () => {}, selected, onSelect }) {
  const groups = repos.map(r => ({
    name: r.name,
    trees: scoped.worktrees.filter(t => t.repo === r.name),
    branches: scoped.inactiveBranches.filter(b => b.repo === r.name),
    error: errors.find(e => e.repo === r.name),
  })).filter(g => g.trees.length || g.branches.length || g.error)
  if (!groups.length) return <div className="nx-empty">No repositories in this group yet.</div>
  const shown = groups.map(g => g.name)
  const allCollapsed = shown.every(n => collapsed.includes(n))
  const noneCollapsed = !shown.some(n => collapsed.includes(n))
  return (
    <div className="nx-repo-list">
      <div role="group" aria-label="Fold repositories" style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <button className="btn sm ghost" disabled={noneCollapsed} onClick={() => onSetCollapsed(collapsed.filter(n => !shown.includes(n)))}>Expand all</button>
        <button className="btn sm ghost" disabled={allCollapsed} onClick={() => onSetCollapsed([...collapsed, ...shown.filter(n => !collapsed.includes(n))])}>Collapse all</button>
      </div>
      {groups.map(g => {
        const isCollapsed = collapsed.includes(g.name)
        const changed = g.trees.reduce((n, t) => n + worktreeSummary(t).changed, 0)
        return (
          <section key={g.name} aria-label={g.name} className="card" style={{ flex: 'none' }}>
            <button className="nx-tile-head" aria-expanded={!isCollapsed} aria-label={g.name} onClick={() => onToggleRepo(g.name)}
              style={{ width: '100%', border: 0, borderBottom: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
              <span>{`${isCollapsed ? '▸' : '▾'} ${g.name}`}</span>
              <span className="nx-tile-meta">{changed ? `${changed} changed` : 'clean'}</span>
            </button>
            {g.error && <div role="alert" style={{ color: 'var(--danger)', padding: '8px 14px' }}>{g.error.message}</div>}
            {!isCollapsed && (g.trees.length > 0 || g.branches.length > 0) && (
              <div style={{ padding: 6 }}>
                {g.trees.map(t => <TreeRow key={t.path} tree={t} selected={selected === worktreeId(t)} onSelect={onSelect} />)}
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

/** Four counts across the worktrees in the active group. */
export function GitSummary({ worktrees }) {
  const ok = worktrees.filter(t => !t.error)
  const stats = [
    ['Uncommitted files', ok.reduce((n, t) => n + t.changes.length, 0)],
    ['Commits to push', ok.reduce((n, t) => n + (t.ahead || 0), 0)],
    ['Commits to pull', ok.reduce((n, t) => n + (t.behind || 0), 0)],
    ['Without upstream', ok.filter(t => !t.upstream && t.branch !== '(detached)').length],
  ]
  return (
    <div className="nx-stats">
      {stats.map(([label, value]) => (
        <div key={label} className="nx-stat"><div className="nx-stat-label">{label}</div><div className="nx-stat-value">{value}</div></div>
      ))}
    </div>
  )
}
