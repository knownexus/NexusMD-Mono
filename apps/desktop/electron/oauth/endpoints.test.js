// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { buildAuthUrl, exchangeCode, refreshAccessToken } from './endpoints.cjs'

const cfg = {
  clientId: 'cid', clientSecret: 'secret',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/gmail.modify'],
  authParams: { access_type: 'offline', prompt: 'consent' },
}

describe('buildAuthUrl', () => {
  it('includes client, redirect, PKCE, scopes and offline consent', () => {
    const u = new URL(buildAuthUrl(cfg, { redirectUri: 'http://127.0.0.1:5555', challenge: 'CH', state: 'ST' }))
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const p = u.searchParams
    expect(p.get('client_id')).toBe('cid')
    expect(p.get('redirect_uri')).toBe('http://127.0.0.1:5555')
    expect(p.get('response_type')).toBe('code')
    expect(p.get('code_challenge')).toBe('CH')
    expect(p.get('code_challenge_method')).toBe('S256')
    expect(p.get('state')).toBe('ST')
    expect(p.get('access_type')).toBe('offline')
    expect(p.get('prompt')).toBe('consent')
    expect(p.get('scope')).toBe('https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/gmail.modify')
  })
})

describe('exchangeCode', () => {
  it('POSTs the code and maps the token response', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }) }))
    const out = await exchangeCode(cfg, { code: 'C', verifier: 'V', redirectUri: 'http://127.0.0.1:5555' }, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledWith('https://oauth2.googleapis.com/token', expect.objectContaining({ method: 'POST' }))
    const body = fetchImpl.mock.calls[0][1].body
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('C')
    expect(body.get('code_verifier')).toBe('V')
    expect(body.get('client_secret')).toBe('secret')
    expect(out.accessToken).toBe('AT')
    expect(out.refreshToken).toBe('RT')
    expect(out.expiresAt).toBeGreaterThan(Date.now())
  })

  it('throws with status on non-ok', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400, text: async () => 'bad' }))
    await expect(exchangeCode(cfg, { code: 'C', verifier: 'V', redirectUri: 'x' }, fetchImpl)).rejects.toThrow(/400/)
  })
})

describe('refreshAccessToken', () => {
  it('POSTs the refresh grant and maps the response', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'AT2', expires_in: 3600 }) }))
    const out = await refreshAccessToken(cfg, 'RT', fetchImpl)
    const body = fetchImpl.mock.calls[0][1].body
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('RT')
    expect(out.accessToken).toBe('AT2')
  })
})

describe('public client (no secret)', () => {
  it('omits client_secret when cfg.clientSecret is empty', async () => {
    const publicCfg = { ...cfg, clientSecret: '' }
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }) }))
    await exchangeCode(publicCfg, { code: 'C', verifier: 'V', redirectUri: 'x' }, fetchImpl)
    const body = fetchImpl.mock.calls[0][1].body
    expect(body.has('client_secret')).toBe(false)
    expect(body.get('client_id')).toBe('cid')
  })

  it('includes client_secret when set', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'AT', expires_in: 3600 }) }))
    await exchangeCode(cfg, { code: 'C', verifier: 'V', redirectUri: 'x' }, fetchImpl)
    expect(fetchImpl.mock.calls[0][1].body.get('client_secret')).toBe('secret')
  })
})

describe('refreshAccessToken rotation', () => {
  it('returns a rotated refreshToken when the response includes one', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 }) }))
    const out = await refreshAccessToken(cfg, 'RT', fetchImpl)
    expect(out.accessToken).toBe('AT2')
    expect(out.refreshToken).toBe('RT2')
  })

  it('omits refreshToken when the response has none', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'AT2', expires_in: 3600 }) }))
    const out = await refreshAccessToken(cfg, 'RT', fetchImpl)
    expect(out.accessToken).toBe('AT2')
    expect('refreshToken' in out).toBe(false)
  })
})
