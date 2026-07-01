// @vitest-environment node
import { describe, it, expect } from 'vitest'
import config from './config.cjs'

describe('oauth config', () => {
  it('defines the google provider with all three scopes and offline consent', () => {
    const g = config.google
    expect(g.authUrl).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(g.tokenUrl).toBe('https://oauth2.googleapis.com/token')
    expect(g.scopes).toEqual([
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/calendar',
    ])
    expect(g.authParams).toEqual({ access_type: 'offline', prompt: 'consent' })
    expect(typeof g.clientId).toBe('string')
    expect(typeof g.clientSecret).toBe('string')
  })

  it('defines the microsoft provider as a public client with Graph scopes', () => {
    const m = config.microsoft
    expect(m.authUrl).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')
    expect(m.tokenUrl).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token')
    expect(m.scopes).toEqual(['offline_access', 'Files.ReadWrite', 'Calendars.ReadWrite', 'User.Read'])
    expect(m.clientSecret).toBe('')          // public client — PKCE, no secret
    expect(m.authParams).toEqual({})
    expect(typeof m.clientId).toBe('string')
  })
})
