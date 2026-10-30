import { describe, it, expect } from 'vitest'
import {
  GITHUB_ID_PREFIX, isGithubId, toGithubId, parseGithubId, sourceOfId, displayIdOf,
} from '../../src/modules/workitems/ids.js'

describe('github ids', () => {
  it('builds, recognises and parses gh ids', () => {
    expect(GITHUB_ID_PREFIX).toBe('gh:')
    expect(toGithubId('acme/web', 12)).toBe('gh:acme/web#12')
    expect(isGithubId('gh:acme/web#12')).toBe(true)
    expect(isGithubId('jira:A-1')).toBe(false)
    expect(parseGithubId('gh:acme/web#12')).toEqual({ repo: 'acme/web', number: 12 })
    expect(parseGithubId('jira:A-1')).toBeNull()
    expect(parseGithubId(5)).toBeNull()
  })
  it('sources and display ids', () => {
    expect(sourceOfId('gh:a/b#1')).toBe('github')
    expect(sourceOfId('jira:A-1')).toBe('jira')
    expect(sourceOfId(5)).toBe('ado')
    expect(displayIdOf({ id: 'gh:a/b#1' })).toBe('a/b#1')
  })
})
