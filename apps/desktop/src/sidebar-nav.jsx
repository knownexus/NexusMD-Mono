import React from 'react'
import { Icon } from '@nexusmd/ui'
import { usePersistedState } from '@nexusmd/shell-sdk'
import { sidebarGroups, shortcutNav } from './layout.js'
import { SETTINGS_NAV } from './nav-config.js'

// The number keys 1-9 open the screen with that number in `shortcutList` (shortcutNav: main, then
// More, then footer, as the sidebar numbers them). Ignored while typing or with a modifier held.
export function useNumberKeys(shortcutList, setView) {
  const listRef = React.useRef(shortcutList)
  listRef.current = shortcutList
  const setViewRef = React.useRef(setView)
  setViewRef.current = setView
  React.useEffect(() => {
    const handler = (e) => {
      const t = e.target
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const idx = parseInt(e.key, 10)
      if (idx >= 1 && idx <= 9) {
        const target = listRef.current[idx - 1]
        if (target) setViewRef.current(target.id)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}

// The sidebar's screens, in the groups the user placed them in (Settings > Appearance > Sidebar):
// the main list, a collapsible More group, then (at the bottom) the footer group, an optional
// status line and Settings, which is always last. Hidden and switched-off screens are left out.
export function SidebarNav({
  nav, order, hidden, placement, off, view, onSelect,
  iconsOnly = false, showNumbers = false, badges = {}, status = null,
}) {
  const groups = sidebarGroups(nav, { order, hidden, placement, off })
  const { main, more, footer } = groups
  // The number hints follow the number keys (useNumberKeys): main, then More, then footer.
  const numbers = new Map(shortcutNav(groups).slice(0, 9).map((item, idx) => [item.id, idx + 1]))
  const numberOf = item => (showNumbers ? numbers.get(item.id) ?? null : null)
  const [moreOpen, setMoreOpen] = usePersistedState('nexusmd.sidebar.moreOpen', false)
  const moreHasCurrent = more.some(item => item.id === view)
  const moreBadge = more.some(item => badges[item.id] > 0)

  const button = (item, { number = null, indent = false } = {}) => {
    const current = view === item.id
    const badge = badges[item.id] || 0
    return (
      <button
        key={item.id}
        onClick={() => onSelect(item.id)}
        className={`nav-item ${current ? 'active' : ''}`}
        aria-current={current ? 'page' : undefined}
        aria-label={iconsOnly ? item.label : undefined}
        title={iconsOnly ? item.label : undefined}
        style={{
          display: 'flex', alignItems: 'center',
          justifyContent: iconsOnly ? 'center' : 'flex-start',
          gap: 10, padding: iconsOnly ? '8px' : `8px 10px 8px ${indent ? 20 : 10}px`,
          border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
          background: current ? 'var(--accent-soft, rgba(127,127,127,0.12))' : 'transparent',
          color: current ? 'var(--accent)' : 'var(--text-muted)',
          font: 'inherit', fontSize: 13, position: 'relative',
        }}
      >
        <Icon name={item.icon} size={16} />
        {!iconsOnly && item.label}
        {badge > 0 && (iconsOnly ? <Dot /> : <Count n={badge} />)}
        {!iconsOnly && number != null && !badge && (
          <span aria-hidden="true" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-subtle)', opacity: 0.5 }}>
            {number}
          </span>
        )}
      </button>
    )
  }

  return (
    <nav aria-label="Sidebar" style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0 }}>
      <div role="group" aria-label="Main screens" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {main.map(item => button(item, { number: numberOf(item) }))}
      </div>
      {more.length > 0 && (
        <>
          <button
            className="nav-item"
            onClick={() => setMoreOpen(o => !o)}
            aria-expanded={moreOpen}
            aria-controls="sidebar-more"
            aria-label={`More (${more.length})`}
            title={iconsOnly ? 'More' : undefined}
            style={{
              display: 'flex', alignItems: 'center',
              justifyContent: iconsOnly ? 'center' : 'flex-start',
              gap: 10, padding: iconsOnly ? '8px' : '8px 10px',
              border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'left', background: 'transparent',
              color: moreHasCurrent && !moreOpen ? 'var(--accent)' : 'var(--text-muted)',
              font: 'inherit', fontSize: 13, position: 'relative',
            }}
          >
            <Icon name="more" size={16} />
            {!iconsOnly && <>More<span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{more.length}</span></>}
            {!moreOpen && moreBadge && <Dot />}
            {!iconsOnly && <span aria-hidden="true" style={{ marginLeft: 'auto', display: 'inline-flex' }}><Icon name={moreOpen ? 'chevron-down' : 'chevron-right'} size={14} /></span>}
          </button>
          <div id="sidebar-more" role="group" aria-label="More" hidden={!moreOpen}
            style={{ display: moreOpen ? 'flex' : 'none', flexDirection: 'column', gap: 2 }}>
            {more.map(item => button(item, { indent: !iconsOnly, number: numberOf(item) }))}
          </div>
        </>
      )}
      <div style={{ marginTop: 'auto' }} />
      {footer.length > 0 && (
        <div role="group" aria-label="Footer screens" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {footer.map(item => button(item, { number: numberOf(item) }))}
        </div>
      )}
      {status}
      {button(SETTINGS_NAV)}
    </nav>
  )
}

const Dot = () => (
  <span aria-hidden="true" style={{
    position: 'absolute', top: 4, right: 4, width: 8, height: 8,
    background: 'var(--accent)', borderRadius: '50%',
  }} />
)

const Count = ({ n }) => (
  <span style={{
    marginLeft: 'auto', minWidth: 18, height: 18,
    background: 'var(--accent)', color: 'var(--on-accent)',
    borderRadius: 9, fontSize: 11, fontWeight: 700,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: '0 5px',
  }}>
    {n > 99 ? '99+' : n}
  </span>
)
