import { describe, it, expect } from 'vitest'
import { executeRequest } from '../../src/modules/api-client/executor.js'

function fakeApiHttp(responder) {
  return { fetch: async (url, options) => responder(url, options) }
}

function fakeScriptRunner(handler) {
  return { run: async (script, context) => handler(script, context) }
}

const okResponse = () => ({
  status: 200,
  statusText: 'OK',
  headers: { 'content-type': 'application/json' },
  text: async () => '{"ok":true}',
})

describe('executeRequest', () => {
  it('sends the built request and returns a passed result with no tests', async () => {
    const apiHttp = fakeApiHttp(() => okResponse())
    const result = await executeRequest({ url: '{{baseUrl}}/x' }, { vars: { baseUrl: 'https://api.test' }, adapters: { apiHttp } })

    expect(result.status).toBe('passed')
    expect(result.response.status).toBe(200)
    expect(result.response.body).toBe('{"ok":true}')
    expect(typeof result.response.durationMs).toBe('number')
    expect(result.tests).toEqual([])
  })

  it('returns network-error (not a throw) when the fetch rejects', async () => {
    const apiHttp = fakeApiHttp(() => { throw new Error('ECONNREFUSED') })
    const result = await executeRequest({ url: '/x' }, { adapters: { apiHttp } })

    expect(result.status).toBe('network-error')
    expect(result.phase).toBe('send')
    expect(result.error).toBe('ECONNREFUSED')
  })

  it('returns script-error for a pre-request script failure without sending', async () => {
    let sent = false
    const apiHttp = fakeApiHttp(() => { sent = true; return okResponse() })
    const scriptRunner = fakeScriptRunner(() => ({ context: null, logs: [], error: 'bad script' }))

    const result = await executeRequest(
      { url: '/x', preRequestScript: 'boom()' },
      { adapters: { apiHttp, scriptRunner } },
    )

    expect(result.status).toBe('script-error')
    expect(result.phase).toBe('pre-request')
    expect(result.error).toBe('bad script')
    expect(sent).toBe(false)
  })

  it('runs post-response tests and reports failed when any assertion fails', async () => {
    const apiHttp = fakeApiHttp(() => okResponse())
    const scriptRunner = fakeScriptRunner((script, context) => ({
      context: { ...context, tests: [{ name: 'status is 200', passed: context.response.status === 200 }, { name: 'body has foo', passed: false }] },
      logs: [],
      error: null,
    }))

    const result = await executeRequest(
      { url: '/x', tests: "context.tests.push({name:'x', passed:false})" },
      { adapters: { apiHttp, scriptRunner } },
    )

    expect(result.status).toBe('failed')
    expect(result.tests).toHaveLength(2)
    expect(result.tests.filter(t => !t.passed)).toHaveLength(1)
  })

  it('reports script-error for a post-response script failure, still including the response', async () => {
    const apiHttp = fakeApiHttp(() => okResponse())
    const scriptRunner = fakeScriptRunner(() => ({ context: null, logs: [], error: 'assert threw' }))

    const result = await executeRequest(
      { url: '/x', postResponseScript: 'boom()' },
      { adapters: { apiHttp, scriptRunner } },
    )

    expect(result.status).toBe('script-error')
    expect(result.phase).toBe('post-response')
    expect(result.error).toBe('assert threw')
    expect(result.response.status).toBe(200)
  })
})
