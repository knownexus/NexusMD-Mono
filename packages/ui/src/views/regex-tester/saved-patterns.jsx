import React from 'react'
import { wordMatch } from '@nexusmd/core'
import { Icon } from '../../icons.jsx'
import { displayName, relativeTime } from '../document-store.js'
import { flagsToString } from './constants.js'

const patternOf = doc => (doc.content?.pattern ? `/${doc.content.pattern}/${flagsToString(doc.content.flags ?? {})}` : '')

/**
 * The saved patterns, in a column of their own: a count, a + for a new one, a filter (the start of words in a
 * name or pattern) and a row per pattern with when it changed. The open one is marked; right-click gives
 * Rename…, Duplicate and Delete….
 */
export function SavedPatterns({ docs, currentDocId, onOpen, onNew, onRename, onDuplicate, onDelete }) {
  const [query, setQuery] = React.useState('')
  const [menu, setMenu] = React.useState(null)
  // The row being renamed in place: { id, value }. (Electron has no window.prompt.)
  const [renaming, setRenaming] = React.useState(null)
  const settled = React.useRef(false)
  React.useEffect(() => {
    if (!menu) return undefined
    const close = () => setMenu(null)
    const key = e => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', key)
    window.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('mousedown', close); window.removeEventListener('scroll', close, true) }
  }, [menu])
  const shown = docs.filter(d => wordMatch(`${displayName(d)} ${patternOf(d)}`, query))
  const target = menu ? docs.find(d => d.id === menu.id) : null
  const act = fn => () => { setMenu(null); fn() }
  const finishRename = save => {
    if (settled.current || !renaming) return
    settled.current = true
    const doc = docs.find(d => d.id === renaming.id)
    const name = renaming.value.trim()
    setRenaming(null)
    if (save && doc && name && name !== displayName(doc)) onRename(doc.id, name)
  }
  return (
    <aside className="nx-rt-saved" aria-label="Saved patterns column">
      <div className="nx-rt-saved-head">
        <span className="nx-rt-eyebrow">Saved patterns</span>
        <span className="nx-rt-count">{docs.length}</span>
        <button type="button" className="nx-rt-new" aria-label="New pattern" title="New pattern" onClick={onNew}><Icon name="plus" size={12} /></button>
      </div>
      <label className="nx-rt-filter">
        <Icon name="search" size={12} />
        <input type="search" role="searchbox" aria-label="Filter patterns" placeholder="Filter patterns" value={query} spellCheck={false} onChange={e => setQuery(e.target.value)} />
      </label>
      {!docs.length && <div className="nx-rt-note">No saved patterns yet.</div>}
      {!!docs.length && !shown.length && <div className="nx-rt-note">No pattern matches.</div>}
      <ul className="nx-rt-saved-list" aria-label="Saved patterns">
        {shown.map(d => (renaming?.id === d.id
          ? (
            <li key={d.id} className="nx-rt-rename">
              <input autoFocus aria-label="Rename pattern" value={renaming.value} spellCheck={false}
                onChange={e => setRenaming({ ...renaming, value: e.target.value })} onBlur={() => finishRename(true)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); finishRename(true) } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishRename(false) } }} />
            </li>
          )
          : (
          <li key={d.id}>
            <button type="button" className="nx-rt-saved-row" title={displayName(d)} aria-current={d.id === currentDocId ? 'true' : undefined}
              onClick={() => onOpen(d.id)} onContextMenu={e => { e.preventDefault(); setMenu({ id: d.id, x: e.clientX, y: e.clientY }) }}>
              <span className="nx-rt-saved-top">
                <span className="nx-rt-saved-name">{displayName(d)}</span>
                <span className="nx-rt-saved-when">{relativeTime(d.updatedAt)}</span>
              </span>
              {patternOf(d) && <span className="nx-rt-pattern">{patternOf(d)}</span>}
            </button>
          </li>
          )))}
      </ul>
      {menu && target && (
        <div role="menu" aria-label="Pattern options" className="nx-rt-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={e => e.stopPropagation()}>
          <button type="button" role="menuitem" onClick={act(() => { settled.current = false; setRenaming({ id: target.id, value: displayName(target) }) })}>Rename…</button>
          <button type="button" role="menuitem" onClick={act(() => onDuplicate(target.id))}>Duplicate</button>
          <button type="button" role="menuitem" data-danger="" onClick={act(() => { if (window.confirm(`Delete “${displayName(target)}”?`)) onDelete(target.id) })}>Delete…</button>
        </div>
      )}
    </aside>
  )
}
