import { describe, it, expect } from 'vitest'
import { buildRunEntries, runCollection } from '../../src/modules/api-client/runner.js'

function fakeApiHttp(responses) {
  let i = 0
  return { fetch: async () => responses[Math.min(i++, responses.length - 1)]() }
}

const ok = () => ({ status: 200, statusText: 'OK', headers: {}, text: async () => 'ok' })
const serverError = () => ({ status: 500, statusText: 'Error', headers: {}, text: async () => 'boom' })

describe('buildRunEntries', () => {
  it('flattens a folder tree into ordered {refId, name, requestDef} entries, skipping dangling refs', () => {
    const collection = { requests: { req1: { url: '/a' }, req2: { url: '/b' } } }
    const nodes = [
      { type: 'request', name: 'A', refId: 'req1' },
      { type: 'folder', name: 'Sub', children: [{ type: 'request', name: 'B', refId: 'req2' }] },
      { type: 'request', name: 'Missing', refId: 'req3' },
    ]
    expect(buildRunEntries(collection, nodes)).toEqual([
      { refId: 'req1', name: 'A', requestDef: { url: '/a' } },
      { refId: 'req2', name: 'B', requestDef: { url: '/b' } },
    ])
  })
})

describe('runCollection', () => {
  it('runs every entry in order and aggregates pass/fail counts', async () => {
    const apiHttp = fakeApiHttp([ok, serverError])
    const entries = [
      { refId: 'req1', name: 'A', requestDef: { url: '/a' } },
      { refId: 'req2', name: 'B', requestDef: { url: '/b' } },
    ]
    // executeRequest only fails on network/script error or failed tests, not on
    // HTTP status alone — a 500 with no tests still counts as 'passed' at the
    // transport level, so assert on status codes actually reaching the results.
    const run = await runCollection(entries, { adapters: { apiHttp } })

    expect(run.results).toHaveLength(2)
    expect(run.results[0].refId).toBe('req1')
    expect(run.results[0].response.status).toBe(200)
    expect(run.results[1].response.status).toBe(500)
    expect(run.passed).toBe(2)
    expect(run.failed).toBe(0)
    expect(typeof run.totalDurationMs).toBe('number')
  })

  it('stops after the first failure when stopOnFailure is true', async () => {
    let calls = 0
    const apiHttp = { fetch: async () => { calls++; throw new Error('down') } }
    const entries = [
      { refId: 'req1', name: 'A', requestDef: { url: '/a' } },
      { refId: 'req2', name: 'B', requestDef: { url: '/b' } },
    ]

    const run = await runCollection(entries, { adapters: { apiHttp }, stopOnFailure: true })

    expect(calls).toBe(1)
    expect(run.results).toHaveLength(1)
    expect(run.results[0].status).toBe('network-error')
    expect(run.failed).toBe(1)
  })

  it('continues past failures when stopOnFailure is false (default)', async () => {
    let calls = 0
    const apiHttp = { fetch: async () => { calls++; throw new Error('down') } }
    const entries = [
      { refId: 'req1', name: 'A', requestDef: { url: '/a' } },
      { refId: 'req2', name: 'B', requestDef: { url: '/b' } },
    ]

    const run = await runCollection(entries, { adapters: { apiHttp } })

    expect(calls).toBe(2)
    expect(run.results).toHaveLength(2)
    expect(run.failed).toBe(2)
  })

  it('carries forward vars a request script updates into the next request', async () => {
    let seenUrls = []
    const apiHttp = { fetch: async (url) => { seenUrls.push(url); return ok() } }
    const scriptRunner = {
      run: async (script, context) => ({ context: { ...context, vars: { ...context.vars, token: 't1' } }, logs: [], error: null }),
    }
    const entries = [
      { refId: 'req1', name: 'Login', requestDef: { url: '/login', postResponseScript: 'x' } },
      { refId: 'req2', name: 'Get', requestDef: { url: '/get/{{token}}' } },
    ]

    await runCollection(entries, { adapters: { apiHttp, scriptRunner } })

    expect(seenUrls).toEqual(['/login', '/get/t1'])
  })
})
