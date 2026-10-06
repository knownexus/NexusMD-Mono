import { describe, it, expect } from 'vitest'
import {
  JIRA_ID_PREFIX, isJiraId, toJiraId, jiraKeyFromId, sourceOfId, displayIdOf,
} from '../../src/modules/workitems/ids.js'

describe('work item ids', () => {
  it('prefixes Jira keys and recognises them', () => {
    expect(JIRA_ID_PREFIX).toBe('jira:')
    expect(toJiraId('ABC-12')).toBe('jira:ABC-12')
    expect(isJiraId('jira:ABC-12')).toBe(true)
    expect(jiraKeyFromId('jira:ABC-12')).toBe('ABC-12')
  })
  it('treats numeric and other ids as ADO', () => {
    expect(isJiraId(123)).toBe(false)
    expect(isJiraId('123')).toBe(false)
    expect(jiraKeyFromId(123)).toBeNull()
    expect(sourceOfId(123)).toBe('ado')
    expect(sourceOfId('jira:X-1')).toBe('jira')
  })
  it('derives a display id', () => {
    expect(displayIdOf({ id: 42 })).toBe('#42')
    expect(displayIdOf({ id: 'jira:ABC-1' })).toBe('ABC-1')
    expect(displayIdOf({ id: 42, displayId: 'custom' })).toBe('custom')
    expect(displayIdOf(null)).toBe('')
  })
})
