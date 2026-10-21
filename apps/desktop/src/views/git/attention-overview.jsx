import React from 'react'
import { branchState, branchLabel, worktreeId } from '@nexusmd/core'

const plural = (n, w) => `${n} ${n === 1 ? w : `${w}s`}`
const many = n => `${n} ${n === 1 ? 'branch' : 'branches'}`

// One card per category; a worktree with an operation only appears under In progress.
const CATEGORIES = [
  { id: 'busy', title: 'In progress', tone: 'bad', hint: n => `${n} stopped part-way`,
    when: (t, s) => s.busy, desc: (t, s) => `${t.operation}${s.conflicts ? ` · ${plural(s.conflicts, 'conflict')} to resolve` : ''}`, action: () => ({ kind: 'resolve', label: 'Resolve' }) },
  { id: 'pull', title: 'Behind upstream', tone: 'info', hint: n => `${n} with new commits to pull`,
    when: (t, s) => !s.busy && s.behind > 0, desc: (t, s) => `${plural(s.behind, 'new commit')} on ${t.upstream}${s.changed ? ' · you have local changes' : ''}`, action: (t, s) => ({ kind: 'pull', label: `Pull ↓${s.behind}` }) },
  { id: 'push', title: 'Ready to push', tone: 'info', hint: n => `${n} with local commits`,
    when: (t, s) => !s.busy && s.ahead > 0, desc: (t, s) => `${plural(s.ahead, 'commit')} not on ${t.upstream || 'the remote'}`, action: (t, s) => ({ kind: 'push', label: `Push ↑${s.ahead}` }) },
  { id: 'changes', title: 'Uncommitted work', tone: 'warn', hint: n => `${n} with changed files`,
    when: (t, s) => !s.busy && s.changed > 0, desc: (t, s) => `${plural(s.changed, 'file')} changed${s.staged ? ` · ${s.staged} staged` : ''}`, action: () => ({ kind: 'review', label: 'Review & commit' }) },
  { id: 'local', title: 'Not published', tone: 'muted', hint: n => `${n} without an upstream`,
    when: (t, s) => s.unpublished, desc: t => (t.upstreamGone ? 'Its branch on origin was deleted — re-publish it or delete it locally' : 'Only exists on this machine'), action: t => ({ kind: 'publish', label: t.upstreamGone ? 'Re-publish' : 'Publish' }) },
]

/**
 * The page with nothing selected: what needs the user, grouped, each with one action.
 * onOpen(tree) selects it; onAction(kind, tree) with kind resolve | pull | push | review | publish.
 * onPullAll / onCommitAcross open the batch dialogs (shown when 2+ branches qualify).
 */
export function AttentionOverview({ trees, repoCount, onOpen, onAction, onPullAll, onCommitAcross, children }) {
  const live = trees.filter(t => !t.error)
  const states = new Map(live.map(t => [t, branchState(t)]))
  const cards = CATEGORIES.map(c => ({ ...c, items: live.filter(t => c.when(t, states.get(t))) })).filter(c => c.items.length)
  const need = live.filter(t => states.get(t).tone !== 'ok').length
  const pullable = live.filter(t => { const s = states.get(t); return s.behind && !s.changed && !s.busy }).length
  const committable = live.filter(t => { const s = states.get(t); return s.staged && !s.busy }).length
  return (
    <div className="nx-gw-attn">
      <div className="nx-gw-attn-title">
        <h2>{need ? `${many(need)} need${need === 1 ? 's' : ''} attention` : 'All caught up'}</h2>
        <span className="nx-muted">{`${many(trees.length)} across ${repoCount} ${repoCount === 1 ? 'repository' : 'repositories'}`}</span>
      </div>
      {cards.map(c => (
        <section key={c.id} className="nx-gw-card" aria-label={c.title}>
          <div className="nx-gw-card-head">
            <span className="nx-gw-dot" data-tone={c.tone} />
            <span className="nx-gw-card-title">{c.title}</span>
            <span className="hint">{c.hint(c.items.length)}</span>
            {c.id === 'pull' && pullable > 1 && onPullAll && <button className="btn sm" onClick={onPullAll}>{`Pull all clean (${pullable})`}</button>}
            {c.id === 'changes' && committable > 1 && onCommitAcross && <button className="btn sm" onClick={onCommitAcross}>{`Commit across branches (${committable})…`}</button>}
          </div>
          {c.items.map(t => {
            const s = states.get(t)
            const a = c.action(t, s)
            return (
              <div key={worktreeId(t)} className="nx-gw-attn-row">
                <button type="button" className="nx-gw-attn-open" onClick={() => onOpen(t)}>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}><span className="repo">{t.repo}</span><span className="branch">{branchLabel(t)}</span></span>
                  <span className="desc">{c.desc(t, s)}</span>
                </button>
                <div className="nx-gw-attn-actions">
                  <button className="btn sm ghost" onClick={() => onOpen(t)}>Open</button>
                  <button className={`btn sm${a.kind === 'resolve' ? ' danger' : ''}`} style={{ fontWeight: 600 }} onClick={() => onAction(a.kind, t)}>{a.label}</button>
                </div>
              </div>
            )
          })}
        </section>
      ))}
      {!cards.length && <div className="nx-gw-empty-good">Nothing needs you right now. Every branch is committed, pushed and up to date.</div>}
      {children}
    </div>
  )
}
