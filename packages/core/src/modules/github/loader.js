import { core } from '../../core.js'
import { slugify, PROJECT_COLORS } from '../ado/helpers.js'
import { makeGithubClient } from './client.js'
import { mapGithubIssue, mapGithubPR, mapGithubRun } from './mappers.js'
import { extractIssueRefs } from './links.js'

export const GITHUB_CACHE_KEY = 'nexusmd.github.cache.v1'

const STATES = ['Open', 'Closed']
const CLOSED_WINDOW_DAYS = 14
const PR_LIMIT = 100
const PR_CONCURRENCY = 6

// Runs fn over items with at most `limit` in flight; results keep input order.
async function mapPool(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]) }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export function loadCachedGithubData(config, { storage }) {
  try {
    const raw = storage.get(GITHUB_CACHE_KEY)
    if (!raw) return null
    const c = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!c || !Array.isArray(c.WORK_ITEMS)) return null
    return c
  } catch (_) { return null }
}

export async function loadGithubData(
  config,
  { http, storage },
  // `skip` leaves out what a switched-off screen would show: { workItems, prs, builds }.
  // Skipped parts come back empty and nothing is requested from GitHub for them.
  { isRefresh = false, priorData = null, skip = {} } = {},
) {
  if (!http) throw new Error('loadGithubData: http adapter is required')
  const repos = Array.isArray(config?.repos) ? config.repos : []
  const client = makeGithubClient(http)

  // Per-repo error bookkeeping. A repo "fails" only if none of its calls succeeded.
  const repoErrors = []
  const okRepos = new Set()
  const firstErrorByRepo = new Map()
  const noteError = (repo, e) => {
    const kind = e?.kind || 'other'
    const message = String(e?.message || e || 'unknown error')
    if (!repoErrors.some(x => x.repo === repo && x.kind === kind && x.message === message)) {
      repoErrors.push({ repo, kind, message })
    }
    if (!firstErrorByRepo.has(repo)) firstErrorByRepo.set(repo, e)
  }
  const prErrors = []

  const meP = !isRefresh
    ? client.get('user').catch(() => null)
    : Promise.resolve(null)

  const since = new Date(Date.now() - CLOSED_WINDOW_DAYS * 86_400_000).toISOString()
  const people = new Map()
  const notePerson = (u) => {
    if (u?.login && !people.has(u.login)) people.set(u.login, { login: u.login, avatarUrl: u.avatar_url || '' })
  }

  async function loadIssues(repo) {
    try {
      // `since` filters on updated_at, so it must not apply to open issues.
      const [open, closed] = await Promise.all([
        client.getPaged(`repos/${repo}/issues?state=open&per_page=100`),
        client.getPaged(`repos/${repo}/issues?state=closed&since=${encodeURIComponent(since)}&per_page=100`),
      ])
      okRepos.add(repo)
      return [...open, ...closed].filter(i => !i.pull_request).map(i => {
        notePerson(i.assignee || i.assignees?.[0])
        return mapGithubIssue(i, repo)
      })
    } catch (e) { noteError(repo, e); return [] }
  }

  async function loadPrs(repo) {
    let list
    try {
      list = await client.getPaged(`repos/${repo}/pulls?state=open&per_page=100`, { max: PR_LIMIT })
      okRepos.add(repo)
    } catch (e) { noteError(repo, e); prErrors.push(e); return [] }
    return mapPool(list.slice(0, PR_LIMIT), PR_CONCURRENCY, async (p) => {
      const n = p.number
      // Sequential per PR so the pool bounds the calls in flight at PR_CONCURRENCY.
      const detail = await client.get(`repos/${repo}/pulls/${n}`).catch(() => null)
      const reviews = await client.getPaged(`repos/${repo}/pulls/${n}/reviews?per_page=100`, { max: 100 }).catch(() => [])
      const merged = { ...p, ...(detail || {}) }
      notePerson(merged.user)
      ;(reviews || []).forEach(r => notePerson(r.user))
      const mapped = mapGithubPR(merged, repo, { reviews })
      mapped.linkedWorkItems = extractIssueRefs(`${merged.title || ''}\n${merged.body || ''}`, repo, repos)
        .map(id => ({ id }))
      return mapped
    })
  }

  async function loadRuns(repo) {
    try {
      const r = await client.get(`repos/${repo}/actions/runs?per_page=15`)
      okRepos.add(repo)
      return (r?.workflow_runs || []).map(run => mapGithubRun(run, repo))
    } catch (e) { noteError(repo, e); return [] }
  }

  const perRepo = await Promise.all(repos.map(async (repo) => {
    const [items, prs, builds] = await Promise.all([
      skip.workItems ? [] : loadIssues(repo),
      skip.prs ? [] : loadPrs(repo),
      skip.builds ? [] : loadRuns(repo),
    ])
    return { items, prs, builds }
  }))
  const meData = await meP

  // Every repo failed with an auth error: surface it so the provider records an error.
  const attempted = !(skip.workItems && skip.prs && skip.builds)
  if (attempted && repos.length > 0) {
    const allAuth = repos.every(r => !okRepos.has(r) && firstErrorByRepo.get(r)?.kind === 'auth')
    if (allAuth) throw firstErrorByRepo.get(repos[0])
  }

  const WORK_ITEMS = perRepo.flatMap(r => r.items)
  const PRS = perRepo.flatMap(r => r.prs)
  const BUILDS = perRepo.flatMap(r => r.builds).sort((a, b) =>
    (b.finishTime ? new Date(b.finishTime).getTime() : 0) - (a.finishTime ? new Date(a.finishTime).getTime() : 0))

  const linkCount = new Map()
  PRS.forEach(p => (p.linkedWorkItems || []).forEach(l => linkCount.set(l.id, (linkCount.get(l.id) || 0) + 1)))
  WORK_ITEMS.forEach(w => { w.prs = linkCount.get(w.id) || 0 })

  const me = isRefresh
    ? (priorData?.ME || { login: config?.login || '', name: config?.login || '', avatarUrl: '' })
    : {
        login: meData?.login || config?.login || '',
        name: meData?.name || meData?.login || config?.login || '',
        avatarUrl: meData?.avatar_url || '',
      }
  notePerson({ login: me.login, avatar_url: me.avatarUrl })

  const typeNames = Array.from(new Set(WORK_ITEMS.map(w => w.type))).sort()
  const wiTypeStates = {}
  typeNames.forEach(t => { wiTypeStates[t] = STATES.slice() })

  const milestones = new Map()
  ;(skip.workItems ? [] : WORK_ITEMS).forEach(w => {
    if (!w.iterationPath) return
    const k = `${w.projectKey}|${w.iterationPath}`
    if (!milestones.has(k)) milestones.set(k, { repo: w.projectKey, title: w.iterationPath, state: w.sprint ? 'open' : 'closed' })
  })

  const PROJECTS = repos.map((r, i) => ({
    id: slugify(r), name: r, key: r, source: 'github', color: PROJECT_COLORS[i % PROJECT_COLORS.length],
  }))

  const prFailed = prErrors.length > 0 && PRS.length === 0
  const PR_ERROR = prFailed ? `PRs unavailable — ${String(prErrors[0]?.message || prErrors[0]).slice(0, 200)}` : null

  const data = {
    ME: me,
    PEOPLE: Array.from(people.values()),
    PROJECTS,
    REPOS: repos.slice(),
    STATES: STATES.slice(),
    TYPES: typeNames,
    WI_TYPE_STATES: wiTypeStates,
    MILESTONES: Array.from(milestones.values()),
    WORK_ITEMS,
    PRS,
    BUILDS,
    PR_ERROR,
    REPO_ERRORS: repoErrors,
    loaded: true,
    configured: true,
  }

  if (storage) {
    try { storage.set(GITHUB_CACHE_KEY, data) } catch (_) {}
  }

  core._emit(isRefresh ? 'github:updated' : 'github:loaded', data)
  return data
}
