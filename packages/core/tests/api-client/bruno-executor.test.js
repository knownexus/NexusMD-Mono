import { describe, it, expect } from 'vitest'
import { executeBrunoRequest, brunoRequestLookup, normalizeBrunoPath } from '../../src/modules/api-client/bruno-executor.js'
import { executeRequest } from '../../src/modules/api-client/executor.js'
import { runCollection } from '../../src/modules/api-client/runner.js'

// A stand-in for adapters.scriptRunner's Bruno session protocol. Each script
// text maps to a handler (input) => outcome; a handler can pause on
// bru.runRequest by returning pause(path, vars, continueWith).
function fakeRunner(handlers) {
  const sessions = new Map()
  let nextSession = 1
  const runner = {
    calls: [],
    async runBruno(script, input) {
      runner.calls.push({ script, input })
      return resolve(handlers[script](input))
    },
    async resumeBruno(sessionId, _id, result) {
      const next = sessions.get(sessionId)
      sessions.delete(sessionId)
      return resolve(next(result))
    },
  }
  function resolve(out) {
    if (out.pause) {
      const sessionId = `s${nextSession++}`
      sessions.set(sessionId, out.continueWith)
      return { done: false, sessionId, pending: [{ id: 1, path: out.pause }], context: { vars: out.vars }, logs: [] }
    }
    return { done: true, logs: [], error: null, ...out }
  }
  return runner
}
const pause = (path, vars, continueWith) => ({ pause: path, vars, continueWith })

function fakeHttp(respond = () => ({ status: 200, body: '{}' })) {
  const sent = []
  return {
    sent,
    fetch: async (url, opts) => {
      sent.push({ url, ...opts })
      const r = respond(url, opts)
      return { status: r.status, statusText: 'OK', headers: {}, text: async () => r.body }
    },
  }
}

const base = { method: 'GET', url: '{{baseUrl}}/x', params: {}, headers: {}, bodyType: 'none', body: '', auth: { type: 'none' }, scriptFlavor: 'bruno' }

