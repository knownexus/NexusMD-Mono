// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createRedactor, DEFAULT_DENY } = require('./redact-trace.cjs')
const { redactString } = require('../logging/redact.cjs')

const enter = (fn, a, id = 'r1-1', p = null) => ({ k: 'enter', id, p, fn, a, t: 1, proc: 'renderer' })
const ret = (id, v) => ({ k: 'ret', id, v, t: 2, proc: 'renderer', ms: 1 })
const net = (d, p = 'r1-1', id = 'r1-9') => ({ k: 'net', id, p, d, t: 1, proc: 'renderer' })
const once = (event) => createRedactor().redact(event)

describe('createRedactor', () => {
  it('a bearer token in an argument string is hidden', () => {
    const out = once(enter('x.js:1:0:call', ['Bearer abcdefghijklmnop1234']))
    expect(JSON.stringify(out)).not.toContain('abcdefghijklmnop1234')
    expect(JSON.stringify(out)).toContain('[redacted]')
  })

  it('a token in a URL query (?access_token=abc) and a URL with user:pass@ are hidden', () => {
    const out = once(net({ method: 'GET', url: 'https://api.example.com/x?access_token=SECRETVALUE1&page=2' }))
    expect(out.d.url).not.toContain('SECRETVALUE1')
    expect(out.d.url).toContain('page=2')
    expect(once(net({ url: 'https://bob:hunter2pw@host.example.com/repo' })).d.url).not.toContain('hunter2pw')
    const raw = once(enter('x.js:1:0:f', ['https://host/p?refresh_token=ZZZTOKEN99&a=1', 'id_token=QQQ12345&x=1']))
    expect(JSON.stringify(raw)).not.toMatch(/ZZZTOKEN99|QQQ12345/)
  })

  it('request headers authorization and cookie are hidden; other headers are kept', () => {
    const out = once(net({ headers: { Authorization: 'Basic dXNlcjpwYXNz', Cookie: 'sid=abc', 'x-api-key': 'k123', Accept: 'application/json' } }))
    expect(out.d.headers.Authorization).toBe('[redacted]')
    expect(out.d.headers.Cookie).toBe('[redacted]')
    expect(out.d.headers['x-api-key']).toBe('[redacted]')
    expect(out.d.headers.Accept).toBe('application/json')
  })

  it('a function named signInWithToken has its args and return replaced outright', () => {
    const r = createRedactor()
    expect(r.redact(enter('auth.js:3:0:signInWithToken', ['plain-looking-value-123'])).a).toEqual({ $redacted: 'function' })
    expect(r.redact(ret('r1-1', 'also-plain')).v).toEqual({ $redacted: 'function' })
  })

  it('everything a denied function calls is hidden too: its calls, their return values, and requests made under it', () => {
    const r = createRedactor()
    r.redact(enter('auth.js:3:0:getAuthToken', ['plain-1']))
    expect(r.redact(enter('auth.js:9:0:exchange', ['plain-looking-code'], 'r1-2', 'r1-1')).a).toEqual({ $redacted: 'function' })
    expect(r.redact(net({ url: 'https://api.example.com/ok', body: 'plain-body' }, 'r1-2', 'r1-3')).d).toEqual({ $redacted: 'function' })
    expect(r.redact(ret('r1-2', 'plain-result')).v).toEqual({ $redacted: 'function' })
    r.redact(ret('r1-1', 'x'))
    // once it has returned, a later unrelated call is shown again
    expect(r.redact(enter('pr.js:1:0:merge', ['plain'], 'r1-4')).a).toEqual(['plain'])
  })

  it('a return or error whose call it never saw start is hidden, not shown', () => {
    expect(createRedactor().redact(ret('r1-77', 'plain-looking')).v).toEqual({ $redacted: 'unknown frame' })
    expect(createRedactor().redact({ k: 'err', id: 'r1-78', e: { name: 'Error', message: 'plain' }, t: 1, proc: 'main' }).e).toEqual({ $redacted: 'unknown frame' })
  })

  it('a body from a /oauth/token url is replaced outright', () => {
    const out = once(net({ method: 'POST', url: 'https://login.example.com/oauth/token', body: 'grant_type=x&code=plain', responseBody: '{"ok":"plain"}' }))
    expect(out.d).toEqual({ $redacted: 'url' })
  })

  it('an ipc call on a credential channel is replaced outright', () => {
    expect(once({ k: 'ipc', id: 'm1-1', p: null, d: { channel: 'oauth:start', args: ['plain'] }, t: 1, proc: 'main' }).d).toEqual({ $redacted: 'channel' })
  })

  it('names are matched by word: tokenize is shown, getAuthToken and sign_in are hidden', () => {
    expect(once(enter('md.js:1:0:tokenize', ['text'])).a).toEqual(['text'])
    expect(once(enter('a.js:1:0:getAuthToken', ['x'])).a).toEqual({ $redacted: 'function' })
    expect(once(enter('a.js:1:0:sign_in', ['x'])).a).toEqual({ $redacted: 'function' })
    expect(once(enter('a.js:1:0:changePassword', ['x'])).a).toEqual({ $redacted: 'function' })
  })

  it('a value no rule recognises is kept as is', () => {
    const e = once(enter('pr.js:9:0:merge', [{ title: 'Fix refund rounding', branch: 'feature/x', note: 'ordinary-text-20c' }]))
    expect(e.a[0].title).toBe('Fix refund rounding')
    expect(e.a[0].note).toBe('ordinary-text-20c')
  })

  it('the input event is not mutated', () => {
    const e = enter('x.js:1:0:f', [{ password: 'pw123456', a: 'Bearer abcdefghijklmnop1234' }])
    const copy = JSON.parse(JSON.stringify(e))
    once(e)
    expect(e).toEqual(copy)
  })

  it('exposes the default rules', () => {
    expect(DEFAULT_DENY.urls.length).toBeGreaterThan(0)
    expect(DEFAULT_DENY.functions.every(r => r instanceof RegExp)).toBe(true)
  })
})

