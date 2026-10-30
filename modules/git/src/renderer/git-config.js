// Git Workspace settings (registered repos, groups, search roots, view state), per NexusMD profile.
import { ALL_PROJECTS, LEGACY_ALL_PROJECTS } from '@nexusmd/core'
import { getProfileKey } from '@nexusmd/shell-sdk'

const KEY = () => getProfileKey('git.config')
export const GIT_CONFIG_EVENT = 'nexusmd:git-config'
export const DEFAULT_ROOTS = Object.freeze(['C:/repos'])
// Where the DotFiles repository is, for its PowerShell git shortcuts; an empty string turns them off.
export const DEFAULT_DOTFILES = 'C:/repos/DotFiles'
export const DEFAULT_GIT_CONFIG = Object.freeze({
  version: 1, repos: [], groups: [], roots: null, dotfiles: null,
  view: Object.freeze({ group: ALL_PROJECTS, collapsed: [], selected: null, split: 0.45, panel: 'changes', list: 'shown' }),
})

// The branch list's width: 330px unless dragged, never so narrow its rows are unreadable or so wide it
// squeezes out the changes beside it (the page also caps it at half its width, in view-git.jsx).
export const LIST_WIDTH = 330
export const clampListWidth = w => Math.round(Math.min(720, Math.max(220, w)))

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
    dotfiles: typeof saved.dotfiles === 'string' ? saved.dotfiles : null,
    view: {
      // The tab was called All projects before it was renamed.
      group: typeof view.group === 'string' && view.group !== LEGACY_ALL_PROJECTS ? view.group : DEFAULT_GIT_CONFIG.view.group,
      collapsed: strings(view.collapsed),
      selected: typeof view.selected === 'string' ? view.selected : null,
      split: typeof view.split === 'number' && view.split >= 0.2 && view.split <= 0.8 ? view.split : DEFAULT_GIT_CONFIG.view.split,
      panel: view.panel === 'history' || view.panel === 'files' ? view.panel : 'changes',
      list: view.list === 'hidden' ? 'hidden' : 'shown',
      // Where the History tab's divider was dragged to, and the branch list's width in pixels. Left out
      // when not set, so the screens use their own defaults. Anything not listed here is dropped on
      // read, which used to lose historySplit.
      ...(typeof view.historySplit === 'number' && view.historySplit >= 0.2 && view.historySplit <= 0.8 ? { historySplit: view.historySplit } : {}),
      ...(Number.isFinite(view.listWidth) ? { listWidth: clampListWidth(view.listWidth) } : {}),
      // The GitHub tab when it is the one showing (a group can't take its place, whatever it's
      // called), and the GitHub repository chosen in it.
      ...(view.tab === 'github' ? { tab: 'github' } : {}),
      ...(typeof view.githubRepo === 'string' ? { githubRepo: view.githubRepo } : {}),
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
const NETWORK = /^[\\/]{2}/

/**
 * Splits a `;`-separated list of folders. Relative entries come back in `invalid`;
 * UNC and device paths (`\\server\share`, `//server/share`, `\\?\…`) in `network`.
 */
export function parseRoots(text) {
  const roots = []
  const invalid = []
  const network = []
  for (const entry of String(text ?? '').split(';').map(s => s.trim()).filter(Boolean)) {
    if (NETWORK.test(entry)) { if (!network.includes(entry)) network.push(entry) }
    else if (!ABSOLUTE.test(entry)) invalid.push(entry)
    else if (!roots.some(r => r.toLowerCase() === entry.toLowerCase())) roots.push(entry)
  }
  return { roots, invalid, network }
}

export function effectiveDotfiles(config) {
  return config?.dotfiles ?? DEFAULT_DOTFILES
}
