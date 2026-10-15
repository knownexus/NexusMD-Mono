import React from 'react'
import { graphCells } from '@nexusmd/core'

// Six lane colours, each with a fallback to an existing theme colour.
const LANES = [
  'var(--graph-0, var(--accent))', 'var(--graph-1, var(--success))', 'var(--graph-2, var(--warning))',
  'var(--graph-3, var(--danger))', 'var(--graph-4, var(--text-muted))', 'var(--graph-5, var(--accent))',
]
const CHIP = {
  head: { fontWeight: 700, border: '1px solid var(--accent)', color: 'var(--accent)' },
  branch: { background: 'color-mix(in srgb, var(--accent) 18%, transparent)' },
  remote: { border: '1px solid var(--border)' },
  tag: { color: 'var(--text-muted)' },
  other: { color: 'var(--text-muted)' },
}
const mono = { fontFamily: 'var(--font-mono, monospace)', whiteSpace: 'pre' }
const rtf = typeof Intl !== 'undefined' && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null
const STEPS = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]

export function relativeTime(ms, now = Date.now()) {
  const s = Math.round((ms - now) / 1000)
  for (const [unit, size] of STEPS) {
    if (Math.abs(s) >= size) return rtf ? rtf.format(Math.round(s / size), unit) : `${Math.round(-s / size)} ${unit}s ago`
  }
  return rtf ? rtf.format(0, 'minute') : 'just now'
}

function Graph({ graph }) {
  return (
    <span aria-hidden="true" style={{ ...mono, flex: 'none' }}>
      {graphCells(graph).map((c, i) => <span key={i} style={{ color: LANES[c.lane % LANES.length] }}>{c.ch}</span>)}
    </span>
  )
}

function RefChip({ r }) {
  return (
    <span data-kind={r.kind} style={{ ...CHIP[r.kind], borderRadius: 4, padding: '0 4px', fontSize: 11, whiteSpace: 'nowrap' }}>
      {r.kind === 'tag' ? `tag: ${r.name}` : r.name}
    </span>
  )
}

const FILTERS = [['all', 'All'], ['unpushed', 'Unpushed'], ['sinceBase', 'Since']]

/**
 * The History toolbar and the commit list. Focus moves with ↑/↓; Enter hands focus to the file list.
 * `commitMenu(commit, index)` returns a row's actions ([{ label, onSelect }]), shown from its ⋯ button
 * or a right-click.
 */
