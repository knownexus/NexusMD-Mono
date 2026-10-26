import React from 'react'
import { parseLog, historyQuery, sourceName } from '@nexusmd/core'
import { ipcMessage } from './use-git-actions.js'
import { buildEditItems, useCommitEdit } from './commit-edit-items.js'

const COLLAPSED_KEY = 'nx-gw-branch-commits-collapsed'
// The strip lists this many; the rest are one click away in History.
const SHOWN = 10

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSED_KEY) === '1' } catch { return false }
}
function writeCollapsed(v) {
  try { localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0') } catch { /* storage unavailable: the choice lasts until reload */ }
}

/**
 * The commits between `sourceRef` and HEAD (newest first), re-read when `head` changes. The log is
 * asked for a full page, the smallest the query allows; `commits` is all of them and also says which
 * commits are the branch's own. Nothing is read without a `sourceRef`.
 * @returns {{ commits: object[], unpushed: Set<string>|null, truncated: boolean, error: string|null }}
 */
export function useBranchCommits({ adapter, repo, cwd, registered, sourceRef, head }) {
  const ctx = JSON.stringify({ repo: { name: repo.name, path: repo.path }, cwd, registered })
  const [state, setState] = React.useState({ commits: [], unpushed: null, truncated: false, error: null })
  React.useEffect(() => {
    if (!sourceRef) { setState(s => (s.commits.length || s.error ? { commits: [], unpushed: null, truncated: false, error: null } : s)); return undefined }
    let live = true
    const c = JSON.parse(ctx)
    adapter.log(c.repo, c.cwd, c.registered, historyQuery({ ref: 'HEAD', filter: 'sinceBase', base: sourceRef })).then(
      r => {
        if (!live) return
        const commits = parseLog(r.text).filter(row => row.commit).map(row => row.commit)
        setState({ commits, unpushed: Array.isArray(r.unpushed) ? new Set(r.unpushed) : null, truncated: !!r.truncated || commits.length > SHOWN, error: null })
      },
      e => { if (live) setState(s => ({ ...s, error: ipcMessage(e) })) },
    )
    return () => { live = false }
  }, [adapter, ctx, sourceRef, head])
  return state
}

/**
 * "N commits off <source>": the branch's own commits, collapsible, under the header. Click a row to
 * open it in History; right-click for Reword / Squash. `data` is useBranchCommits' result.
 */
export function BranchCommits({ tree, adapter, repo, registered, data, onOpenCommit, onShowAll, onAction }) {
  const [collapsed, setCollapsedState] = React.useState(readCollapsed)
  const [menuFor, setMenuFor] = React.useState(null)
  const edit = useCommitEdit({ adapter, repo, cwd: tree.path, registered, onAction })
  React.useEffect(() => {
    if (menuFor == null) return undefined
    const away = e => { if (!e.target.closest?.('.nx-gw-bc-menu')) setMenuFor(null) }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [menuFor])
  const count = tree.source?.count
  if (!count || tree.branch === '(detached)') return null
  const source = sourceName(tree.source.ref)
  const { commits, unpushed, truncated, error } = data
  const own = new Set(commits.map(c => c.oid))
  const setCollapsed = v => { setCollapsedState(v); writeCollapsed(v) }
  const items = index => buildEditItems({
    commits, index, unpushed, own, source, searching: false, selected: new Set([commits[index].oid]),
    onEdit: e => edit.start(e, commits),
  })
  return (
    <section className="nx-gw-bc" aria-label="Commits off source">
      <div className="nx-gw-bc-head">
        <button type="button" className="nx-gw-bc-title" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
          <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
          {count} {count === 1 ? 'commit' : 'commits'} off {source}
        </button>
        {!collapsed && (truncated || count > commits.length) && commits.length > 0 && (
          <button type="button" className="nx-gw-crumb-link" onClick={onShowAll}>Show all in History</button>
        )}
      </div>
      {error && <div role="alert" className="nx-gw-dhead-error">{error}</div>}
      {!collapsed && (
        <ul className="nx-gw-bc-list">
          {commits.slice(0, SHOWN).map((c, i) => (
            <li key={c.oid} className="nx-gw-bc-row" onClick={() => onOpenCommit(c.oid)}
              onContextMenu={e => { e.preventDefault(); setMenuFor(c.oid) }}>
              <span className="nx-gw-bc-subject">{c.subject}</span>
              {unpushed?.has(c.oid) && <span aria-label="Not pushed" title="Not pushed" style={{ color: 'var(--warning)' }}>↑</span>}
              <span className="nx-gw-hrow-hash">{c.oid.slice(0, 7)}</span>
              {menuFor === c.oid && (
                <div role="menu" aria-label={`Actions for ${c.oid.slice(0, 7)}`} className="nx-gw-menu nx-gw-bc-menu" data-align="left"
                  onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setMenuFor(null) } }}>
                  {items(i).map(item => (
                    <button key={item.label} type="button" role="menuitem" className="nx-gw-menu-item" disabled={item.disabled} title={item.disabled ? item.reason : undefined}
                      onClick={() => { setMenuFor(null); item.onSelect() }}>{item.label}</button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {edit.dialog}
    </section>
  )
}
