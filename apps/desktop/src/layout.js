// Sidebar auto-collapse logic. Below the breakpoint the rail forces icon-only
// mode regardless of the user's saved preference; at or above it, the saved
// preference wins. Pure so it can be unit-tested independently of React.
export const SIDEBAR_BREAKPOINT = 1024
export const ICON_RAIL_WIDTH = 56

export function effectiveSidebar(width, pref, breakpoint = SIDEBAR_BREAKPOINT) {
  return width < breakpoint ? 'icons' : (pref || 'labels')
}

// Views that stay mounted (hidden) after the first visit, so leaving them keeps their state —
// the Database screen's open connection, query and results live only in its component.
export const KEEP_ALIVE_VIEWS = new Set(['db-manager'])

// The views to render: every kept-alive view visited so far (shown only when current), plus the
// current view. Visit order is kept so a kept view's place in the tree never moves.
export function mountedViews(visited, view, keepAlive = KEEP_ALIVE_VIEWS) {
  const kept = visited.filter(id => keepAlive.has(id))
  return kept.includes(view) ? kept : [...kept, view]
}

// The saved preference after the collapse/expand toggle (a missing preference means labels).
export const toggledSidebar = pref => (pref === 'icons' ? 'labels' : 'icons')

// Resolve the sidebar's nav order from a stored id list, tolerating drift:
// items are returned in navOrder sequence, any nav items missing from the
// stored order are appended (so newly added nav entries still appear), and
// stored ids no longer in nav are dropped. Pure, for unit testing.
export function orderedNav(navOrder, nav) {
  const order = Array.isArray(navOrder) ? navOrder : []
  const byId = new Map(nav.map(item => [item.id, item]))
  const ordered = order.map(id => byId.get(id)).filter(Boolean)
  const seen = new Set(ordered.map(item => item.id))
  const rest = nav.filter(item => !seen.has(item.id))
  return [...ordered, ...rest]
}

// The stored order after the user reorders the entries shown (`shownIds`, in their new sequence).
// Ids of apps that are not installed stay where they were, so installing one later finds its place.
export function mergeNavOrder(stored, shownIds) {
  const shown = new Set(shownIds)
  const queue = shownIds.slice()
  const merged = (Array.isArray(stored) ? stored : []).map(id => (shown.has(id) ? queue.shift() : id))
  return [...merged, ...queue]
}

// The entries the sidebar shows: orderedNav without the ids the user hid in Settings. A hidden entry
// stays in the Settings list (so it can be shown again) and is still reachable by view id.
export function visibleNav(navOrder, hidden, nav) {
  const gone = new Set(Array.isArray(hidden) ? hidden : [])
  return orderedNav(navOrder, nav).filter(item => !gone.has(item.id))
}

// Whether the window drops its sidebar: only one app is installed and it has a single screen, so there
// is nothing to switch between (an app with several screens, like Work, keeps its sidebar).
export function isBareStandalone(mode, navCount) {
  return mode === 'standalone' && navCount === 1
}
