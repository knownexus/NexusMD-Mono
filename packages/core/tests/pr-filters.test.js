import { describe, it, expect } from 'vitest'
import { effectiveNeedsMe, effectiveTeamActivity } from '../src/index.js'

const me = { name: 'Alex Doe' }

describe('effectiveNeedsMe', () => {
  it('excludes drafts unless includeDrafts is set', () => {
    const pr = { draft: true, reviewerDetails: [{ name: 'Alex Doe', vote: 0 }] }
    expect(effectiveNeedsMe(pr, {}, me)).toBe(false)
    expect(effectiveNeedsMe(pr, { includeDrafts: true }, me)).toBe(true)
  })

  it('onlyActive filters out non-active PRs', () => {
    const pr = { status: 'completed', reviewerDetails: [{ name: 'Alex Doe', vote: 0 }] }
    expect(effectiveNeedsMe(pr, { onlyActive: true }, me)).toBe(false)
  })

  it('excludeConflicts filters out conflicted PRs', () => {
    const pr = { hasConflicts: true, reviewerDetails: [{ name: 'Alex Doe', vote: 0 }] }
    expect(effectiveNeedsMe(pr, { excludeConflicts: true }, me)).toBe(false)
  })

  it('excludeMine drops PRs I authored (by slugified name)', () => {
    const pr = { author: 'alex-doe', reviewerDetails: [{ name: 'Alex Doe', vote: 0 }] }
    expect(effectiveNeedsMe(pr, { excludeMine: true }, me)).toBe(false)
  })

  it('minAgeDays requires the PR to be old enough', () => {
    const young = { age: '3h', reviewerDetails: [{ name: 'Alex Doe', vote: 0 }] }
    const old   = { age: '5d', reviewerDetails: [{ name: 'Alex Doe', vote: 0 }] }
    expect(effectiveNeedsMe(young, { minAgeDays: 2 }, me)).toBe(false)
    expect(effectiveNeedsMe(old,   { minAgeDays: 2 }, me)).toBe(true)
  })

  it('matches when I am a reviewer with a counted vote', () => {
    const pr = { reviewerDetails: [{ name: 'Alex Doe', vote: 0 }] }
    expect(effectiveNeedsMe(pr, { votes: [0] }, me)).toBe(true)
    expect(effectiveNeedsMe(pr, { votes: [10] }, me)).toBe(false)
  })

  it('falls back to pr.needsMe when no current user is known', () => {
    expect(effectiveNeedsMe({ needsMe: true }, {}, null)).toBe(true)
    expect(effectiveNeedsMe({ needsMe: false }, {}, null)).toBe(false)
  })
})

describe('effectiveTeamActivity', () => {
  it('excludes PRs authored by me', () => {
    const pr = { author: 'alex-doe' }
    expect(effectiveTeamActivity(pr, {}, me)).toBe(false)
  })

  it('includes PRs authored by someone else, with no reviewer requirement', () => {
    const pr = { author: 'jamie-lee', reviewerDetails: [] }
    expect(effectiveTeamActivity(pr, {}, me)).toBe(true)
  })

  it('excludes drafts unless includeDrafts is set', () => {
    const pr = { author: 'jamie-lee', draft: true }
    expect(effectiveTeamActivity(pr, {}, me)).toBe(false)
    expect(effectiveTeamActivity(pr, { includeDrafts: true }, me)).toBe(true)
  })

  it('onlyActive filters out non-active PRs and passes active ones', () => {
    const pr = { author: 'jamie-lee', status: 'completed' }
    expect(effectiveTeamActivity(pr, { onlyActive: true }, me)).toBe(false)
    expect(effectiveTeamActivity({ ...pr, status: 'active' }, { onlyActive: true }, me)).toBe(true)
  })

  it('excludeConflicts filters out conflicted PRs', () => {
    const pr = { author: 'jamie-lee', hasConflicts: true }
    expect(effectiveTeamActivity(pr, { excludeConflicts: true }, me)).toBe(false)
  })

  it('minAgeDays requires the PR to be old enough', () => {
    const young = { author: 'jamie-lee', age: '3h' }
    const old   = { author: 'jamie-lee', age: '5d' }
    expect(effectiveTeamActivity(young, { minAgeDays: 2 }, me)).toBe(false)
    expect(effectiveTeamActivity(old,   { minAgeDays: 2 }, me)).toBe(true)
  })

  it('with no known user, nothing is "mine" so everything not otherwise filtered passes', () => {
    const pr = { author: 'jamie-lee' }
    expect(effectiveTeamActivity(pr, {}, null)).toBe(true)
  })
})
