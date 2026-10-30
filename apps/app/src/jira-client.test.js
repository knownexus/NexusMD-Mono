import { describe, it, expect, beforeEach, vi } from 'vitest'
import { saveJiraConfig, isJiraActive, createJiraHttpAdapter } from './jira-client.js'

describe('jira config', () => {
  beforeEach(() => localStorage.clear())

  it('is inactive until site, email, token and keys are saved', () => {
    expect(isJiraActive()).toBe(false)
    saveJiraConfig({ site: 'acme', email: 'a@b.c', apiToken: 't', projectKeys: ['abc'] })
    expect(isJiraActive()).toBe(true)
  })
})

describe('createJiraHttpAdapter', () => {
  const cfg = { site: 'https://acme.atlassian.net', email: 'a@b.c', apiToken: 't' }

  it('calls the site with basic auth and wraps the response', async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, data: { displayName: 'Me' }, headers: { 'Retry-After': '5' } })
    const r = await createJiraHttpAdapter({ getConfig: () => cfg, request }).fetch('rest/api/3/myself')
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET', url: 'https://acme.atlassian.net/rest/api/3/myself',
      headers: expect.objectContaining({ Authorization: 'Basic ' + btoa('a@b.c:t'), 'X-Atlassian-Token': 'no-check' }),
    }))
    expect(r.ok).toBe(true)
    expect(await r.json()).toEqual({ displayName: 'Me' })
    expect(r.headers.get('retry-after')).toBe('5')
  })

  it('sends JSON bodies as objects and reports failures', async () => {
    const request = vi.fn().mockResolvedValue({ status: 403, data: '{"errorMessages":["no"]}', headers: {} })
    const r = await createJiraHttpAdapter({ getConfig: () => cfg, request })
      .fetch('rest/api/3/issue', { method: 'POST', body: '{"a":1}', headers: { 'Content-Type': 'application/json' } })
    expect(request.mock.calls[0][0].data).toEqual({ a: 1 })
    expect(r.ok).toBe(false)
    expect(await r.json()).toEqual({ errorMessages: ['no'] })
  })

  it('throws when no site is configured', async () => {
    await expect(createJiraHttpAdapter({ getConfig: () => ({}), request: vi.fn() }).fetch('x')).rejects.toThrow(/not configured/)
  })
})