describe('redactString (shared with the logs): token names with an underscore', () => {
  it('hides access_token=, refresh_token=, id_token= and client_secret= values, in query text and in JSON text', () => {
    for (const k of ['access_token', 'refresh_token', 'id_token', 'client_secret']) {
      expect(redactString(`https://h/p?${k}=VALUE123&z=1`)).not.toContain('VALUE123')
      expect(redactString(`{"${k}":"VALUE123","ok":1}`)).not.toContain('VALUE123')
    }
    expect(redactString('https://h/p?z=1&page=2')).toBe('https://h/p?z=1&page=2')
  })
})

describe('what a denied call leaves behind', () => {
  it('work that runs under a denied call after it has returned is still hidden', () => {
    const r = createRedactor()
    r.redact(enter('auth.js:3:0:getAuthToken', ['x'], 'r1-1'))
    r.redact(ret('r1-1', 'y'))
    // a timer or callback started inside it runs later, still carrying its frame as the parent
    expect(r.redact(enter('later.js:1:0:retry', ['plain-looking'], 'r1-5', 'r1-1')).a).toEqual({ $redacted: 'function' })
    expect(r.redact(net({ url: 'https://api.example.com/ok', body: 'plain' }, 'r1-1', 'r1-6')).d).toEqual({ $redacted: 'function' })
  })
})

describe('redactString: JSON text', () => {
  it('hides a secret value that contains an escaped quote, and a key that merely contains a secret word', () => {
    const out = redactString('{"accessToken":"abc\\"def-visible-tail","x_password_hint":"hint-text","ok":1}')
    expect(out).not.toMatch(/def-visible-tail|hint-text/)
    expect(JSON.parse(out).ok).toBe(1)
  })

  it('hides a whole object under a secret key, not only string values', () => {
    const out = redactString('{"credentials":{"pin":"1234","user":"bob"},"title":"Fix rounding"}')
    expect(out).not.toMatch(/1234|bob/)
    expect(JSON.parse(out).title).toBe('Fix rounding')
  })

  it('JSON text with nothing secret keeps its content', () => {
    expect(JSON.parse(redactString('{"a":1,"b":["x","y"]}'))).toEqual({ a: 1, b: ['x', 'y'] })
    expect(redactString('plain words, not JSON {oops')).toBe('plain words, not JSON {oops')
  })

  it('a request body kept in a recording is hidden the same way', () => {
    const out = createRedactor().redact(net({ method: 'POST', url: 'https://api.example.com/x', body: '{"client_secret":"hush-value","name":"n"}' }))
    expect(out.d.body).not.toContain('hush-value')
  })
})