describe('executeBrunoRequest', () => {
  it('resolves {{vars}} from env and runtime vars, runtime winning', async () => {
    const http = fakeHttp()
    const result = await executeBrunoRequest(
      { ...base, auth: { type: 'bearer', token: '{{token}}' } },
      { env: { baseUrl: 'http://env', token: 'env-token' }, runtimeVars: { token: 'runtime-token' }, adapters: { apiHttp: http } },
    )
    expect(result.status).toBe('passed')
    expect(http.sent[0].url).toBe('http://env/x')
    expect(http.sent[0].headers.Authorization).toBe('Bearer runtime-token')
  })

  it('runs the pre-request script before resolving vars, so a token it sets is used', async () => {
    const http = fakeHttp()
    const scriptRunner = fakeRunner({
      pre: (input) => ({ context: { vars: { ...input.vars, token: 'fresh' }, request: input.request } }),
    })
    const result = await executeBrunoRequest(
      { ...base, preRequestScript: 'pre', auth: { type: 'bearer', token: '{{token}}' } },
      { env: { baseUrl: 'http://h' }, adapters: { apiHttp: http, scriptRunner } },
    )
    expect(http.sent[0].headers.Authorization).toBe('Bearer fresh')
    expect(result.runtimeVars).toEqual({ token: 'fresh' })
    // The script saw the request before resolution.
    expect(scriptRunner.calls[0].input.request.url).toBe('{{baseUrl}}/x')
  })

  it('applies header edits the pre-request script made', async () => {
    const http = fakeHttp()
    const scriptRunner = fakeRunner({
      pre: (input) => ({ context: { vars: input.vars, request: { ...input.request, headers: { Authorization: 'Bearer swapped' } } } }),
    })
    await executeBrunoRequest(
      { ...base, headers: { 'X-Api-Key': 'k' }, preRequestScript: 'pre' },
      { env: { baseUrl: 'http://h' }, adapters: { apiHttp: http, scriptRunner } },
    )
    expect(http.sent[0].headers).toEqual({ Authorization: 'Bearer swapped' })
  })

  it('returns skipped without sending when the script calls skipRequest', async () => {
    const http = fakeHttp()
    const scriptRunner = fakeRunner({ pre: (input) => ({ context: { vars: input.vars, request: input.request, skipped: true } }) })
    const result = await executeBrunoRequest({ ...base, preRequestScript: 'pre' }, { adapters: { apiHttp: http, scriptRunner } })
    expect(result.status).toBe('skipped')
    expect(http.sent).toEqual([])
  })

  it('sends a request bru.runRequest asks for, carrying its vars back into the script', async () => {
    const auth = { ...base, url: '{{baseUrl}}/auth', brunoPath: '00-setup/authenticate.bru', postResponseScript: 'authPost' }
    const main = { ...base, url: '{{baseUrl}}/main', preRequestScript: 'mainPre', auth: { type: 'bearer', token: '{{token}}' } }
    const http = fakeHttp()
    const scriptRunner = fakeRunner({
      mainPre: (input) => pause('00-setup/authenticate.bru', input.vars, (result) => ({
        context: { vars: result.vars, request: input.request },
      })),
      authPost: (input) => ({ context: { vars: { ...input.vars, token: 'minted' }, tests: [] } }),
    })
    const lookupRequest = brunoRequestLookup({ requests: { a: auth, m: main } })

    const result = await executeBrunoRequest(main, { env: { baseUrl: 'http://h' }, adapters: { apiHttp: http, scriptRunner }, lookupRequest })

    expect(http.sent.map(s => s.url)).toEqual(['http://h/auth', 'http://h/main'])
    expect(http.sent[1].headers.Authorization).toBe('Bearer minted')
    expect(result.runtimeVars).toEqual({ token: 'minted' })
  })

  it('fails the script cleanly when bru.runRequest names a request that is not in the collection', async () => {
    const scriptRunner = fakeRunner({
      pre: (input) => pause('nope.bru', input.vars, (result) => ({ context: null, error: result.error })),
    })
    const result = await executeBrunoRequest({ ...base, preRequestScript: 'pre' }, { adapters: { apiHttp: fakeHttp(), scriptRunner }, lookupRequest: () => undefined })
    expect(result).toMatchObject({ status: 'script-error', phase: 'pre-request', error: 'bru.runRequest: there is no request at "nope.bru" in this collection' })
  })

  it('runs post-response then tests, and reports failed when a test fails', async () => {
    const scriptRunner = fakeRunner({
      post: (input) => ({ context: { vars: { ...input.vars, seen: input.response.status }, tests: [] } }),
      tests: (input) => ({ context: { vars: input.vars, tests: [{ name: 'ok', passed: true }, { name: 'bad', passed: false, error: 'x' }] } }),
    })
    const result = await executeBrunoRequest({ ...base, postResponseScript: 'post', tests: 'tests' }, { adapters: { apiHttp: fakeHttp(), scriptRunner } })
    expect(result.status).toBe('failed')
    expect(result.tests.map(t => t.name)).toEqual(['ok', 'bad'])
    expect(result.runtimeVars).toEqual({ seen: 200 })
    expect(scriptRunner.calls.map(c => c.input.phase)).toEqual(['post-response', 'tests'])
  })

  it('still runs the tests when the post-response script fails, and reports the script error', async () => {
    const scriptRunner = fakeRunner({
      post: () => ({ context: null, error: 'boom' }),
      tests: (input) => ({ context: { vars: input.vars, tests: [{ name: 't', passed: true }] } }),
    })
    const result = await executeBrunoRequest({ ...base, postResponseScript: 'post', tests: 'tests' }, { adapters: { apiHttp: fakeHttp(), scriptRunner } })
    expect(result).toMatchObject({ status: 'script-error', phase: 'post-response', error: 'boom' })
    expect(result.tests).toEqual([{ name: 't', passed: true }])
  })

  it('is what executeRequest uses for scriptFlavor bruno', async () => {
    const http = fakeHttp()
    const result = await executeRequest({ ...base }, { vars: { baseUrl: 'http://h' }, adapters: { apiHttp: http } })
    expect(result.status).toBe('passed')
    expect(result.runtimeVars).toEqual({})
  })
})

describe('normalizeBrunoPath', () => {
  it('ignores ./, backslashes, case and a missing .bru', () => {
    expect(normalizeBrunoPath('./00-setup\\Authenticate')).toBe('00-setup/authenticate.bru')
    expect(normalizeBrunoPath('00-setup/authenticate.bru')).toBe('00-setup/authenticate.bru')
  })
})

describe('runCollection with Bruno requests', () => {
  it('carries runtime vars between requests, counts skips apart from failures, and returns the final vars', async () => {
    const scriptRunner = fakeRunner({
      setToken: (input) => ({ context: { vars: { ...input.vars, token: 't1' }, tests: [] } }),
      skip: (input) => ({ context: { vars: input.vars, request: input.request, skipped: true } }),
    })
    const http = fakeHttp()
    const entries = [
      { refId: 'a', name: 'login', requestDef: { ...base, postResponseScript: 'setToken' } },
      { refId: 'b', name: 'write', requestDef: { ...base, preRequestScript: 'skip' } },
      { refId: 'c', name: 'read', requestDef: { ...base, auth: { type: 'bearer', token: '{{token}}' } } },
    ]
    const report = await runCollection(entries, { env: { baseUrl: 'http://h' }, adapters: { apiHttp: http, scriptRunner } })
    expect(report).toMatchObject({ passed: 2, failed: 0, skipped: 1, runtimeVars: { token: 't1' } })
    expect(http.sent).toHaveLength(2)
    expect(http.sent[1].headers.Authorization).toBe('Bearer t1')
  })
})
