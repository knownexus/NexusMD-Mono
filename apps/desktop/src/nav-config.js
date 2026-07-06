// Pure sidebar nav configuration, extracted from main.jsx (which renders and
// starts sync at import, so it can't be imported by tests). Settings is kept OUT
// of the reorderable NAV and pinned separately at the sidebar bottom.
export const NAV = [
  { id: 'dashboard', label: 'Dashboard',     icon: 'dashboard' },
  { id: 'calendar',  label: 'Calendar',      icon: 'clock' },
  { id: 'work',      label: 'Work Items',    icon: 'work' },
  { id: 'prs',       label: 'Pull Requests', icon: 'pr' },
  { id: 'builds',    label: 'Builds',        icon: 'build' },
  { id: 'tests',     label: 'Tests',         icon: 'check' },
  { id: 'team',      label: 'Team',          icon: 'team' },
  { id: 'triage',    label: 'Triage',        icon: 'work' },
  { id: 'planner',   label: 'Planner',       icon: 'planner' },
  { id: 'notes',     label: 'Notes',         icon: 'pin' },
  { id: 'markdown',  label: 'Documents',     icon: 'pin' },
]

export const SETTINGS_NAV = { id: 'settings', label: 'Settings', icon: 'settings' }

export const ALL_NAV = [...NAV, SETTINGS_NAV]

export const DEFAULT_NAV_ORDER = NAV.map(n => n.id)
