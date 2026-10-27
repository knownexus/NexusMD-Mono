import { core } from '../../core.js'
import { slugify, timeAgo, isTerminalState, STATES } from './helpers.js'
import { mapWorkItem, mapPR, mapBuild, mapTestBuild } from './mappers.js'
import { deriveProjects, deriveSprint, deriveActivity, derivePrSparkline } from './derive.js'
import { fetchAdoProcessMetadata } from './process-metadata.js'

export const ADO_CACHE_KEY = 'nexusmd.ado.cache.v1'

export function loadCachedAdoData(config, { storage }) {
  try {
    const raw = storage.get(ADO_CACHE_KEY)
    if (!raw) return null
    const c = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!c || !Array.isArray(c.WORK_ITEMS)) return null
    if (c.ORG && config.org && c.ORG !== config.org) return null
    return c
  } catch (_) { return null }
}

export async function loadAdoData(
  config,
  { http, storage },
  // `skip` leaves out what a switched-off Work screen would show: { prs, builds, tests }. Those come
  // back empty, and nothing is asked of Azure DevOps for them.
  { isRefresh = false, priorData = null, skip = {} } = {},
) {
  if (!config?.org) throw new Error('loadAdoData: config.org is required')
  if (!http) throw new Error('loadAdoData: http adapter is required')

  const { org, projects: cfgProjects = [], testProject, uatBranch = '', refreshSecs = 30 } = config
  const testProj = testProject || cfgProjects[0] || ''

  async function get(path) {
    const res = await http.fetch(path, { method: 'GET' })
    if (!res.ok) throw new Error(`ADO GET ${path} → ${res.status}`)
    return res.json()
  }
  async function post(path, body) {
    const res = await http.fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`ADO POST ${path} → ${res.status}`)
    return res.json()
  }

  // ── Parallel fetches ───────────────────────────────────────────────────────
  const meP = !isRefresh
    ? get('_apis/connectionData?api-version=5.1').catch(() => null)
    : Promise.resolve(null)

  const teamP = !isRefresh
    ? (async () => {
        const names = new Set()
        await Promise.all(cfgProjects.map(async proj => {
          try {
            const t = await get(`_apis/projects/${encodeURIComponent(proj)}/teams?api-version=7.0-preview.3&$top=100`)
            await Promise.all((t.value || []).map(async team => {
              try {
                const m = await get(`_apis/projects/${encodeURIComponent(proj)}/teams/${team.id}/members?api-version=7.0-preview.2&$top=500`)
                ;(m.value || []).forEach(mem => { const n = mem.identity?.displayName || mem.displayName; if (n) names.add(n) })
              } catch (_) {}
            }))
          } catch (_) {}
        }))
        return Array.from(names)
      })()
    : Promise.resolve(null)

  const metaP = !isRefresh
    ? fetchAdoProcessMetadata(get, cfgProjects).catch(() => null)
    : Promise.resolve(priorData?._adoMeta || null)

  const FALLBACK_TERMINAL_STATES = ['Done', 'Closed', 'Resolved', 'Completed', 'Removed']
  const FALLBACK_DONE_STATES = ['Done', 'Closed', 'Resolved', 'Completed']
  const wiqlStateList = (names) => names.map(s => `'${String(s).replace(/'/g, "''")}'`).join(',')

  const wiP = metaP.then(async (meta) => {
    const terminalNames = meta?.terminalStateNames?.length ? meta.terminalStateNames : FALLBACK_TERMINAL_STATES
    const notInClause = wiqlStateList(terminalNames)
    const all = []
    await Promise.all(cfgProjects.map(async proj => {
      try {
        const wiql = await post(`${encodeURIComponent(proj)}/_apis/wit/wiql?api-version=7.0&$top=300`, {
          query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.State] NOT IN (${notInClause}) ORDER BY [System.ChangedDate] DESC`,
        })
        const ids = (wiql.workItems || []).slice(0, 300).map(w => w.id)
        if (!ids.length) return
        const fields = 'System.Id,System.Title,System.WorkItemType,System.State,System.AssignedTo,System.ChangedDate,System.CreatedDate,System.Tags,System.IterationPath,System.AreaPath,Custom.Area,Microsoft.VSTS.Common.Priority,Microsoft.VSTS.Scheduling.StoryPoints,System.CommentCount'
        const batches = []
        for (let i = 0; i < ids.length; i += 200) batches.push(ids.slice(i, i + 200))
        await Promise.all(batches.map(async batch => {
          try {
            const r = await get(`_apis/wit/workitems?ids=${batch.join(',')}&fields=${encodeURIComponent(fields)}&api-version=7.0`)
            ;(r.value || []).forEach(wi => all.push(wi))
          } catch (_) {}
        }))
      } catch (_) {}
    }))
    return all
  })

  const sprintP = !isRefresh && cfgProjects.length
    ? get(`${encodeURIComponent(cfgProjects[0])}/_apis/work/teamsettings/iterations?$timeframe=current&api-version=7.0`).catch(() => null)
    : Promise.resolve(null)

  // The first repositories / PR-list failure, surfaced as PR_ERROR when no PRs
  // load at all (e.g. a PAT without Code (Read) scope) instead of an empty list.
  let prError = null
  let repoCount = 0
  const notePrError = (e) => { if (!prError) prError = e }
  const prsP = skip.prs ? Promise.resolve([]) : (async () => {
    const all = []
    await Promise.all(cfgProjects.map(async proj => {
      try {
        const repos = await get(`${encodeURIComponent(proj)}/_apis/git/repositories?api-version=7.0`)
        repoCount += (repos.value || []).length
        await Promise.all((repos.value || []).map(async repo => {
          try {
            const r = await get(`${encodeURIComponent(proj)}/_apis/git/repositories/${repo.id}/pullrequests?searchCriteria.status=active&$top=100&api-version=7.0`)
            ;(r.value || []).forEach(pr => all.push({
              id: pr.pullRequestId, title: pr.title,
              repoName: repo.name, repo: repo.name, repoId: repo.id, project: proj,
              author: pr.createdBy?.displayName || '',
              sourceBranch: pr.sourceRefName || '', targetBranch: pr.targetRefName || '',
              status: pr.status, isDraft: pr.isDraft, created: pr.creationDate,
              lastActivity: pr.lastMergeCommit?.commitId || null,
              reviewers: (pr.reviewers || []).map(r => ({ name: r.displayName, vote: r.vote, uniqueName: r.uniqueName })),
              commentCount: pr.commentCount || 0,
              hasConflicts: pr.mergeStatus === 'conflicts',
              description: pr.description || '',
              // ADO's PR *list* endpoint often omits _links, so fall back to a
              // deterministic web URL built from org/project/repo/id.
              url: pr._links?.web?.href
                || `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(proj)}/_git/${encodeURIComponent(repo.name)}/pullrequest/${pr.pullRequestId}`,
            }))
          } catch (e) { notePrError(e) }
        }))
      } catch (e) { notePrError(e) }
    }))
    // Populate PR↔work-item links (one lightweight call per active PR).
    await Promise.all(all.map(async pr => {
      try {
        const w = await get(`${encodeURIComponent(pr.project)}/_apis/git/repositories/${pr.repoId}/pullRequests/${pr.id}/workitems?api-version=7.0`)
        pr.linkedWorkItems = (w.value || [])
          .map(x => ({ id: Number(x.id) }))
          .filter(x => Number.isFinite(x.id))
      } catch (_) {
        pr.linkedWorkItems = []
      }
    }))
    return all
  })()

  const buildsP = skip.builds ? Promise.resolve([]) : (async () => {
    const all = []
    await Promise.all(cfgProjects.map(async proj => {
      try {
        const r = await get(`${encodeURIComponent(proj)}/_apis/build/builds?$top=15&queryOrder=finishTimeDescending&api-version=7.0`)
        ;(r.value || []).forEach(b => all.push({ ...b, _project: proj }))
      } catch (_) {}
    }))
    return all
  })()

  const testBuildsP = testProj && !skip.tests
    ? get(`${encodeURIComponent(testProj)}/_apis/build/builds?api-version=7.0&$top=40&queryOrder=queueTimeDescending`).catch(() => null)
    : Promise.resolve(null)

  const testRunsP = testBuildsP.then(bj => {
    const ids = (bj?.value || []).map(b => b.id).filter(Boolean).join(',')
    if (!ids) return null
    return get(`${encodeURIComponent(testProj)}/_apis/test/runs?buildIds=${encodeURIComponent(ids)}&api-version=7.0&includeRunDetails=true`).catch(() => null)
  })

  const summaryP = metaP.then(async (meta) => {
    try {
      const doneNames = meta?.doneStateNames?.length ? meta.doneStateNames : FALLBACK_DONE_STATES
      const inClause = wiqlStateList(doneNames)
      const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
      const all = []
      await Promise.all(cfgProjects.map(async proj => {
        try {
          const wiql = await post(`${encodeURIComponent(proj)}/_apis/wit/wiql?api-version=7.0`, {
            query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.State] IN (${inClause}) AND [System.ChangedDate] >= '${cutoff}' ORDER BY [System.ChangedDate] DESC`,
          })
          const ids = (wiql.workItems || []).slice(0, 100).map(w => w.id)
          if (!ids.length) return
          const r = await get(`_apis/wit/workitems?ids=${ids.join(',')}&fields=System.Id,System.Title,System.WorkItemType,System.State,System.CreatedDate,Microsoft.VSTS.Common.ClosedDate&api-version=7.0`)
          ;(r.value || []).forEach(wi => all.push(wi))
        } catch (_) {}
      }))
      const items = all.map(wi => ({
        id: wi.id,
        title:       wi.fields?.['System.Title']        || '',
        type:        wi.fields?.['System.WorkItemType']  || '',
        state:       wi.fields?.['System.State']         || '',
        createdDate: wi.fields?.['System.CreatedDate']   || null,
        closedDate:  wi.fields?.['Microsoft.VSTS.Common.ClosedDate'] || wi.fields?.['System.ChangedDate'] || null,
      })).slice(0, 15)
      const durations = items
        .filter(i => i.createdDate && i.closedDate)
        .map(i => (new Date(i.closedDate) - new Date(i.createdDate)) / 86_400_000)
      return {
        resolvedWorkItems: items,
        avgResolutionDays: durations.length
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length * 10) / 10
          : null,
      }
    } catch (_) { return null }
  })

  // ── Await ──────────────────────────────────────────────────────────────────
  const [teamNames, meData, wiRaw, sprintResult, prsRaw, buildsRaw, testBuildsResult, testRunsResult, summaryResult, meta] =
    await Promise.all([teamP, meP, wiP, sprintP, prsP, buildsP, testBuildsP, testRunsP, summaryP, metaP])

  // ── Team ──────────────────────────────────────────────────────────────────
  const makeMember = (name, prefix, i) => {
    const parts = name.trim().split(' ')
    const first = parts[0] || '', last = parts[parts.length - 1] || ''
    const initials = ((first[0] || '') + (last[0] || first[1] || '')).toUpperCase() || '?'
    return { id: slugify(name) || `${prefix}${i}`, name, displayName: name, role: 'Developer', initials, tz: 'UTC', focus: 'Working…' }
  }

  const helmTeam = !isRefresh
    ? (teamNames || []).filter(Boolean).map((name, i) => makeMember(name, 'dev', i))
    : (priorData?.TEAM || []).map(t => ({ ...t }))

  // Supplement with assignees / PR participants present in the current data that
  // aren't in the team yet. Runs on refresh too, so someone newly assigned after
  // the last full load still resolves to a real member (mappers.js maps by name)
  // instead of collapsing to Unassigned.
  const addMember = (n, prefix) => {
    if (!n || helmTeam.find(t => t.name === n)) return
    helmTeam.push(makeMember(n, prefix, helmTeam.length))
  }
  ;(wiRaw || []).forEach(wi => {
    const a = (wi.fields || wi)['System.AssignedTo']
    addMember(typeof a === 'string' ? a : (a?.displayName || null), 'wi-dev')
  })
  ;(prsRaw || []).forEach(pr => {
    addMember(pr.author, 'pr-dev')
    ;(pr.reviewers || []).forEach(r => addMember(r.name, 'pr-dev'))
  })

  const nameToId = {}
  helmTeam.forEach(t => { nameToId[t.name] = t.id })

  // ── Me ────────────────────────────────────────────────────────────────────
  let me
  if (!isRefresh) {
    const meName0 = meData?.authenticatedUser?.providerDisplayName
      || meData?.authenticatedUser?.customDisplayName
      || meData?.authenticatedUser?.subjectDescriptor
      || org || 'Me'
    me = {
      id: 'me', name: meName0, role: 'Eng Manager',
      initials: (meName0.split(' ').map(w => w[0] || '').join('') || 'ME').slice(0, 2).toUpperCase(),
      adoId: meData?.authenticatedUser?.id || '',
      email: meData?.authenticatedUser?.properties?.Account?.$value || '',
      org,
    }
  } else {
    me = priorData?.ME || { id: 'me', name: org, role: 'Eng Manager', initials: 'ME', org }
  }

  // ── Work items ────────────────────────────────────────────────────────────
  const helmWIs = []
  ;(wiRaw || []).forEach(wi => { try { helmWIs.push(mapWorkItem(wi, nameToId, meta?.stateCategoryByName)) } catch (_) {} })

  helmTeam.forEach(member => {
    const assigned = helmWIs.filter(w => w.assignee === member.id && !isTerminalState(w.state, w.adoStateCategory))
    member.assignedCount = assigned.length
    const latest = assigned.reduce((best, w) => (!best || (w.changedMs && w.changedMs > (best.changedMs || 0))) ? w : best, null)
    member.lastActiveAgo = (latest?.changedMs) ? timeAgo(new Date(latest.changedMs).toISOString()) : '—'
  })

  // ── Sprint ────────────────────────────────────────────────────────────────
  let iterMeta = isRefresh ? (priorData?._iterMeta || null) : null
  if (!isRefresh && sprintResult) {
    const candidates = (sprintResult.value || sprintResult.iterations || []).filter(Boolean)
    iterMeta = candidates.length === 1
      ? candidates[0]
      : candidates.reduce((best, cand) => {
          const count     = helmWIs.filter(w => (w.iterationPath || '').toLowerCase() === (cand.path || '').toLowerCase()).length
          const bestCount = helmWIs.filter(w => (w.iterationPath || '').toLowerCase() === (best?.path || '').toLowerCase()).length
          return count > bestCount ? cand : best
        }, candidates[0] || null)
  }

  // ── PRs ───────────────────────────────────────────────────────────────────
  const prErrorMessage = (e) => String(e?.message || e || 'unknown error')
  const describePrError = (e) => {
    const msg = prErrorMessage(e)
    const auth = msg.match(/ (401|403)\b/)
    if (auth) return `PRs unavailable (HTTP ${auth[1]}) — check the ADO PAT has Code (Read) scope`
    const status = msg.match(/→ (\d{3})/)
    return status ? `PRs unavailable (HTTP ${status[1]})` : `PRs unavailable — ${msg.slice(0, 200)}`
  }
  const prFailed = !!prError && !(prsRaw || []).length
  // ADO security-trims instead of returning 401 when Code (Read) is missing, so a
  // token that sees zero repositories everywhere is reported rather than silent.
  const noRepos = !prError && cfgProjects.length > 0 && repoCount === 0
  const prErrorText = prFailed ? describePrError(prError)
    : noRepos ? 'No repositories visible to the ADO token — it probably lacks Code (Read) scope' : null
  const prErrorDetail = prFailed ? prErrorMessage(prError).slice(0, 500)
    : noRepos ? `All ${cfgProjects.length} configured project(s) returned 0 repositories` : null
  const helmPRs = []
  ;(prsRaw || []).filter(p => p.status === 'active').forEach(pr => {
    try { helmPRs.push(mapPR(pr, nameToId, me?.name || '')) } catch (_) {}
  })

  // ── Builds ────────────────────────────────────────────────────────────────
  // Sort newest-first so the view always shows the latest runs regardless of
  // status. No cap is applied; all builds returned by ADO are kept so the UI
  // can filter and group without losing data.
  const helmBuilds = (buildsRaw || [])
    .map(b => mapBuild(b, b._project || ''))
    .sort((a, b) => {
      const ta = a.finishTime ? new Date(a.finishTime).getTime() : 0
      const tb = b.finishTime ? new Date(b.finishTime).getTime() : 0
      return tb - ta
    })

  // ── Tests ─────────────────────────────────────────────────────────────────
  let helmTests = []
  if (testBuildsResult?.value) {
    const byBuild = {}
    ;(testRunsResult?.value || []).forEach(run => {
      const bid = run.build?.id; if (!bid) return
      if (!byBuild[bid]) byBuild[bid] = { total: 0, passed: 0, failed: 0 }
      byBuild[bid].total  += run.totalTests || 0
      byBuild[bid].passed += run.passedTests || 0
      byBuild[bid].failed += run.unanalyzedTests || run.failedTests || run.failed || 0
    })
    helmTests = testBuildsResult.value.map(b => mapTestBuild(b, testProj)).slice(0, 30).map(b => {
      const t = byBuild[b.id]
      return t ? { ...b, totalTests: t.total, passedTests: t.passed, failedTests: t.failed } : b
    })
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const resolvedWI = (summaryResult?.resolvedWorkItems || []).slice(0, 15)
  const avgResolutionDays = summaryResult?.avgResolutionDays ?? null

  // ── Assemble ──────────────────────────────────────────────────────────────
  const data = {
    ORG: org,
    TEAM: helmTeam.length > 0 ? helmTeam : (priorData?.TEAM || []),
    ME: me,
    PROJECTS: deriveProjects(helmWIs, cfgProjects),
    CONFIG_PROJECTS: cfgProjects.slice(),
    STATES: meta?.states?.length ? meta.states : STATES,
    TYPES: meta?.types || [],
    PRIORITIES: meta?.priorities || [],
    WI_TYPE_STATES: meta?.typeStates || {},
    WORK_ITEMS: helmWIs,
    PRS: helmPRs,
    PR_ERROR: prErrorText,
    PR_ERROR_DETAIL: prErrorDetail,
    BUILDS: helmBuilds,
    TESTS: helmTests,
    ACTIVITY: deriveActivity(helmWIs),
    PR_SPARKLINE: derivePrSparkline(helmPRs),
    SPRINT: deriveSprint(helmWIs, iterMeta),
    RESOLVED_WI: resolvedWI,
    AVG_RESOLUTION_DAYS: avgResolutionDays,
    REFRESH_SECS: refreshSecs,
    UAT_BRANCH: (uatBranch || '').replace(/^refs\/heads\//, ''),
    loaded: true,
    configured: true,
    _iterMeta: iterMeta,
    _testProject: testProj,
    _adoMeta: meta || null,
  }

  if (storage) {
    try { storage.set(ADO_CACHE_KEY, data) } catch (_) {}
  }

  core._emit(isRefresh ? 'ado:updated' : 'ado:loaded', data)
  return data
}
