import { describe, it, expect } from 'vitest'
import { mapWorkItem, mapPR, mapBuild, mapTestBuild, mapBuildTimeline } from '../../src/modules/ado/mappers.js'

// ── mapWorkItem ───────────────────────────────────────────────────────────────

const rawWI = {
  id: 42,
  fields: {
    'System.Title': 'Fix login bug',
    'System.WorkItemType': 'Bug',
    'System.State': 'Active',
    'System.AssignedTo': { displayName: 'Alice Smith' },
    'System.ChangedDate': '2026-06-15T10:00:00Z',
    'System.IterationPath': 'MyProject\\Sprint 5',
    'System.AreaPath': 'MyProject\\Backend',
    'Microsoft.VSTS.Common.Priority': '2',
    'Microsoft.VSTS.Scheduling.StoryPoints': '3',
    'System.Tags': 'auth; security',
    'Custom.Area': 'Auth',
  },
}

describe('mapWorkItem', () => {
  it('maps id and title', () => {
    const wi = mapWorkItem(rawWI, {})
    expect(wi.id).toBe(42)
    expect(wi.title).toBe('Fix login bug')
  })
  it('maps type via adoTypeToHelm', () => {
    expect(mapWorkItem(rawWI, {}).type).toBe('bug')
  })
  it('maps state as-is (not converted — display uses raw ADO state)', () => {
    expect(mapWorkItem(rawWI, {}).state).toBe('Active')
  })
  it('resolves assignee id from nameToId map', () => {
    const wi = mapWorkItem(rawWI, { 'Alice Smith': 'alice-smith' })
    expect(wi.assignee).toBe('alice-smith')
  })
  it('returns null assignee when name not in nameToId', () => {
    const wi = mapWorkItem(rawWI, {})
    expect(wi.assignee).toBeNull()
  })
  it('extracts story points', () => {
    expect(mapWorkItem(rawWI, {}).points).toBe(3)
  })
  it('clamps priority between 1 and 4', () => {
    const hi = { ...rawWI, fields: { ...rawWI.fields, 'Microsoft.VSTS.Common.Priority': '0' } }
    expect(mapWorkItem(hi, {}).priority).toBe(1)
    const lo = { ...rawWI, fields: { ...rawWI.fields, 'Microsoft.VSTS.Common.Priority': '9' } }
    expect(mapWorkItem(lo, {}).priority).toBe(4)
  })
  it('splits tags by semicolon', () => {
    expect(mapWorkItem(rawWI, {}).tags).toEqual(['auth', 'security'])
  })
  it('maps System.CommentCount to comments', () => {
    const withComments = { ...rawWI, fields: { ...rawWI.fields, 'System.CommentCount': 4 } }
    expect(mapWorkItem(withComments, {}).comments).toBe(4)
  })
  it('defaults comments to 0 when CommentCount is absent', () => {
    expect(mapWorkItem(rawWI, {}).comments).toBe(0)
  })
  it('marks sprint=true when iterationPath contains "sprint"', () => {
    expect(mapWorkItem(rawWI, {}).sprint).toBe(true)
  })
  it('extracts project slug from areaPath', () => {
    expect(mapWorkItem(rawWI, {}).project).toBe('myproject')
  })
})

// ── mapPR ─────────────────────────────────────────────────────────────────────

const rawPR = {
  id: 101,
  title: 'Add auth middleware',
  repoName: 'api-repo',
  repoId: 'repo-uuid',
  project: 'MyProject',
  author: 'Alice Smith',
  sourceBranch: 'refs/heads/feature/auth',
  targetBranch: 'refs/heads/main',
  status: 'active',
  isDraft: false,
  created: '2026-06-10T09:00:00Z',
  reviewers: [
    { name: 'Bob Jones', vote: 10 },
    { name: 'Carol White', vote: 0 },
  ],
  commentCount: 3,
  hasConflicts: false,
  description: 'Adds JWT middleware',
  url: 'https://dev.azure.com/...',
}

describe('mapPR', () => {
  it('maps id and title', () => {
    const pr = mapPR(rawPR, {}, '')
    expect(pr.id).toBe(101)
    expect(pr.title).toBe('Add auth middleware')
  })
  it('strips refs/heads/ from branch names', () => {
    const pr = mapPR(rawPR, {}, '')
    expect(pr.sourceBranch).toBe('feature/auth')
    expect(pr.targetBranch).toBe('main')
  })
  it('counts approvals (vote 10 or 5)', () => {
    expect(mapPR(rawPR, {}, '').approvals).toBe(1)
  })
  it('needsMe is true when current user has vote=0', () => {
    const pr = mapPR(rawPR, {}, 'Carol White')
    expect(pr.needsMe).toBe(true)
  })
  it('needsMe is false when current user has approved', () => {
    const pr = mapPR(rawPR, {}, 'Bob Jones')
    expect(pr.needsMe).toBe(false)
  })
  it('marks draft for [WIP] title prefix', () => {
    const draft = { ...rawPR, title: '[WIP] Work in progress' }
    expect(mapPR(draft, {}, '').status).toBe('draft')
  })
  it('maps completed status to "merged"', () => {
    const merged = { ...rawPR, status: 'completed' }
    expect(mapPR(merged, {}, '').status).toBe('merged')
  })
})