export function HistoryPane({ history: h, focusOid, onFocus, onOpenFiles, commitMenu = null }) {
  const [input, setInput] = React.useState('')
  const [menuFor, setMenuFor] = React.useState(null)
  const searchRef = React.useRef(null)
  const listRef = React.useRef(null)
  const commits = h.rows.filter(r => r.commit)
  const index = commits.findIndex(r => r.commit.oid === focusOid)
  const noRemotes = h.loaded && h.unpushed === null && h.tip !== null
  const bases = h.refs.filter(r => r.ref.startsWith('refs/heads/') || r.ref.startsWith('refs/remotes/'))

  React.useEffect(() => {
    if (!focusOid) return
    const el = listRef.current?.querySelector(`[data-oid="${focusOid}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [focusOid])

  const move = delta => {
    if (!commits.length) return
    const next = index < 0 ? 0 : Math.min(commits.length - 1, Math.max(0, index + delta))
    onFocus(commits[next].commit.oid)
  }
  const onListKey = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    if (e.key === 'Enter' && focusOid) { e.preventDefault(); onOpenFiles?.() }
  }
  const onPaneKey = e => {
    if (e.key === '/' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') { e.preventDefault(); searchRef.current?.focus() }
  }
  const onSearchKey = e => {
    if (e.key === 'Enter') { e.preventDefault(); h.setSearch(input) }
    if (e.key === 'Escape') { e.preventDefault(); setInput(''); h.setSearch('') }
  }

  return (
    <section aria-label="History" onKeyDown={onPaneKey} style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input ref={searchRef} aria-label="Search history" placeholder="words · @author · :path" value={input}
          onChange={e => setInput(e.target.value)} onKeyDown={onSearchKey}
          style={{ flex: '1 1 200px', minWidth: 160, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)' }} />
        {FILTERS.map(([id, label]) => (
          <button key={id} className={`btn sm ${h.filter === id ? '' : 'ghost'}`} aria-pressed={h.filter === id}
            disabled={id === 'unpushed' && noRemotes} title={id === 'unpushed' && noRemotes ? 'No remotes' : undefined}
            onClick={() => h.setFilter(id)}>{label}</button>
        ))}
        {h.filter === 'sinceBase' && (
          <select aria-label="Base" value={h.base ?? ''} onChange={e => h.setBase(e.target.value || null)}>
            <option value="">(pick a base)</option>
            {bases.map(r => <option key={r.ref} value={r.ref}>{r.ref.replace(/^refs\/(heads|remotes)\//, '')}</option>)}
          </select>
        )}
        {noRemotes && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No remotes</span>}
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{h.loaded ? `${commits.length}${h.truncated ? '+' : ''} commits` : ''}</span>
        {h.truncated && <button className="btn sm ghost" onClick={h.loadMore}>Load more</button>}
        <button className="btn sm ghost" aria-label="Refresh history" onClick={h.refresh}>⟳</button>
      </div>
      {h.searchError && <div role="note" style={{ color: 'var(--danger)', fontSize: 12 }}>{h.searchError}</div>}
      {h.needsBase && <div role="note" style={{ color: 'var(--text-muted)' }}>Pick a base to compare with.</div>}
      {h.shallow && <div role="note" style={{ color: 'var(--text-muted)' }}>Shallow clone - older history isn't here.</div>}
      {h.error && <div role="alert" style={{ color: 'var(--danger)' }}>{h.error}</div>}
      {h.loaded && h.tip === null && <div role="note" style={{ color: 'var(--text-muted)' }}>No commits yet.</div>}
      {h.loading && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Loading…</span>}
      <div ref={listRef} role="listbox" aria-label="Commits" tabIndex={0} onKeyDown={onListKey}
        aria-activedescendant={focusOid ? `commit-${focusOid}` : undefined}
        style={{ overflow: 'auto', minHeight: 0, flex: 1, fontSize: 13 }}>
        {h.rows.map((r, i) => (r.commit
          ? (
            <React.Fragment key={r.commit.oid}>
            <div id={`commit-${r.commit.oid}`} data-oid={r.commit.oid} role="option" aria-selected={r.commit.oid === focusOid}
              onClick={() => onFocus(r.commit.oid)}
              onContextMenu={commitMenu ? e => { e.preventDefault(); onFocus(r.commit.oid); setMenuFor(r.commit.oid) } : undefined}
              style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', padding: '1px 4px',
                background: r.commit.oid === focusOid ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : undefined }}>
              <Graph graph={r.graph} />
              {r.commit.refs.map((ref, j) => <RefChip key={j} r={ref} />)}
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.commit.subject}</span>
              {h.unpushed?.has(r.commit.oid) && <span aria-label="Not pushed" title="Not pushed" style={{ color: 'var(--warning)' }}>↑</span>}
              <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{r.commit.author}</span>
              <span title={new Date(r.commit.time).toLocaleString()} style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', fontSize: 12 }}>{relativeTime(r.commit.time)}</span>
              {commitMenu && (
                <button className="btn sm ghost" aria-label={`Actions for ${r.commit.oid.slice(0, 7)}`} aria-haspopup="menu" aria-expanded={menuFor === r.commit.oid}
                  onClick={e => { e.stopPropagation(); setMenuFor(m => (m === r.commit.oid ? null : r.commit.oid)) }}>⋯</button>
              )}
            </div>
            {menuFor === r.commit.oid && commitMenu && (
              <div role="menu" aria-label={`Actions for ${r.commit.oid.slice(0, 7)}`} className="card"
                onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setMenuFor(null) } }}
                style={{ display: 'grid', gap: 2, padding: 4, margin: '2px 0 4px 32px', justifySelf: 'start' }}>
                {commitMenu(r.commit, commits.findIndex(c => c.commit.oid === r.commit.oid)).map(item => (
                  <button key={item.label} role="menuitem" className="btn sm ghost" style={{ justifyContent: 'flex-start' }}
                    onClick={() => { setMenuFor(null); item.onSelect() }}>{item.label}</button>
                ))}
              </div>
            )}
            </React.Fragment>
          )
          : <div key={`g${i}`} aria-hidden="true" style={{ padding: '0 4px' }}><Graph graph={r.graph} /></div>))}
      </div>
    </section>
  )
}