describe('redactString: hostile input', () => {
  it('a megabytes-long string full of quotes is redacted quickly and comes back bounded', () => {
    const hostile = ('"' + 'x'.repeat(300)).repeat(4000)   // ~1.2 MB, 4000 quote starts with long quote-free runs
    const t0 = Date.now()
    const out = redactString(hostile)
    expect(Date.now() - t0).toBeLessThan(1500)
    expect(out.length).toBeLessThan(250000)
  })

  it('a long JSON text is still checked as JSON: a secret object near the start is hidden however long the text is', () => {
    const body = '{"credentials":{"pin":"9876"},"pad":"' + 'x'.repeat(250000) + '"}'
    const out = redactString(body)
    expect(out).not.toContain('9876')
    expect(out.length).toBeLessThan(260000)
  })

  it('JSON text too large to check is hidden, not passed on half-checked', () => {
    const body = '{"credentials":{"pin":"9876"},"pad":"' + 'x'.repeat(1100000) + '"}'
    const out = redactString(body)
    expect(out).not.toContain('9876')
    expect(out.length).toBeLessThan(200)
    expect(out).toMatch(/too large to check/)
  })

  it('a secret key with an ordinary-length name is still caught next to such text', () => {
    expect(redactString('junk "x" ... "api_key":"ABCD1234" tail')).not.toContain('ABCD1234')
  })
})

describe('IPC calls in a recording (frames named ipc:<channel>)', () => {
  it('a call on a credential channel has its arguments, result and everything it called hidden', () => {
    const r = createRedactor()
    expect(r.redact(enter('ipc:oauth:start', ['plain-looking'], 'm1-1')).a).toEqual({ $redacted: 'function' })
    expect(r.redact(enter('x.js:1:0:inner', ['plain-too'], 'm1-2', 'm1-1')).a).toEqual({ $redacted: 'function' })
    expect(r.redact(ret('m1-2', 'plain')).v).toEqual({ $redacted: 'function' })
    expect(r.redact(ret('m1-1', 'plain')).v).toEqual({ $redacted: 'function' })
  })
  it('an ordinary channel is shown', () => {
    expect(createRedactor().redact(enter('ipc:git:status', ['C:/repo'], 'm1-1')).a).toEqual(['C:/repo'])
  })
})

describe('a call whose parent has not been seen', () => {
  it('says whether the parent is known, by whether it has seen its start', () => {
    const r = createRedactor()
    expect(r.parentKnown(enter('x.js:1:0:f', [], 'r1-2', 'r1-1'))).toBe(false)
    expect(r.parentKnown(enter('x.js:1:0:f', [], 'r1-1', null))).toBe(true)
    r.redact(enter('x.js:1:0:parent', [], 'r1-1'))
    expect(r.parentKnown(enter('x.js:1:0:f', [], 'r1-2', 'r1-1'))).toBe(true)
  })

  it('is hidden when asked to be written without its parent, and its subtree with it', () => {
    const r = createRedactor()
    const child = r.redact(enter('ipc:git:push', ['plain-looking'], 'm1-1', 'r1-1'), { hideUnknownParent: true })
    expect(child.a).toEqual({ $redacted: 'parent unknown' })
    expect(r.redact(enter('x.js:1:0:inner', ['plain-too'], 'm1-2', 'm1-1')).a).toEqual({ $redacted: 'function' })
    expect(r.redact(ret('m1-1', 'plain'), { hideUnknownParent: true }).v).toEqual({ $redacted: 'function' })
  })

  it('is shown as usual when the option is not given (the default)', () => {
    expect(createRedactor().redact(enter('x.js:1:0:f', ['plain'], 'm1-1', 'r9-9')).a).toEqual(['plain'])
  })
})

