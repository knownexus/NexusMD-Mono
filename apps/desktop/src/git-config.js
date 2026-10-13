// Git Workspace settings (registered repos, groups, search roots, view state), per NexusMD profile.
import { getProfileKey } from './profile-keys.js'

const KEY = () => getProfileKey('git.config')
export const GIT_CONFIG_EVENT = 'nexusmd:git-config'
export const DEFAULT_ROOTS = Object.freeze(['C:/repos'])
export const DEFAULT_GIT_CONFIG = Object.freeze({
  version: 1, repos: [], groups: [], roots: null,
  view: Object.freeze({ group: 'All projects', collapsed: [], selected: null }),
})

const strings = v => Array.isArray(v) ? v.filter(x => typeof x === 'string') : []
const fresh = () => ({ ...DEFAULT_GIT_CONFIG, repos: [], groups: [], view: { ...DEFAULT_GIT_CONFIG.view, collapsed: [] } })

function normalise(saved) {
  const view = saved.view && typeof saved.view === 'object' ? saved.view : {}
  return {
    version: 1,
    repos: (Array.isArray(saved.repos) ? saved.repos : []).filter(r => r && typeof r.name === 'string' && typeof r.path === 'string').map(r => ({ name: r.name, path: r.path })),
    groups: (Array.isArray(saved.groups) ? saved.groups : []).filter(g => g && typeof g.name === 'string').map(g => ({
      name: g.name, repos: strings(g.repos), worktrees: strings(g.worktrees),
      branches: (Array.isArray(g.branches) ? g.branches : []).filter(b => b && typeof b.repo === 'string' && typeof b.ref === 'string').map(b => ({ repo: b.repo, ref: b.ref })),
    })),
    roots: saved.roots == null ? null : strings(saved.roots),
    view: {
      group: typeof view.group === 'string' ? view.group : DEFAULT_GIT_CONFIG.view.group,
      collapsed: strings(view.collapsed),
      selected: typeof view.selected === 'string' ? view.selected : null,
    },
  }
}

export function getGitConfig() {
  try {
    const raw = localStorage.getItem(KEY())
    const saved = raw ? JSON.parse(raw) : {}
    if (!saved || typeof saved !== 'object') return fresh()
    if (saved.version != null && saved.version !== 1) return { ...fresh(), unsupported: saved.version }
    return normalise(saved)
  } catch {
    return fresh()
  }
}

export function setGitConfig(patch) {
  const current = getGitConfig()
  if (current.unsupported != null) return current
  const next = { ...current, ...patch }
  delete next.unsupported
  try { localStorage.setItem(KEY(), JSON.stringify(next)) } catch {}
  window.dispatchEvent(new Event(GIT_CONFIG_EVENT))
  return next
}

export function effectiveRoots(config) {
  return config?.roots ?? [...DEFAULT_ROOTS]
}

const ABSOLUTE = /^([A-Za-z]:[\\/]|\\\\|\/)/

/** Splits a `;`-separated list of folders; relative entries are returned in `invalid`. */
export function parseRoots(text) {
  const roots = []
  const invalid = []
  for (const entry of String(text ?? '').split(';').map(s => s.trim()).filter(Boolean)) {
    if (!ABSOLUTE.test(entry)) invalid.push(entry)
    else if (!roots.some(r => r.toLowerCase() === entry.toLowerCase())) roots.push(entry)
  }
  return { roots, invalid }
}
