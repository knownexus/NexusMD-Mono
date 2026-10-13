import React from 'react'
import { worktreeName, branchLabel, worktreeSummary, worktreeId } from '@nexusmd/core'

function trackingText(t) {
  if (t.error) return t.error
  if (t.operation) return t.operation
  const upstream = !t.upstream ? ' · no upstream' : t.upstreamGone ? ' · upstream missing' : ''
  return `↑${t.ahead} ↓${t.behind}${upstream}`
}

function TreeRow({ tree, selected, onSelect }) {
  const s = worktreeSummary(tree)
  const changes = tree.error ? '' : s.changed ? ` · ${s.changed} changed · ${s.staged} staged` : ' · clean'
  return (
    <button className="btn ghost" aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect({ kind: 'worktree', id: worktreeId(tree) })}
      style={{ display: 'flex', width: '100%', justifyContent: 'space-between', gap: 12, color: tree.error ? 'var(--danger)' : undefined,
        background: selected ? 'var(--accent-soft)' : undefined }}>
      <span>{`${worktreeName(tree)} → ${branchLabel(tree)}`}</span>
      <span style={{ color: tree.error ? 'var(--danger)' : 'var(--text-muted)' }}>{trackingText(tree) + changes}</span>
    </button>
  )
}

export function WorktreeList({ repos, scoped, errors, collapsed, onToggleRepo, selected, onSelect }) {
  const groups = repos.map(r => ({
    name: r.name,
    trees: scoped.worktrees.filter(t => t.repo === r.name),
    branches: scoped.inactiveBranches.filter(b => b.repo === r.name),
    error: errors.find(e => e.repo === r.name),
  })).filter(g => g.trees.length || g.branches.length || g.error)
  if (!groups.length) return <div style={{ padding: 16, color: 'var(--text-muted)' }}>No repositories in this group yet.</div>
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {groups.map(g => {
        const isCollapsed = collapsed.includes(g.name)
        const changed = g.trees.reduce((n, t) => n + worktreeSummary(t).changed, 0)
        return (
          <section key={g.name} aria-label={g.name} className="card" style={{ padding: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="btn sm ghost" aria-expanded={!isCollapsed} onClick={() => onToggleRepo(g.name)}>
                {`${isCollapsed ? '▸' : '▾'} ${g.name}`}
              </button>
              <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{`${changed} changed`}</span>
            </div>
            {g.error && <div role="alert" style={{ color: 'var(--danger)', padding: '4px 8px' }}>{g.error.message}</div>}
            {!isCollapsed && g.trees.map(t => (
              <TreeRow key={t.path} tree={t} selected={selected === worktreeId(t)} onSelect={onSelect} />
            ))}
            {!isCollapsed && g.branches.map(b => (
              <button key={b.id} className="btn ghost" aria-current={selected === b.id ? 'true' : undefined}
                onClick={() => onSelect({ kind: 'branch', id: b.id })}
                style={{ display: 'flex', width: '100%', justifyContent: 'space-between' }}>
                <span>{`◇ ${b.name}`}</span><span style={{ color: 'var(--text-muted)' }}>not checked out</span>
              </button>
            ))}
          </section>
        )
      })}
    </div>
  )
}
