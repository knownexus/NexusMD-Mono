import { describe, it, expect } from 'vitest'
import { effectiveNeedsMe } from '../src/index.js'

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