describe("this app's own credentials (a PAT, the token stores)", () => {
  it('a value under the key pat is hidden, in an argument, a return value and JSON text, and path and pattern are not', () => {
    const arg = createRedactor().redact(enter('c.js:1:0:saveAdoConfig', [{ org: 'acme', pat: 'SEEDED-PAT-0123', path: '/repo', pattern: 'x*' }]))
    expect(arg.a[0]).toEqual({ org: 'acme', pat: '[redacted]', path: '/repo', pattern: 'x*' })
    expect(redactString('{"pat":"SEEDED-PAT-0123","path":"/repo"}')).toBe('{"pat":"[redacted]","path":"/repo"}')
    expect(redactString('https://x.example.com/a?pat=SEEDED-PAT-0123&path=/repo')).toBe('https://x.example.com/a?pat=[redacted]&path=/repo')
  })

  it('everything a token or secret store is given, returns, or calls is hidden, whatever its function is called', () => {
    const r = createRedactor()
    expect(r.redact(enter('modules/work/src/renderer/token-store.js:13:7:set', ['nexusmd.p.x.ado.pat', 'SEEDED-PAT-0123'], 'r1-1')).a).toEqual({ $redacted: 'function' })
    expect(r.redact(enter('packages/shell-sdk/src/profile-secrets.js:20:2:save', ['plain-looking'], 'r1-2', 'r1-1')).a).toEqual({ $redacted: 'function' })
    expect(r.redact(ret('r1-2', 'plain')).v).toEqual({ $redacted: 'function' })
    expect(r.redact(enter('packages/core/src/modules/profiles/secret-cache.js:17:15:peek', ['k'], 'r1-3')).a).toEqual({ $redacted: 'function' })
    expect(r.redact(ret('r1-3', 'SEEDED-PAT-0123')).v).toEqual({ $redacted: 'function' })
  })

  it('an ordinary file is not hidden because of what its neighbours are called', () => {
    expect(createRedactor().redact(enter('modules/work/src/renderer/ado-client.js:8:7:get', ['x'], 'r1-1')).a).toEqual(['x'])
  })
})

describe('a call that is given the name of a credential', () => {
  it('has its arguments, its result and everything it calls hidden: set(\'pat\', value) carries the value under no key', () => {
    const r = createRedactor()
    expect(r.redact(enter('packages/core/src/modules/ado/config.js:46:16:set', ['pat', 'SEEDED-PAT-0123'], 'r1-1')).a).toEqual({ $redacted: 'secret key' })
    expect(r.redact(enter('x.js:1:0:inner', ['plain-looking'], 'r1-2', 'r1-1')).a).toEqual({ $redacted: 'function' })
    expect(r.redact(ret('r1-1', undefined)).v).toEqual({ $redacted: 'function' })
  })

  it('hides what get(\'pat\') returns, and what a storage call with a credential key returns or is given', () => {
    const r = createRedactor()
    r.redact(enter('c.js:25:14:get', ['pat'], 'r1-1'))
    expect(r.redact(ret('r1-1', 'SEEDED-PAT-0123')).v).toEqual({ $redacted: 'function' })
    expect(r.redact(enter('s.js:1:0:setItem', ['nexusmd.p.x.ado.pat', 'SEEDED-PAT-0123'], 'r1-2')).a).toEqual({ $redacted: 'secret key' })
    expect(r.redact(enter('s.js:1:0:write', ['nexusmd.p.x.github.apiToken', 'v'], 'r1-3')).a).toEqual({ $redacted: 'secret key' })
  })

  it('leaves alone a call given an ordinary key, a path, or a sentence that mentions a PAT', () => {
    const r = createRedactor()
    expect(r.redact(enter('c.js:1:0:set', ['org', 'acme'], 'r1-1')).a).toEqual(['org', 'acme'])
    expect(r.redact(enter('c.js:1:0:get', ['path'], 'r1-2')).a).toEqual(['path'])
    expect(r.redact(enter('c.js:1:0:status', ['Enter org and PAT first.', 'plain'], 'r1-3')).a).toEqual(['Enter org and PAT first.', 'plain'])
    expect(r.redact(enter('c.js:1:0:load', [{ tokens: 3 }, 'x'], 'r1-4')).a[1]).toBe('x')
  })
})

