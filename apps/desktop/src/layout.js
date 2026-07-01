// Sidebar auto-collapse logic. Below the breakpoint the rail forces icon-only
// mode regardless of the user's saved preference; at or above it, the saved
// preference wins. Pure so it can be unit-tested independently of React.
export const SIDEBAR_BREAKPOINT = 1024
export const ICON_RAIL_WIDTH = 56

export function effectiveSidebar(width, pref, breakpoint = SIDEBAR_BREAKPOINT) {
  return width < breakpoint ? 'icons' : (pref || 'labels')
}
