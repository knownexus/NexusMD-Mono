import React from 'react'
import { CommitRail } from './commit-rail.jsx'
import { RebaseRail, rebaseLabel } from './rebase-rail.jsx'
import { relativeTime } from './history-pane.jsx'

/** The Changes tab's right-hand panel label (its collapsed strip): the operation, the last commit, or what is staged. */
export function railLabel(tree) {
  if (tree.operation) return rebaseLabel(tree)
  if (!tree.changes.length) return 'Last commit'
  return `Commit · ${tree.changes.filter(c => c.area === 'staged').length} staged`
}

const fileCount = n => `${n} file${n === 1 ? '' : 's'}`

// What was last committed, for a clean tree: its subject, hash, age, whether it is pushed and its size.
function LastCommit({ last, onAmendMessage, onShowInHistory }) {
  const { commit, loading } = last
  const reason = !commit ? null : commit.pushed ? 'Already pushed' : commit.merge ? "Merge commits can't be reworded here" : null
  return (
    <div className="nx-gw-crail">
      <div className="nx-gw-eyebrow">Last commit</div>
      {!commit
        ? <div className="nx-gw-rail-note">{loading ? 'Loading…' : 'No commits yet.'}</div>
        : (
          <>
            <div className="nx-gw-card nx-gw-lastcard">
              <div className="nx-gw-last-subject" title={commit.subject}>{commit.subject}</div>
              <div className="nx-gw-last-meta">
                <span className="nx-hash">{commit.oid.slice(0, 7)}</span>
                <span>{` · ${relativeTime(commit.when)} · ${commit.pushed ? 'pushed' : 'not pushed'}`}</span>
              </div>
              {commit.files != null && (
                <div className="nx-gw-last-size">
                  <span>{fileCount(commit.files)}</span>
                  {commit.add != null && <span className="add">{`+${commit.add}`}</span>}
                  {commit.del != null && <span className="del">{`−${commit.del}`}</span>}
                </div>
              )}
            </div>
            <button className="btn nx-gw-crail-secondary" disabled={!!reason} title={reason ?? 'Change the message of the last commit'} onClick={onAmendMessage}>Amend message…</button>
            <button className="btn ghost nx-gw-crail-secondary" onClick={() => onShowInHistory({ oid: commit.oid })}>View in History</button>
          </>
        )}
    </div>
  )
}

/**
 * The Changes tab's right-hand panel content: the rebase (or merge…) controls while one is paused, the last
 * commit when the tree is clean, otherwise the commit form. `lastCommit` is useLastCommit's result.
 */
export function ChangesRail({ tree, busy, onCommit, onOperation, lastCommit, onAmendMessage, onShowInHistory }) {
  if (tree.operation) return <RebaseRail tree={tree} onAction={onOperation} />
  if (!tree.changes.length) return <LastCommit last={lastCommit} onAmendMessage={onAmendMessage} onShowInHistory={onShowInHistory} />
  return <CommitRail tree={tree} busy={busy} onCommit={onCommit} />
}
