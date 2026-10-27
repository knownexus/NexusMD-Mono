import React from 'react'

const repos = n => `${n} ${n === 1 ? 'repo' : 'repos'}`

// A segmented control; each tab reads "Label  N repos". `busy` (a reason string) disables + Group until there is something to pick from.
export function GroupTabs({ tabs, active, onSelect, onNew, busy = null }) {
  const strip = React.useRef(null)
  const refs = React.useRef({})
  // Keep the active tab visible when the strip overflows (scrollLeft, not scrollIntoView).
  React.useEffect(() => {
    const el = refs.current[active], box = strip.current
    if (!el || !box) return
    if (el.offsetLeft < box.scrollLeft) box.scrollLeft = el.offsetLeft
    else if (el.offsetLeft + el.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = el.offsetLeft + el.offsetWidth - box.clientWidth
  }, [active])
  return (
    <div className="nx-gw-seg" style={{ minWidth: 0, maxWidth: '100%', flex: '0 1 auto' }}>
      <div ref={strip} role="tablist" aria-label="Project groups" style={{ display: 'flex', gap: 2, overflowX: 'auto', minWidth: 0 }} className="nx-gw-seg-tabs">
        {tabs.map(t => (
          <button key={t.name} ref={el => { refs.current[t.name] = el }} type="button" role="tab" aria-selected={t.name === active} onClick={() => onSelect(t.name)}>
            {t.name}<span className="n">{repos(t.repos)}</span>
          </button>
        ))}
      </div>
      <button type="button" className="nx-gw-plus" aria-label="New group" title={busy ?? undefined} disabled={!!busy} onClick={onNew}>+ Group</button>
    </div>
  )
}
