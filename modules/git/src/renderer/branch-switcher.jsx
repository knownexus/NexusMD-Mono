import React from 'react'
import { PlModal } from '@nexusmd/ui'
import { worktreeId, worktreeName, branchLabel, branchState, branchMeta, filterByWords } from '@nexusmd/core'

const searchText = t => `${t.repo} ${branchLabel(t)} ${worktreeName(t)}`

/** Ctrl+K: type to narrow the group's worktrees by word starts, ↑/↓ to move, Enter to open. */
export function BranchSwitcher({ trees, selected, onOpen, onClose }) {
  const [query, setQuery] = React.useState('')
  const [index, setIndex] = React.useState(0)
  const results = React.useMemo(() => filterByWords(trees, query, searchText), [trees, query])
  const current = Math.min(index, Math.max(0, results.length - 1))
  const listbox = React.useRef(null)
  React.useEffect(() => { listbox.current?.children[current]?.scrollIntoView?.({ block: 'nearest' }) }, [current, results])
  const onKeyDown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(Math.min(current + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(Math.max(current - 1, 0)) }
    else if (e.key === 'Enter' && results[current]) { e.preventDefault(); onOpen(results[current]) }
  }
  return (
    <PlModal open onClose={onClose} title="Jump to branch" icon="git-branch" className="nx-gw-palette">
      <div style={{ display: 'grid', gap: 8 }}>
        <input autoFocus role="combobox" aria-label="Branch name" aria-autocomplete="list" aria-controls="branch-switcher-list" aria-expanded={!!results.length}
          aria-activedescendant={results.length ? `branch-switcher-${current}` : undefined} placeholder="Type a repo, branch or worktree" value={query}
          onKeyDown={onKeyDown} onChange={e => { setQuery(e.target.value); setIndex(0) }} className="nx-gw-pal-input" />
        <div ref={listbox} id="branch-switcher-list" role="listbox" aria-label="Branches" className="nx-gw-pal-list">
          {results.map((t, i) => {
            const name = worktreeName(t), branch = branchLabel(t)
            const meta = branchMeta(t, { worktree: name !== branch && name !== 'checkout' ? name : null })
            return (
              <div key={worktreeId(t)} id={`branch-switcher-${i}`} role="option" aria-selected={i === current} aria-current={worktreeId(t) === selected ? 'true' : undefined}
                className="nx-gw-pal-row" onClick={() => onOpen(t)} onMouseMove={() => { if (i !== current) setIndex(i) }}>
                <span className="nx-gw-dot" data-tone={branchState(t).tone} />
                <span className="nx-gw-pal-main"><span className="b">{branch}</span><span className="d">{t.repo}</span></span>
                <span className="nx-gw-pal-meta">{meta.map(m => m.text).join(' · ')}</span>
              </div>
            )
          })}
        </div>
        {!results.length && <div style={{ color: 'var(--text-muted)' }}>No branches match.</div>}
      </div>
    </PlModal>
  )
}
