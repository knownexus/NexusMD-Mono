import { describe, it, expect } from 'vitest'
import { buildDigest } from '../src/index.js'

// State helpers in core treat these as terminal/blocked (see ado/helpers.js).
const workItems = [
  { id: 1, state: 'Active',   priority: 1, assignee: 'alex-doe' },
  { id: 2, state: 'Blocked',  priority: 2, assignee: 'alex-doe' },
  { id: 3, state: 'Closed',   priority: 1, assignee: 'sam-roe' },
  { id: 4, state: 'New',      priority: 3, assignee: 'sam-roe' },
]
const prs = [
  { id: 10, status: 'active', author: 'alex-doe' },
  { id: 11, status: 'draft',  author: 'sam-roe' },
  { id: 12, status: 'completed', author: 'alex-doe' },
]
const builds = [
  { id: 20, status: 'failed' },
  { id: 21, status: 'running' },
  { id: 22, status: 'succeeded' },
]
const team = [
  { id: 'alex-doe', name: 'Alex Doe' },
  { id: 'sam-roe',  name: 'Sam Roe' },
]

describe('buildDigest', () => {
  it('returns zeroed counts for empty input', () => {
    expect(buildDigest()).toMatchObject({
      openCount: 0, blockedCount: 0, criticalCount: 0,
      activePrCount: 0, failedBuildCount: 0, runningBuildCount: 0,
      sprintName: null, sprintVelocity: null, teamMetrics: [],
    })
  })

  it('counts open (non-terminal) work items', () => {
    const d = buildDigest({ workItems })
    // Closed (id 3) is terminal → excluded; 1,2,4 open
    expect(d.openCount).toBe(3)
    expect(d.blockedCount).toBe(1)
    expect(d.criticalCount).toBe(1) // only open priority<=1 → id 1
  })

  it('counts active/draft PRs and build statuses', () => {
    const d = buildDigest({ prs, builds })
    expect(d.activePrCount).toBe(2)
    expect(d.failedBuildCount).toBe(1)
    expect(d.runningBuildCount).toBe(1)
  })

  it('passes through sprint name/velocity', () => {
    const d = buildDigest({ sprint: { name: 'Sprint 7', velocity: 42 } })
    expect(d.sprintName).toBe('Sprint 7')
    expect(d.sprintVelocity).toBe(42)
  })

  it('aggregates per-member team metrics', () => {
    const d = buildDigest({ workItems, prs, team })
    const alex = d.teamMetrics.find(m => m.id === 'alex-doe')
    expect(alex).toMatchObject({ openCount: 2, blockedCount: 1, prCount: 1 })
    const sam = d.teamMetrics.find(m => m.id === 'sam-roe')
    // sam authored PR 11 which is a draft — drafts count as active in the digest.
    expect(sam).toMatchObject({ openCount: 1, blockedCount: 0, prCount: 1 })
  })
})
