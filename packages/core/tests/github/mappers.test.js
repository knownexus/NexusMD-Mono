import { describe, it, expect } from 'vitest'
import { mapGithubIssue, mapGithubPR, mapGithubRun, githubTypeFromLabels } from '../../src/modules/github/index.js'

const issue = (o = {}) => ({ number: 12, title: 'T', state: 'open', labels: [], assignee: null, comments: 3,
  html_url: 'https://github.com/acme/web/issues/12', updated_at: '2026-01-01T00:00:00Z', milestone: null, ...o })

describe('mapGithubIssue', () => {
  it('open unassigned issue', () => {
    const m = mapGithubIssue(issue(), 'acme/web')
    expect(m).toMatchObject({ id: 'gh:acme/web#12', displayId: 'acme/web#12', source: 'github', state: 'Open',
      stateCategory: 'Proposed', project: 'acme-web', projectKey: 'acme/web', projectName: 'acme/web',
      comments: 3, url: 'https://github.com/acme/web/issues/12', closeReason: null })
  })
  it('open assigned is InProgress', () => {
    const m = mapGithubIssue(issue({ assignee: { login: 'Bob' } }), 'acme/web')
    expect(m.stateCategory).toBe('InProgress')
    expect(m.assignee).toBe('bob')
  })
  it('closed passes close reason', () => {
    const m = mapGithubIssue(issue({ state: 'closed', state_reason: 'not_planned' }), 'acme/web')
    expect(m).toMatchObject({ state: 'Closed', stateCategory: 'Completed', closeReason: 'not_planned' })
  })
  it('labels drive type and tags', () => {
    const m = mapGithubIssue(issue({ labels: [{ name: 'bug' }, { name: 'p1' }] }), 'acme/web')
    expect(m.type).toBe('bug')
    expect(m.tags).toEqual(['bug', 'p1'])
  })
  it('native type beats label', () => {
    const m = mapGithubIssue(issue({ type: { name: 'Task' }, labels: [{ name: 'bug' }] }), 'acme/web')
    expect(m.type).toBe('task')
    expect(githubTypeFromLabels(['bug'], 'Task')).toBe('task')
  })
  it('no labels is issue; other conventions', () => {
    expect(mapGithubIssue(issue(), 'acme/web').type).toBe('issue')
    expect(githubTypeFromLabels(['enhancement'])).toBe('feature')
    expect(githubTypeFromLabels(['documentation'])).toBe('documentation')
    expect(githubTypeFromLabels(['question'])).toBe('question')
  })
  it('milestone is sprint', () => {
    const m = mapGithubIssue(issue({ milestone: { title: 'v2', state: 'open' } }), 'acme/web')
    expect(m).toMatchObject({ iterationPath: 'v2', sprint: true })
    const n = mapGithubIssue(issue(), 'acme/web')
    expect(n).toMatchObject({ iterationPath: '', sprint: false })
  })
  it('same number in two repos gives different ids', () => {
    expect(mapGithubIssue(issue(), 'a/x').id).not.toBe(mapGithubIssue(issue(), 'b/x').id)
  })
})

const pr = (o = {}) => ({ number: 5, title: 'P', state: 'open', draft: false, merged_at: null, user: { login: 'dev' },
  html_url: 'u', head: { ref: 'f' }, base: { ref: 'main' }, requested_reviewers: [], created_at: '2026-01-01T00:00:00Z', ...o })

describe('mapGithubPR', () => {
  it('headRepo is the head repo full name, null for a deleted fork, the repo only without a head', () => {
    expect(mapGithubPR(pr({ head: { ref: 'f', repo: { full_name: 'fork/web' } } }), 'acme/web').headRepo).toBe('fork/web')
    expect(mapGithubPR(pr({ head: { ref: 'f', repo: null } }), 'acme/web').headRepo).toBeNull()
    expect(mapGithubPR(pr({ head: undefined }), 'acme/web').headRepo).toBe('acme/web')
  })
  it('status mapping', () => {
    expect(mapGithubPR(pr({ draft: true }), 'a/b').status).toBe('draft')
    expect(mapGithubPR(pr({ state: 'closed', merged_at: '2026-01-02T00:00:00Z' }), 'a/b').status).toBe('merged')
    expect(mapGithubPR(pr({ state: 'closed' }), 'a/b').status).toBe('abandoned')
    expect(mapGithubPR(pr(), 'a/b').status).toBe('active')
  })
  it('identity fields', () => {
    expect(mapGithubPR(pr(), 'a/b')).toMatchObject({ id: 'gh:a/b#5', displayId: 'a/b#5', source: 'github', number: 5,
      repo: 'a/b', project: 'a-b', url: 'u', author: 'dev', authorName: 'dev', branch: 'f', targetBranch: 'main' })
  })
  it('latest review per reviewer wins', () => {
    const reviews = [
      { user: { login: 'a' }, state: 'APPROVED', submitted_at: '2026-01-01T00:00:00Z' },
      { user: { login: 'a' }, state: 'CHANGES_REQUESTED', submitted_at: '2026-01-02T00:00:00Z' },
    ]
    const m = mapGithubPR(pr(), 'a/b', { reviews })
    expect(m.reviewerDetails).toEqual([{ name: 'a', vote: -10, id: 'a' }])
  })
  it('requested reviewer without review has vote 0 and needsMe', () => {
    const m = mapGithubPR(pr({ requested_reviewers: [{ login: 'b' }] }), 'a/b', { meLogin: 'b' })
    expect(m.reviewerDetails).toEqual([{ name: 'b', vote: 0, id: 'b' }])
    expect(m.needsMe).toBe(true)
    expect(mapGithubPR(pr({ requested_reviewers: [{ login: 'b' }] }), 'a/b').needsMe).toBe(false)
  })
  it('conflicts', () => {
    expect(mapGithubPR(pr({ mergeable_state: 'dirty' }), 'a/b').hasConflicts).toBe(true)
  })
})

describe('mapGithubRun', () => {
  const run = (o = {}) => ({ id: 9, name: 'CI', status: 'completed', conclusion: 'success', head_branch: 'main',
    head_sha: 'abcdef1234567', run_started_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:02:05Z', html_url: 'u', ...o })
  it('conclusion mapping', () => {
    const s = c => mapGithubRun(run({ conclusion: c }), 'a/b').status
    expect(s('success')).toBe('success')
    for (const c of ['failure', 'timed_out', 'startup_failure']) expect(s(c)).toBe('failed')
    expect(s('cancelled')).toBe('cancelled')
    for (const c of ['neutral', 'skipped', 'action_required']) expect(s(c)).toBe('partial')
  })
  it('in progress is running', () => {
    expect(mapGithubRun(run({ status: 'in_progress', conclusion: null }), 'a/b').status).toBe('running')
  })
  it('fields and duration', () => {
    expect(mapGithubRun(run(), 'a/b')).toMatchObject({ pipeline: 'CI', projectName: 'a/b', project: 'a-b',
      branch: 'main', commit: 'abcdef1', duration: '2m 5s', url: 'u', source: 'github' })
  })
})
