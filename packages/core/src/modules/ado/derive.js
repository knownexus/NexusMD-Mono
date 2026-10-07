import { slugify, PROJECT_COLORS, isTerminalState, isActiveState, isReviewState } from './helpers.js'
import { displayIdOf } from '../workitems/ids.js'

export function deriveProjects(items, configProjects = []) {
  const seen = new Map()
  items.forEach(w => { const id = slugify(w.project); seen.set(id, (seen.get(id) || 0) + 1) })
  configProjects.forEach(name => { const id = slugify(name); if (!seen.has(id)) seen.set(id, 0) })
  let i = 0
  return Array.from(seen.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => {
      const cfgName = configProjects.find(n => slugify(n) === id)
      const name = cfgName || id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      return { id, name, color: PROJECT_COLORS[i++ % PROJECT_COLORS.length] }
    })
}

export function deriveSprint(wis, iterMeta) {
  const iterPath = iterMeta?.path || null
  const sprint = iterPath
    ? wis.filter(w => (w.iterationPath || '').toLowerCase() === iterPath.toLowerCase())
    : wis.filter(w => w.sprint)

  const total  = sprint.reduce((s, w) => s + (w.points || 0), 0)
  const done   = sprint.filter(w => isTerminalState(w.state)).reduce((s, w) => s + (w.points || 0), 0)
  const prog   = sprint.filter(w => isActiveState(w.state)).reduce((s, w)   => s + (w.points || 0), 0)
  const review = sprint.filter(w => isReviewState(w.state)).reduce((s, w)   => s + (w.points || 0), 0)

  const startDate = iterMeta?.startDate || null
  const endDate   = iterMeta?.endDate   || null
  const daysLeft  = endDate
    ? Math.max(0, Math.ceil((new Date(endDate).getTime() + 86_400_000 - Date.now()) / 86_400_000))
    : 0

  let burndown = []
  if (startDate && endDate) {
    const start = new Date(startDate).getTime()
    const end   = new Date(endDate).getTime()
    const totalDays = Math.ceil((end - start) / 86_400_000)
    for (let d = 0; d <= totalDays; d++) {
      const dayEnd = start + d * 86_400_000
      const pts = sprint
        .filter(w => isTerminalState(w.state) && w.changedMs && w.changedMs <= dayEnd)
        .reduce((s, w) => s + (w.points || 0), 0)
      burndown.push(pts)
    }
  }

  const fmt = iso => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'
  return {
    name: iterMeta?.name || 'Current Sprint',
    start: fmt(startDate), end: fmt(endDate),
    startISO: startDate, endISO: endDate,
    daysLeft, totalPoints: total || 1,
    donePoints: done, inProgPoints: prog, reviewPoints: review,
    burndown,
  }
}

export function deriveActivity(wis) {
  const parseAge = s => {
    if (!s || s === '—') return Infinity
    const n = parseInt(s)
    if (s.endsWith('m')) return n
    if (s.endsWith('h')) return n * 60
    return n * 1440
  }
  // Jira items (merged in by workitems/merge.js) carry a status category and a key;
  // ADO items keep the name-based terminal check and their "#id" label.
  const isJira = w => w.source === 'jira'
  const isDone = w => (isJira(w) ? isTerminalState(w.state, w.stateCategory) : isTerminalState(w.state))
  // Jira backlog items (To Do, Shortlist…) are assigned but nobody "is working on" them.
  const isJiraBacklog = w => isJira(w) && w.stateCategory === 'Proposed'
  return wis
    .filter(w => !isDone(w) && !isJiraBacklog(w) && w.assignee)
    .sort((a, b) => parseAge(a.updated) - parseAge(b.updated))
    .slice(0, 10)
    .map(w => {
      const title = w.title || ''
      const label = isJira(w) ? displayIdOf(w) : `#${w.id}`
      return {
        id: w.id,
        who: w.assignee,
        action: 'is working on',
        what: `${label} ${title.slice(0, 50)}${title.length > 50 ? '…' : ''}`,
        when: w.updated,
      }
    })
}

export function derivePrSparkline(prs) {
  const buckets = Array(10).fill(0)
  prs.filter(p => p.status === 'active').forEach(p => {
    const age = p.age || ''
    let days = age.endsWith('d') ? parseInt(age, 10) || 0 : 0
    buckets[Math.max(0, Math.min(days, 9))]++
  })
  return buckets
}
