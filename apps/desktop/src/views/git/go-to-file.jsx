import React from 'react'
import { PlModal } from '@nexusmd/ui'
import { filterFiles } from '@nexusmd/core'

/** Ctrl+P: type to narrow the worktree's files, ↑/↓ to move, Enter to open. */
export function GoToFile({ adapter, repo, worktreePath, registered, onOpen, onClose }) {
  const [list, setList] = React.useState(null)
  const [query, setQuery] = React.useState('')
  const [index, setIndex] = React.useState(0)
  const [error, setError] = React.useState(null)
  React.useEffect(() => {
    let live = true
    adapter.files(repo, worktreePath, registered).then(
      r => { if (live) setList(r) },
      e => { if (live) setError(e?.message || 'Could not list the files.') },
    )
    return () => { live = false }
  }, [adapter, repo, worktreePath, registered])
  const results = React.useMemo(() => (list ? filterFiles(list.files, query) : []), [list, query])
  const current = Math.min(index, Math.max(0, results.length - 1))
  const listbox = React.useRef(null)
  React.useEffect(() => { listbox.current?.children[current]?.scrollIntoView?.({ block: 'nearest' }) }, [current, results])
  const onKeyDown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(Math.min(current + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(Math.max(current - 1, 0)) }
    else if (e.key === 'Enter' && results[current]) { e.preventDefault(); onOpen(results[current]) }
  }
  return (
    <PlModal open onClose={onClose} title="Go to file" icon="search">
      <div style={{ display: 'grid', gap: 8 }}>
        <input autoFocus role="combobox" aria-label="File name" aria-autocomplete="list" aria-controls="go-to-file-list" aria-expanded={!!results.length} aria-activedescendant={results.length ? `go-to-file-${current}` : undefined} placeholder="Type a file name" value={query} onKeyDown={onKeyDown}
          onChange={e => { setQuery(e.target.value); setIndex(0) }}
          style={{ padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)' }} />
        {error && <div role="alert" className="nx-alert bad">{error}</div>}
        {!list && !error && <div style={{ color: 'var(--text-muted)' }}>Loading files…</div>}
        {list && (
          <div ref={listbox} id="go-to-file-list" role="listbox" aria-label="Files" style={{ maxHeight: 320, overflow: 'auto', display: 'grid' }}>
            {results.map((path, i) => (
              <div key={path} id={`go-to-file-${i}`} role="option" aria-selected={i === current} onClick={() => onOpen(path)}
                style={{ padding: '3px 8px', cursor: 'pointer', fontSize: 13, background: i === current ? 'var(--surface-2)' : 'none', wordBreak: 'break-all' }}>
                {path}
              </div>
            ))}
          </div>
        )}
        {list && !results.length && <div style={{ color: 'var(--text-muted)' }}>No matching files.</div>}
        {list?.truncated && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Showing the first 50,000 files.</div>}
      </div>
    </PlModal>
  )
}
