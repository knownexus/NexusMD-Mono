import React from 'react'
import { parseLog, historyQuery, sourceName } from '@nexusmd/core'
import { ipcMessage } from './use-git-actions.js'
import { buildEditItems, useCommitEdit } from './commit-edit-items.js'
import { relativeTime } from './history-pane.jsx'

const COLLAPSED_KEY = 'nx-gw-branch-commits-collapsed'
// The strip lists this many; the rest are one click away in History.
const SHOWN = 10

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSED_KEY) === '1' } catch { return false }
}
function writeCollapsed(v) {
  try { localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0') } catch { /* storage unavailable: the choice lasts until reload */ }
}

const EMPTY = { key: null, commits: [], unpushed: null, truncated: false, error: null, loaded: false }

/**
 * The commits between `sourceRef` and HEAD (newest first), re-read when `head` changes. The log is
 * asked for a full page, the smallest the query allows; `commits` is all of them and also says which
 * commits are the branch's own, once `loaded`. Nothing is read without a `sourceRef`, and another
 * worktree or source starts empty rather than showing the last one's commits.
 * @returns {{ commits: object[], unpushed: Set<string>|null, truncated: boolean, error: string|null, loaded: boolean }}
 */
export function useBranchCommits({ adapter, repo, cwd, registered, sourceRef, head }) {
  const ctx = JSON.stringify({ repo: { name: repo.name, path: repo.path }, cwd, registered })
  const key = sourceRef ? `${ctx}\0${sourceRef}` : null
  const [state, setState] = React.useState(EMPTY)
  React.useEffect(() => {
    if (!key) { setState(EMPTY); return undefined }
    let live = true
    const c = JSON.parse(ctx)
    adapter.log(c.repo, c.cwd, c.registered, historyQuery({ ref: 'HEAD', filter: 'sinceBase', base: sourceRef })).then(
      r => {
        if (!live) return
        const commits = parseLog(r.text).filter(row => row.commit).map(row => row.commit)
        setState({ key, commits, unpushed: Array.isArray(r.unpushed) ? new Set(r.unpushed) : null, truncated: !!r.truncated || commits.length > SHOWN, error: null, loaded: true })
      },
      e => { if (live) setState(s => ({ ...(s.key === key ? s : EMPTY), key, error: ipcMessage(e) })) },
    )
    return () => { live = false }
  }, [adapter, ctx, key, sourceRef, head])
  return state.key === key ? state : EMPTY
}

/**
 * "N commits off <source>": the branch's own commits, collapsible, under the header. Click a row to
 * open it in History; right-click for Reword / Squash. Ctrl/Shift-click select several the way History
 * does, for Squash selected…. `data` is useBranchCommits' result.
 */
export function BranchCommits({ tree, adapter, repo, registered, data, onOpenCommit, onShowAll, onAction }) {
  const [collapsed, setCollapsedState] = React.useState(readCollapsed)
  const [menuFor, setMenuFor] = React.useState(null)
  // The last row clicked, and a Ctrl/Shift-click selection (empty means just that row).
  const [anchor, setAnchor] = React.useState(null)
  const [selection, setSelection] = React.useState(() => new Set())
  const edit = useCommitEdit({ adapter, repo, cwd: tree.path, registered, onAction })
  const box = React.useRef(null)
  React.useEffect(() => {
    if (menuFor == null) return undefined
    const away = e => { if (!e.target.closest?.('.nx-gw-bc-menu, .nx-gw-bc-more')) setMenuFor(null) }
    window.addEventListener('mousedown', away)
    box.current?.querySelector('.nx-gw-bc-menu [role="menuitem"]:not([disabled])')?.focus()
    return () => window.removeEventListener('mousedown', away)
  }, [menuFor])
  // Esc closes and puts focus back on the row's ⋯ button; ↑/↓ wrap between the enabled items.
  const menuKey = e => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      const more = e.currentTarget.parentElement.querySelector('.nx-gw-bc-more')
      setMenuFor(null)
      more?.focus()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const list = [...e.currentTarget.querySelectorAll('[role="menuitem"]:not([disabled])')]
    const at = list.indexOf(document.activeElement)
    list[(at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus()
  }
  const count = tree.source?.count
  if (!count || tree.branch === '(detached)') return null
  const source = sourceName(tree.source.ref)
  const { commits, unpushed, truncated, error } = data
  const own = new Set(commits.map(c => c.oid))
  const setCollapsed = v => { setCollapsedState(v); writeCollapsed(v) }
  const selected = selection.size ? selection : new Set(anchor ? [anchor] : [])
  const pick = (oid, reset = true) => { setAnchor(oid); if (reset) setSelection(new Set()) }
  const click = (e, oid) => {
    if (e.shiftKey) {
      const from = commits.findIndex(c => c.oid === anchor)
      const to = commits.findIndex(c => c.oid === oid)
      if (from >= 0 && to >= 0) { setSelection(new Set(commits.slice(Math.min(from, to), Math.max(from, to) + 1).map(c => c.oid))); return }
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected)
      if (!next.delete(oid)) { next.add(oid); setAnchor(oid) }
      setSelection(next)
      return
    }
    pick(oid)
    onOpenCommit(oid)
  }
  const items = index => buildEditItems({
    commits, index, unpushed, own, source, searching: false,
    selected: selected.has(commits[index].oid) ? selected : new Set([commits[index].oid]),
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
        <ul ref={box} className="nx-gw-bc-list">
          {commits.slice(0, SHOWN).map((c, i) => {
            const short = c.oid.slice(0, 7)
            return (
              <li key={c.oid} data-selected={selected.has(c.oid)}
                onContextMenu={e => { e.preventDefault(); if (!selected.has(c.oid)) pick(c.oid); setMenuFor(c.oid) }}>
                <div className="nx-gw-bc-row">
                  <button type="button" className="nx-gw-bc-open" title="Open in History" aria-pressed={selection.size ? selected.has(c.oid) : undefined} onClick={e => click(e, c.oid)}>
                    <span className="nx-gw-bc-subject">{c.subject}</span>
                    <span className="nx-gw-bc-age" title={new Date(c.time).toLocaleString()}>{relativeTime(c.time)}</span>
                    {unpushed?.has(c.oid) && <span aria-label="Not pushed" title="Not pushed" style={{ color: 'var(--warning)' }}>↑</span>}
                    <span className="nx-gw-hrow-hash">{short}</span>
                  </button>
                  <button type="button" className="btn sm ghost nx-gw-bc-more" aria-label={`Actions for ${short}`} aria-haspopup="menu" aria-expanded={menuFor === c.oid}
                    onClick={() => setMenuFor(m => (m === c.oid ? null : c.oid))}>⋯</button>
                </div>
                {menuFor === c.oid && (
                  <div role="menu" aria-label={`Actions for ${short}`} className="card nx-gw-bc-menu" onKeyDown={menuKey}>
                    {items(i).map(item => (
                      <button key={item.label} type="button" role="menuitem" className="btn sm ghost" style={{ justifyContent: 'flex-start' }}
                        disabled={item.disabled} title={item.disabled ? item.reason : undefined}
                        onClick={() => { setMenuFor(null); item.onSelect() }}>{item.label}</button>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {edit.dialog}
    </section>
  )
}