// ── mapBuild ──────────────────────────────────────────────────────────────────

const rawBuild = {
  id: 500,
  result: 'failed',
  status: 'completed',
  definition: { name: 'CI Pipeline', id: 12 },
  sourceBranch: 'refs/heads/main',
  sourceVersion: 'abc1234def',
  requestedBy: { displayName: 'Alice Smith' },
  finishTime: '2026-06-15T08:00:00Z',
  reason: 'individualCI',
  statusDescription: 'Step "test" failed',
}

describe('mapBuild', () => {
  it('maps id and pipeline name', () => {
    const b = mapBuild(rawBuild, 'MyProject')
    expect(b.id).toBe(500)
    expect(b.pipeline).toBe('CI Pipeline')
  })
  it('maps failed result to "failed" status', () => {
    expect(mapBuild(rawBuild, 'MyProject').status).toBe('failed')
  })
  it('maps partiallySucceeded to "partial"', () => {
    const b = mapBuild({ ...rawBuild, result: 'partiallySucceeded' }, '')
    expect(b.status).toBe('partial')
  })
  it('maps inProgress status to "running"', () => {
    const b = mapBuild({ ...rawBuild, result: '', status: 'inProgress' }, '')
    expect(b.status).toBe('running')
  })
  it('strips refs/heads/ from branch', () => {
    expect(mapBuild(rawBuild, '').branch).toBe('main')
  })
  it('truncates commit to 7 chars', () => {
    expect(mapBuild(rawBuild, '').commit).toBe('abc1234')
  })
  it('includes failureReason only for failed/partial', () => {
    expect(mapBuild(rawBuild, '').failureReason).toBe('Step "test" failed')
    const ok = mapBuild({ ...rawBuild, result: 'succeeded' }, '')
    expect(ok.failureReason).toBeNull()
  })
})

// ── mapBuildTimeline ────────────────────────────────────────────────────────

const rawTimeline = {
  records: [
    { id: 'a', name: 'Build', type: 'Stage', result: 'failed', issues: [{ type: 'error', message: 'Package restore failed' }] },
    { id: 'b', name: 'Run tests', type: 'Task', result: 'failed', issues: [{ type: 'error', message: 'Test suite exited with code 1' }, { type: 'error', message: '2 tests failed' }] },
    { id: 'c', name: 'Checkout', type: 'Task', result: 'succeeded', issues: [] },
    { id: 'd', name: 'Some checkpoint', type: 'Checkpoint', result: 'failed', issues: [{ type: 'error', message: 'ignored type' }] },
    { id: 'e', name: 'No issues array', type: 'Task', result: 'failed' },
  ],
}

describe('mapBuildTimeline', () => {
  it('keeps only failed records of known types (Stage/Phase/Job/Task)', () => {
    const { failedRecords } = mapBuildTimeline(rawTimeline)
    expect(failedRecords.map(r => r.name)).toEqual(['Build', 'Run tests', 'No issues array'])
  })
  it('maps each record\'s issues to a flat messages array', () => {
    const { failedRecords } = mapBuildTimeline(rawTimeline)
    expect(failedRecords.find(r => r.name === 'Run tests').messages).toEqual([
      'Test suite exited with code 1', '2 tests failed',
    ])
  })
  it('defaults messages to an empty array when issues is missing', () => {
    const { failedRecords } = mapBuildTimeline(rawTimeline)
    expect(failedRecords.find(r => r.name === 'No issues array').messages).toEqual([])
  })
  it('returns an empty failedRecords array for an empty/missing records list', () => {
    expect(mapBuildTimeline({ records: [] })).toEqual({ failedRecords: [] })
    expect(mapBuildTimeline({})).toEqual({ failedRecords: [] })
  })
})

// ── mapTestBuild ──────────────────────────────────────────────────────────────

describe('mapTestBuild', () => {
  it('maps basic fields', () => {
    const b = mapTestBuild({ id: 1, definition: { name: 'Tests' }, result: 'succeeded', sourceBranch: 'refs/heads/main' }, 'proj')
    expect(b.id).toBe(1)
    expect(b.pipeline).toBe('Tests')
    expect(b.result).toBe('succeeded')
    expect(b.branch).toBe('main')
    expect(b.totalTests).toBeNull()
  })
})
