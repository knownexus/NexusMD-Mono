import React from 'react'
import { BRANCH_FILTERS, filterCounts } from '@nexusmd/core'

/**
 * The header's filter chips. Counts are branches (worktrees) in the active group. Clicking the
 * active chip again goes back to All.
 */
export function FilterChips({ trees, value = 'all', onChange }) {
  const counts = filterCounts(trees)
  return (
    <div className="nx-gw-chips" role="group" aria-label="Show branches">
      {BRANCH_FILTERS.map(f => {
        const on = value === f.id
        return (
          <button key={f.id} type="button" className="nx-gw-chip" aria-pressed={on} title={`${f.title} · count is branches`}
            onClick={() => onChange(on && f.id !== 'all' ? 'all' : f.id)}>
            <span className="nx-gw-dot" data-tone={f.tone} />
            {f.label}
            <span className="n">{counts[f.id]}</span>
          </button>
        )
      })}
    </div>
  )
}

/** The branch filter box; `/` focuses it (see useGitShortcuts). */
export const BranchSearch = React.forwardRef(function BranchSearch({ value, onChange, showKey = true }, ref) {
  return (
    <div className="nx-gw-search">
      <input ref={ref} aria-label="Filter branches and repos" placeholder="Filter branches and repos" value={value}
        onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === 'Escape' && value) { e.stopPropagation(); onChange('') } }} />
      {showKey && <span className="kbd">/</span>}
    </div>
  )
})
