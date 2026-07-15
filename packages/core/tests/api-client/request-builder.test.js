import { describe, it, expect } from 'vitest'
import { buildRequest } from '../../src/modules/api-client/request-builder.js'

function fakeScriptRunner(handler) {
  return { run: async (script, context) => handler(script, context) }
}

describe('buildRequest', () => {
  it('resolves {{vars}} in url/headers/params/body', async () => {
    const requestDef = {
      method: 'POST',
      url: '{{baseUrl}}/users',
      headers: { Authorization: 'Bearer {{token}}' },
      params: { active: '{{active}}' },
      body: '{"name":"{{name}}"}',
    }
    const { request } = await buildRequest(requestDef, {
      vars: { baseUrl: 'https://api.test', token: 'abc', active: 'true', name: 'Ada' },
    })
    expect(request.url).toBe('https://api.test/users?active=true')
    expect(request.headers.Authorization).toBe('Bearer abc')
    expect(request.body).toBe('{"name":"Ada"}')
  })

  it('applies bearer auth', async () => {
    const { request } = await buildRequest({ url: '/x', auth: { type: 'bearer', token: 'xyz' } }, {})
    expect(request.headers.Authorization).toBe('Bearer xyz')
  })

  it('applies basic auth as a base64-encoded header', async () => {
    const { request } = await buildRequest({ url: '/x', auth: { type: 'basic', username: 'u', password: 'p' } }, {})
    expect(request.headers.Authorization).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`)
  })

  it('applies apikey auth to a header by default, or to query params when in=query', async () => {
    const header = await buildRequest({ url: '/x', auth: { type: 'apikey', key: 'X-Api-Key', value: 'k1' } }, {})
    expect(header.request.headers['X-Api-Key']).toBe('k1')

    const query = await buildRequest({ url: '/x', auth: { type: 'apikey', in: 'query', key: 'api_key', value: 'k1' } }, {})
    expect(query.request.url).toBe('/x?api_key=k1')
  })

  it('runs the pre-request script and carries forward mutated vars/request', async () => {
    const requestDef = { url: '{{baseUrl}}/x', preRequestScript: 'context.vars.token = "minted"' }
    const scriptRunner = fakeScriptRunner((script, context) => ({
      context: { ...context, vars: { ...context.vars, token: 'minted' } },
      logs: ['ran'],
      error: null,
    }))

    const { request, vars, preScriptError, preScriptLogs } = await buildRequest(requestDef, {
      vars: { baseUrl: 'https://api.test' },
      adapters: { scriptRunner },
    })

    expect(request.url).toBe('https://api.test/x')
    expect(vars).toEqual({ baseUrl: 'https://api.test', token: 'minted' })
    expect(preScriptError).toBeNull()
    expect(preScriptLogs).toEqual(['ran'])
  })

  it('surfaces a pre-request script error without throwing', async () => {
    const scriptRunner = fakeScriptRunner(() => ({ context: null, logs: [], error: 'ReferenceError: x is not defined' }))
    const { preScriptError, vars } = await buildRequest(
      { url: '/x', preRequestScript: 'x.bad()' },
      { vars: { a: 1 }, adapters: { scriptRunner } },
    )
    expect(preScriptError).toBe('ReferenceError: x is not defined')
    expect(vars).toEqual({ a: 1 }) // vars unchanged when the script errored
  })
})

describe('body serialization', () => {
  it('defaults to raw/text when bodyType is missing (back-compat: string body, no auto header)', async () => {
    const { request } = await buildRequest({ url: '/x', body: 'plain text' }, {})
    expect(request.body).toBe('plain text')
    expect(request.headers['Content-Type']).toBeUndefined()
  })

  it('bodyType raw + json sets Content-Type: application/json', async () => {
    const { request } = await buildRequest({ url: '/x', bodyType: 'raw', bodyLanguage: 'json', body: '{"a":1}' }, {})
    expect(request.body).toBe('{"a":1}')
    expect(request.headers['Content-Type']).toBe('application/json')
  })

  it('bodyType raw + xml sets Content-Type: application/xml', async () => {
    const { request } = await buildRequest({ url: '/x', bodyType: 'raw', bodyLanguage: 'xml', body: '<a/>' }, {})
    expect(request.headers['Content-Type']).toBe('application/xml')
  })

  it('does not override an explicitly set Content-Type header', async () => {
    const { request } = await buildRequest(
      { url: '/x', bodyType: 'raw', bodyLanguage: 'json', headers: { 'Content-Type': 'application/vnd.custom+json' }, body: '{}' },
      {},
    )
    expect(request.headers['Content-Type']).toBe('application/vnd.custom+json')
  })

  it('bodyType urlencoded serializes key/value pairs and sets the form Content-Type', async () => {
    const { request } = await buildRequest(
      { url: '/x', bodyType: 'urlencoded', body: [{ key: 'a', value: '1' }, { key: 'b', value: 'x y' }] },
      {},
    )
    expect(request.body).toBe('a=1&b=x%20y')
    expect(request.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
  })

  it('bodyType urlencoded resolves {{vars}} inside pair values', async () => {
    const { request } = await buildRequest(
      { url: '/x', bodyType: 'urlencoded', body: [{ key: 'token', value: '{{t}}' }] },
      { vars: { t: 'abc' } },
    )
    expect(request.body).toBe('token=abc')
  })

  it('bodyType formdata builds a real FormData instance with no Content-Type header set', async () => {
    const { request } = await buildRequest(
      { url: '/x', bodyType: 'formdata', body: [{ key: 'file', value: 'contents' }] },
      {},
    )
    expect(request.body).toBeInstanceOf(FormData)
    expect(request.body.get('file')).toBe('contents')
    expect(request.headers['Content-Type']).toBeUndefined()
  })

  it('bodyType none sends no body and no Content-Type', async () => {
    const { request } = await buildRequest({ url: '/x', bodyType: 'none', body: 'ignored' }, {})
    expect(request.body).toBeUndefined()
    expect(request.headers['Content-Type']).toBeUndefined()
  })
})
