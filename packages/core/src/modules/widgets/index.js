// Home widgets: the pure configuration (no React). The render functions live in @nexusmd/ui (home-widgets.jsx).
export const WIDGET_PAGES = [
  ['dashboard', 'Home'], ['work', 'Work items'], ['pr', 'Pull requests'], ['builds', 'Builds'], ['tests', 'Tests'],
  ['calendar', 'Calendar'], ['planner', 'Planner'], ['lists', 'Lists'], ['time', 'Time'], ['notes', 'Notes'],
  ['triage', 'Triage'], ['team', 'Team'], ['markdown', 'Documents'], ['api', 'API Client'], ['editor', 'Editor'], ['git', 'Repos'],
]
export const pageLabel = (id) => (WIDGET_PAGES.find(p => p[0] === id) || [])[1] || id

const COUNT = { key: 'count', label: 'How many to show', kind: 'number', min: 1, max: 15 }

export const WIDGET_CONFIG_TYPES = {
  pr: {
    label: 'Pull requests', desc: 'A list of pull requests', page: 'pr', icon: 'pr',
    defaults: { filter: 'needsme', count: 5 },
    fields: [{ key: 'filter', label: 'Show', kind: 'select', options: [['needsme', 'Needs my review'], ['all', 'All'], ['drafts', 'Drafts']] }, COUNT],
    title: (c) => ({ needsme: 'Needs my review', all: 'Pull requests', drafts: 'Draft PRs' }[c.filter] || 'Pull requests'),
  },
  builds: { label: 'Builds', desc: 'The latest builds, with the newest up front', page: 'builds', icon: 'build', defaults: { count: 3 }, fields: [COUNT] },
  tests: { label: 'Test runs', desc: 'The latest test runs, with the newest up front', page: 'tests', icon: 'check-circle', defaults: { count: 3 }, fields: [COUNT] },
  repo: {
    label: 'Repo', desc: 'Jump straight into one repository', page: 'git', icon: 'git-branch', half: true,
    defaults: { repoId: '', repoName: '' }, needsRepo: true, fields: [],
    title: (c) => c.repoName || 'Repo',
  },
  mywork: { label: 'Assigned to me', desc: 'Your open work items', page: 'work', icon: 'work', defaults: { count: 5 }, fields: [COUNT] },
  calendar: { label: 'Today', desc: 'Today’s calendar events', page: 'calendar', icon: 'planner', defaults: { count: 5 }, fields: [COUNT] },
  planner: { label: 'Planner tasks', desc: 'Your open planner tasks', page: 'planner', icon: 'planner', defaults: { count: 5 }, fields: [COUNT] },
  lists: { label: 'Lists', desc: 'Your lists and their item counts', page: 'lists', icon: 'work', defaults: { count: 5 }, fields: [COUNT] },
  team: { label: 'Team', desc: 'Who is around', page: 'team', icon: 'team', defaults: { count: 5 }, fields: [COUNT] },
  time: { label: 'Time', desc: 'Start, pause, mark and stop timers', page: 'time', icon: 'clock', defaults: {}, fields: [] },
  notes: { label: 'Quick note', desc: 'Jot a note down', page: 'notes', icon: 'pin', defaults: {}, fields: [] },
  shortcut: {
    label: 'Shortcut', desc: 'A button that opens one page', icon: 'link', half: true,
    defaults: { to: 'triage' },
    fields: [{ key: 'to', label: 'Opens', kind: 'select', options: WIDGET_PAGES.filter(p => p[0] !== 'dashboard' && p[0] !== 'settings') }],
    title: (c) => pageLabel(c.to),
  },
}

export const newWidgetsAfterSave = (list, w) => (list.some(x => x.id === w.id) ? list.map(x => (x.id === w.id ? w : x)) : [...list, w])
