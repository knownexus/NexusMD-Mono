import React from 'react'

export function GroupTabs({ tabs, active, onSelect, onNew, onMenu }) {
  const refs = React.useRef({})
  // The active tab must stay visible when the strip overflows.
  React.useEffect(() => { refs.current[active]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) }, [active])
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div role="tablist" aria-label="Project groups" style={{ display: 'flex', gap: 4, overflowX: 'auto', flex: 1 }}>
        {tabs.map(t => (
          <span key={t.name} style={{ display: 'inline-flex', flex: 'none' }}
            onContextMenu={e => { if (t.editable) { e.preventDefault(); onMenu(t.name) } }}>
            <button ref={el => { refs.current[t.name] = el }} role="tab" aria-selected={t.name === active}
              className={`btn sm ${t.name === active ? '' : 'ghost'}`} onClick={() => onSelect(t.name)}>
              {t.name}
              {t.count > 0 && <span style={{ marginLeft: 6, color: 'var(--text-muted)' }}>{` ${t.count}`}</span>}
            </button>
            {t.editable && (
              <button className="btn sm ghost" aria-label={`Group options for ${t.name}`} onClick={() => onMenu(t.name)}>⋯</button>
            )}
          </span>
        ))}
      </div>
      <button className="btn sm ghost" aria-label="New group" onClick={onNew}>+</button>
    </div>
  )
}
