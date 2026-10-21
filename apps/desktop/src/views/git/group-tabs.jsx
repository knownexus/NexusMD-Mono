import React from 'react'

// Same props as before. `busy` (a reason string) disables New group until there is something to pick from.
export function GroupTabs({ tabs, active, onSelect, onNew, onMenu, busy = null }) {
  const strip = React.useRef(null)
  const refs = React.useRef({})
  // Keep the active pill visible when the strip overflows (scrollLeft, not scrollIntoView).
  React.useEffect(() => {
    const el = refs.current[active], box = strip.current
    if (!el || !box) return
    if (el.offsetLeft < box.scrollLeft) box.scrollLeft = el.offsetLeft
    else if (el.offsetLeft + el.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = el.offsetLeft + el.offsetWidth - box.clientWidth
  }, [active])
  const activeTab = tabs.find(t => t.name === active)
  return (
    <div className="nx-pills">
      <div ref={strip} role="tablist" aria-label="Project groups" className="nx-pills" style={{ flexWrap: 'nowrap', overflowX: 'auto', minWidth: 0 }}>
        {tabs.map(t => (
          <button key={t.name} ref={el => { refs.current[t.name] = el }} role="tab" aria-selected={t.name === active} className="nx-pill"
            onClick={() => onSelect(t.name)} onContextMenu={e => { if (t.editable) { e.preventDefault(); onMenu(t.name) } }}>
            {t.name}{t.count > 0 && <span className="n">{t.count}</span>}
          </button>
        ))}
      </div>
      <button className="nx-link" aria-label="New group" title={busy ?? undefined} disabled={!!busy} onClick={onNew} style={{ marginLeft: 6 }}>+ New group</button>
      {activeTab?.editable && (
        <button className="nx-link" style={{ color: 'var(--text-muted)' }} aria-label={`Group options for ${activeTab.name}`} onClick={() => onMenu(activeTab.name)}>Edit group</button>
      )}
    </div>
  )
}
