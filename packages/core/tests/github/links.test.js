import { describe, it, expect } from 'vitest'
import { extractIssueRefs } from '../../src/modules/github/links.js'

const known = ['acme/web', 'acme/api']
describe('extractIssueRefs', () => {
  it('resolves bare, qualified refs and drops unknown repos', () => {
    expect(extractIssueRefs('Fixes #4 and acme/api#9, see other/x#1', 'acme/web', known))
      .toEqual(['gh:acme/web#4', 'gh:acme/api#9'])
  })
  it('returns [] without refs', () => {
    expect(extractIssueRefs('nothing here', 'acme/web', known)).toEqual([])
    expect(extractIssueRefs('', 'acme/web', known)).toEqual([])
    expect(extractIssueRefs(null, 'acme/web', known)).toEqual([])
  })
  it('dedupes', () => {
    expect(extractIssueRefs('#4 #4', 'acme/web', known)).toEqual(['gh:acme/web#4'])
  })
  it('rejects malformed refs', () => {
    expect(extractIssueRefs('issue #12abc', 'acme/web', known)).toEqual([])
    expect(extractIssueRefs('color #fff', 'acme/web', known)).toEqual([])
  })
  it('handles closing keywords incl. qualified refs', () => {
    expect(extractIssueRefs('Closes acme/api#2, resolved #3, fixed: #5', 'acme/web', known))
      .toEqual(['gh:acme/api#2', 'gh:acme/web#3', 'gh:acme/web#5'])
  })
  it('keeps same number in two repos distinct', () => {
    expect(extractIssueRefs('#1 acme/api#1', 'acme/web', known))
      .toEqual(['gh:acme/web#1', 'gh:acme/api#1'])
  })
  it('drops bare refs when defaultRepo is unknown', () => {
    expect(extractIssueRefs('#1', 'zzz/q', known)).toEqual([])
  })
})
