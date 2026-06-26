import { describe, it, expect } from 'vitest'
import { validateProfile, CURRENT_PROFILE_VERSION } from '../src/profiles/profile-schema.js'
import { listProfiles } from '../src/profiles/profile-store.js'

function validProfile(overrides = {}) {
  return {
    id: 'abc123',
    version: CURRENT_PROFILE_VERSION,
    name: 'Work',
    type: 'ado',
    created: '2026-06-15T00:00:00Z',
    modules: {
      ado:      { enabled: true,  org: 'myorg', projects: ['A'], testProject: '', uatBranch: '', refreshSecs: 30 },
      github:   { enabled: false, owner: '', repos: [] },
      planner:  { enabled: true },
      triage:   { enabled: true },
      team:     { enabled: true },
      calendar: { enabled: true },
      digest:   { enabled: false },
      audit:    { enabled: true },
    },
    preferences: { theme: 'dark', language: 'en' },
    team: [],
    ...overrides,
  }
}

describe('validateProfile', () => {
  it('returns valid: true for a well-formed profile', () => {
    expect(validateProfile(validProfile())).toEqual({ valid: true })
  })

  it('returns valid: false for null', () => {
    expect(validateProfile(null).valid).toBe(false)
  })

  it('returns valid: false when id is missing', () => {
    expect(validateProfile(validProfile({ id: undefined })).valid).toBe(false)
  })

  it('returns valid: false when version is wrong', () => {
    expect(validateProfile(validProfile({ version: 99 })).valid).toBe(false)
  })

  it('returns valid: false when name is missing', () => {
    expect(validateProfile(validProfile({ name: undefined })).valid).toBe(false)
  })

  it('returns valid: false when modules is missing', () => {
    expect(validateProfile(validProfile({ modules: undefined })).valid).toBe(false)
  })

  it('includes a human-readable error message on failure', () => {
    const result = validateProfile(null)
    expect(typeof result.error).toBe('string')
    expect(result.error.length).toBeGreaterThan(0)
  })
})

describe('listProfiles', () => {
  it('returns empty array when file adapter list returns no .json files', async () => {
    const mockFile = {
      list: async () => [],
      read: async () => { throw new Error('should not be called') },
      defaultProfileDir: async () => '/documents/nexusmd/profiles',
    }
    const mockStorage = { get: () => null }
    expect(await listProfiles(mockFile, mockStorage)).toEqual([])
  })

  it('skips non-JSON files', async () => {
    const mockFile = {
      list: async () => ['notes.txt', 'icon.png'],
      read: async () => { throw new Error('should not read non-json') },
      defaultProfileDir: async () => '/docs/profiles',
    }
    const mockStorage = { get: () => null }
    expect(await listProfiles(mockFile, mockStorage)).toEqual([])
  })

  it('returns parsed profiles from valid .json files', async () => {
    const profile = validProfile()
    const mockFile = {
      list: async () => ['abc123.json'],
      read: async (path) => JSON.stringify(profile),
      defaultProfileDir: async () => '/docs/profiles',
    }
    const mockStorage = { get: () => null }
    const result = await listProfiles(mockFile, mockStorage)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('abc123')
  })

  it('silently skips files with invalid JSON', async () => {
    const mockFile = {
      list: async () => ['bad.json'],
      read: async () => '{ invalid json !!!',
      defaultProfileDir: async () => '/docs/profiles',
    }
    const mockStorage = { get: () => null }
    expect(await listProfiles(mockFile, mockStorage)).toEqual([])
  })

  it('uses nexusmd.profileDir from storage when set, ignoring defaultProfileDir', async () => {
    const profile = validProfile()
    const readCalls = []
    const mockFile = {
      list: async (dir) => { readCalls.push(dir); return ['abc123.json'] },
      read: async () => JSON.stringify(profile),
      defaultProfileDir: async () => '/should-not-be-used',
    }
    const mockStorage = { get: (key) => key === 'nexusmd.profileDir' ? '/custom/sync/folder' : null }
    await listProfiles(mockFile, mockStorage)
    expect(readCalls[0]).toBe('/custom/sync/folder')
  })
})
