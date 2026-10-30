// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createBrunoRuntime } = require('./bruno-runtime.cjs')

const RESPONSE = {
  status: 200, statusText: 'OK', durationMs: 42,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: 'abc', items: [1, 2, 3], name: 'Gym' }),
}

function runTests(script, extra = {}) {
  return createBrunoRuntime({ timeoutMs: 1000 }).start(script, { phase: 'tests', env: {}, vars: {}, response: RESPONSE, ...extra })
}

describe('bruno runtime: res, test() and expect()', () => {
  it('records passing and failing tests with the assertion message', () => {
    const out = runTests(`
      test("status is 200", function () { expect(res.getStatus()).to.equal(200) })
      test("status is 201", function () { expect(res.getStatus()).to.equal(201) })
    `)
    expect(out.done).toBe(true)
    expect(out.error).toBeNull()
    expect(out.context.tests).toEqual([
      { name: 'status is 200', passed: true },
      { name: 'status is 201', passed: false, error: 'expected 200 to equal 201' },
    ])
  })

  it('parses a JSON body and exposes headers case-insensitively', () => {
    const out = runTests(`
      test("body", function () { expect(res.getBody().name).to.equal("Gym") })
      test("header", function () { expect(res.getHeader("content-type")).to.equal("application/json") })
      test("time", function () { expect(res.getResponseTime()).to.be.below(1000) })
    `)
    expect(out.context.tests.every(t => t.passed)).toBe(true)
  })

  it('supports the chai chains Bruno collections use', () => {
    const passing = [
      'expect(401).to.not.equal(500)',
      'expect(3).to.be.below(4)',
      'expect(200).to.be.oneOf([200, 204])',
      'expect("hello world").to.not.contain("bye")',
      'expect("hello").to.contain("ell")',
      'expect([1, 2]).to.include(2)',
      'expect([]).to.be.an("array").that.is.empty',
      'expect([1]).to.be.an("array").that.is.not.empty',
      'expect({ a: 1 }).to.have.property("a")',
      'expect({ a: 1 }).to.not.have.property("b")',
      'expect({ a: { b: 2 } }).to.have.property("a").that.has.property("b", 2)',
      'expect("x".repeat(150)).to.be.a("string").and.to.have.length.above(100)',
      'expect({ a: [1] }).to.deep.equal({ a: [1] })',
      'expect("abc123").to.match(/\\d+/)',
      'expect(5).to.be.greaterThan(4)',
      'expect(null).to.be.null',
      'expect(true).to.be.true',
      'expect([1, 2, 3]).to.have.lengthOf(3)',
    ]
    const out = runTests(passing.map((a, i) => `test(${JSON.stringify(String(i))}, function () { ${a} })`).join('\n'))
    const failed = out.context.tests.filter(t => !t.passed).map(t => `${passing[Number(t.name)]}: ${t.error}`)
    expect(failed).toEqual([])
  })

  it('fails negated assertions with a readable message', () => {
    const out = runTests('test("t", function () { expect(500).to.not.equal(500) })')
    expect(out.context.tests[0]).toEqual({ name: 't', passed: false, error: 'expected 500 to not equal 500' })
  })

  it('waits for async test functions', () => {
    const out = runTests('test("async", async function () { await null; expect(1).to.equal(2) })')
    expect(out.context.tests[0].passed).toBe(false)
  })

  it('decodes a JWT payload through Buffer, as the Authenticate test does', () => {
    const payload = Buffer.from(JSON.stringify({ MemberID: '42', iss: 'http://x' })).toString('base64url')
    const out = runTests(`
      test("claims", function () {
        const claims = JSON.parse(Buffer.from("${'h.' + payload + '.s'}".split(".")[1], "base64").toString("utf8"))
        expect(claims.MemberID).to.equal("42")
      })
    `)
    expect(out.context.tests[0]).toEqual({ name: 'claims', passed: true })
  })

  it('captures console output as logs', () => {
    const out = runTests('console.log("hi", { a: 1 })')
    expect(out.logs).toEqual([{ level: 'log', message: 'hi {"a":1}' }])
  })
})

