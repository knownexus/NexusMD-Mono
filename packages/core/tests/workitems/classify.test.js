import { describe, it, expect } from 'vitest'
import { isDoneItem, isBlockedItem, isReviewItem, isActiveItem } from '../../src/modules/workitems/classify.js'
import * as core from '../../src/index.js'

const bucketOf = (w) => [
  isDoneItem(w) && 'done', isBlockedItem(w) && 'blocked', isReviewItem(w) && 'review', isActiveItem(w) && 'active',
].filter(Boolean)

const jira = (state, stateCategory, extra = {}) => ({ source: 'jira', state, stateCategory, ...extra })
const ado = (state, extra = {}) => ({ source: 'ado', state, ...extra })

describe('work-item classifier', () => {
  it('puts Jira QA/UAT statuses in review', () => {
    for (const s of ['In QA', 'Ready for QA', 'In UAT']) expect(bucketOf(jira(s, 'InProgress'))).toEqual(['review'])
  })
  it('puts other in-progress Jira statuses in active', () => {
    for (const s of ['In Dev', 'Design', 'Dev Complete']) expect(bucketOf(jira(s, 'InProgress'))).toEqual(['active'])
  })
  it('leaves Proposed Jira statuses unbucketed', () => {
    expect(bucketOf(jira('To Do', 'Proposed'))).toEqual([])
    expect(bucketOf(jira('Shortlist', 'Proposed'))).toEqual([])
  })
  it('treats a flagged Jira item as blocked only', () => {
    expect(bucketOf(jira('In Dev', 'InProgress', { flagged: true }))).toEqual(['blocked'])
  })
  it('treats a done-category Jira item as done only', () => {
    expect(bucketOf(jira('Released', 'Completed', { flagged: true }))).toEqual(['done'])
    expect(bucketOf(jira('In QA', 'Completed'))).toEqual(['done'])
  })
  it('treats a Jira status naming a block as blocked', () => {
    expect(bucketOf(jira('Blocked by vendor', 'InProgress'))).toEqual(['blocked'])
  })
  it('keeps ADO name-based behaviour', () => {
    expect(bucketOf(ado('Active'))).toEqual(['active'])
    expect(bucketOf(ado('In Review'))).toEqual(['review'])
    expect(bucketOf(ado('Blocked'))).toEqual(['blocked'])
    expect(bucketOf(ado('Done'))).toEqual(['done'])
    // ADO items are not bucketed by the Jira-only fallbacks
    expect(bucketOf(ado('In QA', { stateCategory: 'InProgress' }))).toEqual([])
  })
  it('is exported from the package root', () => {
    expect(core.isActiveItem).toBe(isActiveItem)
    expect(core.isReviewItem).toBe(isReviewItem)
    expect(core.isBlockedItem).toBe(isBlockedItem)
    expect(core.isDoneItem).toBe(isDoneItem)
  })
})

describe('GitHub items', () => {
  it('classify an open, assigned issue as active and a closed one as done', () => {
    expect(isActiveItem({ source: 'github', state: 'Open', stateCategory: 'InProgress' })).toBe(true)
    expect(isDoneItem({ source: 'github', state: 'Closed', stateCategory: 'Completed' })).toBe(true)
    expect(isActiveItem({ source: 'github', state: 'Open', stateCategory: 'Proposed' })).toBe(false)
  })
})