describe('review finding: account passwords and the keys made from them', () => {
  const ACCOUNT = 'packages/core/src/modules/account/account-client.js'
  it('hides what authenticate is given (a password by position), whatever file it is in', () => {
    expect(createRedactor().redact(enter(`${ACCOUNT}:255:2:authenticate`, ['alice', 'hunter2-real'])).a).toEqual({ $redacted: 'function' })
    expect(createRedactor().redact(enter('somewhere/else.js:1:0:authenticateUser', ['alice', 'hunter2-real'])).a).toEqual({ $redacted: 'function' })
    expect(createRedactor().redact(enter('somewhere/else.js:1:0:login', ['alice', 'hunter2-real'])).a).toEqual({ $redacted: 'function' })
  })

  it('hides key derivation and the profile bundle code: what they take and what they return', () => {
    const r = createRedactor()
    expect(r.redact(enter('packages/core/src/modules/account/crypto.js:40:2:deriveKeys', ['pw', 'salt', 100000], 'r1-1')).a).toEqual({ $redacted: 'function' })
    expect(r.redact(ret('r1-1', { authKey: 'k1', vaultKey: 'k2' })).v).toEqual({ $redacted: 'function' })
    expect(r.redact(enter('packages/core/src/modules/profiles/bundle.js:10:0:encodeBundle', [{ profiles: [] }, 'bundle-password'], 'r1-2')).a).toEqual({ $redacted: 'function' })
    expect(r.redact(enter('packages/core/src/modules/profiles/bundle.js:30:0:bundleKeyHash', ['bundle-password'], 'r1-3')).a).toEqual({ $redacted: 'function' })
    expect(r.redact(enter('packages/core/src/modules/sync/crypto.js:10:0:encryptSync', ['plain-looking', 'key'], 'r1-4')).a).toEqual({ $redacted: 'function' })
  })

  it('hides a request to the account endpoints, and keys named authKey and vaultKey wherever they turn up', () => {
    expect(once(net({ method: 'POST', url: 'https://server.example.com/api/account/login', body: '{"username":"alice","authKey":"k1"}' })).d).toEqual({ $redacted: 'url' })
    expect(once(net({ method: 'POST', url: 'https://server.example.com/api/account/status' })).d).toEqual({ $redacted: 'url' })
    expect(once(enter('c.js:1:0:save', [{ username: 'bob', authKey: 'k1', vaultKey: 'k2', sessionAuthKey: 'k3' }])).a[0]).toEqual({ username: 'bob', authKey: '[redacted]', vaultKey: '[redacted]', sessionAuthKey: '[redacted]' })
  })

  it('does not hide the names that merely look like these', () => {
    expect(once(enter('c.js:1:0:authorSearch', ['plain'])).a).toEqual(['plain'])
    expect(once(enter('c.js:1:0:loginPageTitle', ['plain'])).a).toEqual({ $redacted: 'function' })   // a login screen's own helper: hiding it is the safe side
    expect(once(enter('c.js:1:0:keyboardShortcut', ['plain'])).a).toEqual(['plain'])
  })
})

describe('review note: the other code that makes keys from passwords', () => {
  it('hides the confidential planner and the settings export (they take a password and encrypt with it)', () => {
    const r = createRedactor()
    expect(r.redact(enter('packages/core/src/modules/planner/confidential.js:14:0:hashPassword', ['plain-pw'], 'r1-1')).a).toEqual({ $redacted: 'function' })
    expect(r.redact(enter('packages/core/src/modules/planner/confidential.js:37:0:encryptConfidentialForServer', [{ rows: [] }, 'hash'], 'r1-2')).a).toEqual({ $redacted: 'function' })
    expect(r.redact(enter('apps/desktop/src/settings-file.js:60:2:exportSettings', ['pw-for-the-file'], 'r1-3')).a).toEqual({ $redacted: 'function' })
  })
})