describe('bruno runtime: bru and req', () => {
  it('reads env vars, and reads and writes runtime vars', () => {
    const rt = createBrunoRuntime({ timeoutMs: 1000 })
    const out = rt.start('bru.setVar("token", res.getBody().token + bru.getEnvVar("suffix"))', {
      env: { suffix: '-dev' }, vars: { keep: 1 }, response: RESPONSE,
    })
    expect(out.context.vars).toEqual({ keep: 1, token: 'abc-dev' })
  })

  it('lets a pre-request script edit headers and the body', () => {
    const rt = createBrunoRuntime({ timeoutMs: 1000 })
    const out = rt.start(`
      if (req.getHeader("x-api-key") === "{{serviceApiKey}}") {
        req.deleteHeader("X-Api-Key")
        req.setHeader("Authorization", "Bearer t")
      }
      req.setBody({ a: 1 })
    `, { env: {}, vars: {}, request: { method: 'POST', url: '/x', headers: { 'X-Api-Key': '{{serviceApiKey}}' }, body: '' } })
    expect(out.context.request.headers).toEqual({ Authorization: 'Bearer t' })
    expect(out.context.request.body).toBe('{"a":1}')
  })

  it('reports bru.runner.skipRequest()', () => {
    const rt = createBrunoRuntime({ timeoutMs: 1000 })
    const out = rt.start('if (bru.getEnvVar("writeMode") === "safe") { bru.runner.skipRequest(); return; }', {
      env: { writeMode: 'safe' }, vars: {}, request: { method: 'GET', url: '/', headers: {} },
    })
    expect(out.context.skipped).toBe(true)
    expect(out.error).toBeNull()
  })

  it('pauses on bru.runRequest and resumes with the result and its vars', () => {
    const rt = createBrunoRuntime({ timeoutMs: 1000 })
    const first = rt.start(`
      if (!bru.getVar("token")) {
        const r = await bru.runRequest("00-setup/authenticate.bru")
        bru.setVar("status", r.status)
      }
    `, { env: {}, vars: {}, request: { method: 'GET', url: '/', headers: {} } })

    expect(first.done).toBe(false)
    expect(first.pending).toEqual([{ id: 1, path: '00-setup/authenticate.bru' }])

    const second = rt.resume(first.sessionId, 1, { response: { status: 200, body: '{}' }, vars: { token: 'minted' } })
    expect(second.done).toBe(true)
    expect(second.error).toBeNull()
    expect(second.context.vars).toEqual({ token: 'minted', status: 200 })
    expect(rt.sessionCount()).toBe(0)
  })

  it('turns a failed runRequest into a script error', () => {
    const rt = createBrunoRuntime({ timeoutMs: 1000 })
    const first = rt.start('await bru.runRequest("missing.bru")', { env: {}, vars: {} })
    const second = rt.resume(first.sessionId, 1, { error: 'No request at missing.bru' })
    expect(second).toMatchObject({ done: true, error: 'No request at missing.bru' })
  })

  it('names Bruno APIs it does not support yet', () => {
    const out = createBrunoRuntime({ timeoutMs: 1000 }).start('bru.sleep(10)', { env: {}, vars: {} })
    expect(out.error).toBe('bru.sleep is not supported in NexusMD yet')
  })
})

describe('bruno runtime: failure handling and isolation', () => {
  it('reports a syntax error instead of throwing', () => {
    const out = createBrunoRuntime({ timeoutMs: 1000 }).start('test("x", function () {', { env: {}, vars: {} })
    expect(out.done).toBe(true)
    expect(out.error).toMatch(/Unexpected|missing/)
  })

  it('reports a script that awaits something other than runRequest', () => {
    const out = createBrunoRuntime({ timeoutMs: 1000 }).start('await new Promise(() => {})', { env: {}, vars: {} })
    expect(out.error).toMatch(/never finishes/)
  })

  it('times out a runaway async loop', () => {
    const out = createBrunoRuntime({ timeoutMs: 200 }).start('while (true) { await null }', { env: {}, vars: {} })
    expect(out.error).toMatch(/timed out/)
  })

  it('rejects resuming an unknown or expired session', () => {
    let t = 0
    const rt = createBrunoRuntime({ timeoutMs: 1000, now: () => t })
    const first = rt.start('await bru.runRequest("a.bru")', { env: {}, vars: {} })
    t += 10 * 60 * 1000
    rt.start('1', { env: {}, vars: {} }) // any start sweeps expired sessions
    expect(rt.resume(first.sessionId, 1, {}).error).toMatch(/expired/)
  })

  const escapes = {
    'the Function constructor': 'Function("return process")()',
    'a constructor chain': '(function(){}).constructor("return process")()',
    'the global object': 'this.constructor.constructor("return process")()',
    'the bru object': 'bru.constructor.constructor("return process")()',
    'a test result': 'test.constructor.constructor("return process")()',
  }
  for (const [name, code] of Object.entries(escapes)) {
    it(`cannot reach the host process through ${name}`, () => {
      const out = createBrunoRuntime({ timeoutMs: 1000 }).start(`bru.setVar("p", typeof (${code}))`, { env: {}, vars: {} })
      expect(out.error).toMatch(/Code generation from strings disallowed/)
    })
  }
})
