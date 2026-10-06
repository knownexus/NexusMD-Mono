import { describe, it, expect, vi } from 'vitest'
import { makeJiraClient, JiraError, jiraErrorMessage } from '../../src/modules/jira/client.js'

function res(status, body, headers = {}) {
  const text = body === undefined ? '' : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: n => headers[n.toLowerCase()] ?? null },
    text: async () => text,
    json: async () => JSON.parse(text),
  }
}

describe('makeJiraClient', () => {
  it('GETs and parses JSON', async () => {
    const http = { fetch: vi.fn(async () => res(200, { a: 1 })) }
    const c = makeJiraClient(http)
    expect(await c.get('rest/api/3/myself')).toEqual({ a: 1 })
    expect(http.fetch).toHaveBeenCalledWith('rest/api/3/myself', { method: 'GET' })
  })

  it('POSTs and PUTs JSON bodies with a content type', async () => {
    const http = { fetch: vi.fn(async () => res(204)) }
    const c = makeJiraClient(http)
    expect(await c.put('rest/api/3/issue/A-1', { fields: {} })).toBeNull()
    expect(http.fetch).toHaveBeenCalledWith('rest/api/3/issue/A-1', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"fields":{}}',
    })
  })

  it('retries a 429 exactly once, honouring Retry-After capped at 10s', async () => {
    const sleep = vi.fn(async () => {})
    const http = { fetch: vi.fn()
      .mockResolvedValueOnce(res(429, {}, { 'retry-after': '30' }))
      .mockResolvedValueOnce(res(200, { ok: true })) }
    const c = makeJiraClient(http, { sleep })
    expect(await c.get('x')).toEqual({ ok: true })
    expect(sleep).toHaveBeenCalledWith(10_000)
    expect(http.fetch).toHaveBeenCalledTimes(2)
  })

  it('fails after a second 429', async () => {
    const http = { fetch: vi.fn(async () => res(429, {}, { 'retry-after': '1' })) }
    const c = makeJiraClient(http, { sleep: async () => {} })
    await expect(c.get('x')).rejects.toMatchObject({ status: 429 })
    expect(http.fetch).toHaveBeenCalledTimes(2)
  })

  it('throws JiraError with Jira error text', async () => {
    const http = { fetch: vi.fn(async () => res(400, { errorMessages: ['Bad JQL'], errors: { summary: 'required' } })) }
    const err = await makeJiraClient(http).get('x').catch(e => e)
    expect(err).toBeInstanceOf(JiraError)
    expect(err.status).toBe(400)
    expect(err.message).toBe('Bad JQL; summary: required')
  })

  it('requires an http adapter', () => {
    expect(() => makeJiraClient(null)).toThrow('makeJiraClient: http adapter is required')
  })
})

describe('jiraErrorMessage', () => {
  it('explains auth failures', () => {
    expect(jiraErrorMessage(401, null)).toMatch(/credentials/)
    expect(jiraErrorMessage(403, {})).toMatch(/permission/)
  })
  it('truncates to 200 characters', () => {
    expect(jiraErrorMessage(400, { errorMessages: ['x'.repeat(500)] })).toHaveLength(200)
  })
})
