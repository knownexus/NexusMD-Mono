import { describe, it, expect, beforeEach } from 'vitest'
import {
  createAccountClient, AccountError,
} from '../src/modules/account/account-client.js'
import {
  MIN_ITERATIONS, deriveKeys, exportContainerKey, unwrapContainerKey, unwrapPrivateKey,
} from '../src/modules/account/crypto.js'
import * as core from '../src/index.js'

const ITER = 1000
const BASE = 'https://nexus.test'

function memoryStore(initial = null) {
  const store = {
    value: initial,
    saves: [],
    async load() { return store.value },
    async save(s) { store.saves.push(s); store.value = s },
  }
  return store
}

function json(status, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Stateful in-memory stand-in for the account server. It stores whatever the client
 * sends verbatim (as the real server does) and records every request.
 */
function fakeServer({ paramsOverride, failRefresh } = {}) {
  const state = {
    users: new Map(), // lowercased username -> record
    accessTokens: new Map(), // token -> userId
    refreshTokens: new Map(), // token -> userId
    requests: [],
    counter: 0,
    needsSetup: true,
    refreshCalls: 0,
    failRefresh: failRefresh || null, // 'network' | '401'
    rejectAccess: new Set(), // access tokens forced to 401
  }
  const issue = (u) => {
    state.counter += 1
    const accessToken = `at-${state.counter}`
    const refreshToken = `rt-${state.counter}`
    state.accessTokens.set(accessToken, u.id)
    state.refreshTokens.set(refreshToken, u.id)
    return {
      accessToken,
      refreshToken,
      expiresIn: 900,
      user: { id: u.id, username: u.username, role: u.role },
      salt: u.salt,
      iterations: u.iterations,
      publicKey: u.publicKey,
      wrappedPrivateKey: u.wrappedPrivateKey,
      wrappedContainerKey: u.wrappedContainerKey,
    }
  }
  const create = (body, role) => {
    const u = {
      id: `u${state.users.size + 1}`,
      username: body.username,
      role,
      salt: body.salt,
      iterations: body.iterations,
      authKey: body.authKey,
      publicKey: body.publicKey,
      wrappedPrivateKey: body.wrappedPrivateKey,
      wrappedContainerKey: body.wrappedContainerKey,
    }
    state.users.set(body.username.toLowerCase(), u)
    return u
  }
  const userFor = (req) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '')
    if (!m || state.rejectAccess.has(m[1])) return null
    const id = state.accessTokens.get(m[1])
    return id ? [...state.users.values()].find((u) => u.id === id) : null
  }

  async function fetch(url, init = {}) {
    const u = new URL(url)
    const headers = {}
    for (const [k, v] of Object.entries(init.headers || {})) headers[k.toLowerCase()] = v
    const req = {
      method: init.method || 'GET',
      path: u.pathname,
      search: u.search,
      query: u.searchParams,
      headers,
      raw: init.body,
      body: init.body ? JSON.parse(init.body) : undefined,
    }
    state.requests.push(req)
    const key = `${req.method} ${req.path}`

    if (key === 'GET /api/account/status') return json(200, { needsSetup: state.needsSetup })
    if (key === 'GET /api/account/params') {
      if (paramsOverride) return json(200, paramsOverride)
      const rec = state.users.get((req.query.get('username') || '').toLowerCase())
      return rec
        ? json(200, { salt: rec.salt, iterations: rec.iterations })
        : json(200, { salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iterations: MIN_ITERATIONS })
    }
    if (key === 'POST /api/account/setup') {
      if (!state.needsSetup) return json(409, { error: 'already set up' })
      state.needsSetup = false
      return json(201, issue(create(req.body, 'admin')))
    }
    if (key === 'POST /api/account/redeem') {
      if (state.users.has(req.body.username.toLowerCase())) return json(409, { error: 'taken' })
      return json(201, issue(create(req.body, 'user')))
    }
    if (key === 'POST /api/account/login') {
      const rec = state.users.get(req.body.username.toLowerCase())
      if (rec?.locked) return json(423, { error: 'locked' })
      if (rec?.disabled) return json(403, { error: 'disabled' })
      if (!rec || rec.authKey !== req.body.authKey) return json(401, { error: 'invalid' })
      return json(200, issue(rec))
    }
    if (key === 'POST /api/account/refresh') {
      state.refreshCalls += 1
      if (state.failRefresh === 'network') throw new TypeError('network down')
      const id = state.refreshTokens.get(req.body.refreshToken)
      if (state.failRefresh === '401' || !id) return json(401, { error: 'invalid' })
      state.refreshTokens.delete(req.body.refreshToken)
      return json(200, issue([...state.users.values()].find((x) => x.id === id)))
    }
    if (key === 'POST /api/account/logout') {
      if (!userFor(req)) return json(401, {})
      state.refreshTokens.delete(req.body.refreshToken)
      return new Response(null, { status: 204 })
    }
    if (key === 'POST /api/account/change-password') {
      const user = userFor(req)
      if (!user) return json(401, {})
      if (user.authKey !== req.body.currentAuthKey) return json(401, { error: 'invalid' })
      Object.assign(user, {
        salt: req.body.salt,
        iterations: req.body.iterations,
        authKey: req.body.authKey,
        wrappedPrivateKey: req.body.wrappedPrivateKey,
        wrappedContainerKey: req.body.wrappedContainerKey,
      })
      // Revoke every session except the caller's.
      const caller = /^Bearer (.+)$/.exec(req.headers.authorization)[1]
      for (const t of [...state.accessTokens.keys()]) if (t !== caller) state.accessTokens.delete(t)
      return new Response(null, { status: 204 })
    }
    return state.extra ? state.extra(req, userFor(req)) : json(404, {})
  }

  return { state, fetch }
}

function setup(opts = {}, clientOpts = {}) {
  const server = fakeServer(opts)
  const store = memoryStore()
  const client = createAccountClient({
    baseUrl: `${BASE}/`,
    fetch: server.fetch,
    sessionStore: store,
    minIterations: ITER,
    ...clientOpts,
  })
  return { server, store, client }
}

describe('public API', () => {
  it('exports the account client from the package root', () => {
    expect(core.createAccountClient).toBe(createAccountClient)
    expect(core.AccountError).toBe(AccountError)
  })
})

describe('status', () => {
  it('returns needsSetup', async () => {
    const { client } = setup()
    expect(await client.status()).toEqual({ needsSetup: true })
  })

  it('maps a network rejection to offline', async () => {
    const client = createAccountClient({
      baseUrl: BASE,
      fetch: async () => { throw new TypeError('Failed to fetch') },
      sessionStore: memoryStore(),
    })
    await expect(client.status()).rejects.toMatchObject({ name: 'AccountError', code: 'offline' })
  })
})

describe('setup and redeem', () => {
  it('sends only derived and wrapped material and saves the session', async () => {
    const { server, store, client } = setup()
    const { session, containerKey } = await client.setup({ setupToken: 'tok', username: 'Ada', password: 'hunter2 correct' })

    const req = server.state.requests.find((r) => r.path === '/api/account/setup')
    expect(Object.keys(req.body).sort()).toEqual([
      'authKey', 'iterations', 'publicKey', 'salt', 'setupToken', 'username',
      'wrappedContainerKey', 'wrappedPrivateKey',
    ])
    expect(req.raw).not.toContain('hunter2')
    expect(req.body.iterations).toBe(ITER)
    expect(session).toMatchObject({ username: 'Ada', role: 'admin', userId: 'u1' })
    expect(session.containerKey).toBe(exportContainerKey(containerKey))
    expect(session.refreshToken).toBe('rt-1')
    expect(store.value).toEqual(session)

    // The wrapped key the server holds opens with a key derived from the password.
    const { vaultKey } = await deriveKeys('hunter2 correct', req.body.salt, req.body.iterations)
    const ck = await unwrapContainerKey(req.body.wrappedContainerKey, vaultKey)
    expect(exportContainerKey(ck)).toBe(session.containerKey)
    await unwrapPrivateKey(req.body.wrappedPrivateKey, vaultKey)
  })

  it('never sends an iteration count below the production floor by default', async () => {
    const { server, client } = setup({}, { minIterations: undefined })
    await client.setup({ setupToken: 't', username: 'ada', password: 'pw' })
    const req = server.state.requests.find((r) => r.path === '/api/account/setup')
    expect(req.body.iterations).toBe(MIN_ITERATIONS)
  })

  it('redeem posts the invite code and returns a user session', async () => {
    const { server, client } = setup()
    server.state.needsSetup = false
    const { session } = await client.redeem({ inviteCode: 'INV', username: 'bob', password: 'pw' })
    const req = server.state.requests.find((r) => r.path === '/api/account/redeem')
    expect(req.body.inviteCode).toBe('INV')
    expect(req.raw).not.toContain('"password"')
    expect(session.role).toBe('user')
  })

  it('maps 409 to conflict', async () => {
    const { client } = setup()
    await client.setup({ setupToken: 't', username: 'ada', password: 'pw' })
    await expect(client.setup({ setupToken: 't', username: 'eve', password: 'pw' }))
      .rejects.toMatchObject({ code: 'conflict', status: 409 })
  })
})

describe('login', () => {
  let ctx
  beforeEach(async () => {
    ctx = setup()
    await ctx.client.setup({ setupToken: 't', username: 'ada', password: 'correct horse' })
    ctx.server.state.requests.length = 0
    ctx.store.saves.length = 0
  })

  it('derives keys from the server params and sends only the authKey', async () => {
    const { client, server, store } = ctx
    const { session, containerKey } = await client.login({ username: 'ada', password: 'correct horse' })

    const paramsReq = server.state.requests[0]
    expect(paramsReq.path).toBe('/api/account/params')
    expect(paramsReq.search).toBe('?username=ada')

    const loginReq = server.state.requests.find((r) => r.path === '/api/account/login')
    expect(Object.keys(loginReq.body).sort()).toEqual(['authKey', 'username'])
    expect(loginReq.raw).not.toContain('correct horse')

    const rec = server.state.users.get('ada')
    const { authKey, vaultKey } = await deriveKeys('correct horse', rec.salt, rec.iterations)
    expect(loginReq.body.authKey).toBe(authKey)
    // Nothing on the wire carries the vault key or container key.
    const wire = server.state.requests.map((r) => r.raw || '').join('|') + paramsReq.search
    expect(wire).not.toContain(session.containerKey)
    expect(wire).not.toContain(exportContainerKey(containerKey))
    expect(await unwrapContainerKey(rec.wrappedContainerKey, vaultKey)).toBeTruthy()

    expect(session.containerKey).toBe(exportContainerKey(containerKey))
    expect(store.value).toEqual(session)
  })

  it('rejects server params below minIterations before sending any login request', async () => {
    const down = setup(
      { paramsOverride: { salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iterations: ITER } },
      { minIterations: 600000 },
    )
    await expect(down.client.login({ username: 'ada', password: 'pw' }))
      .rejects.toMatchObject({ name: 'AccountError', code: 'invalid' })
    expect(down.server.state.requests.map((r) => r.path)).toEqual(['/api/account/params'])
    expect(down.store.saves).toEqual([])
  })

  it('rejects malformed params (non-integer iterations)', async () => {
    const bad = setup({ paramsOverride: { salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iterations: '1000' } })
    await expect(bad.client.login({ username: 'ada', password: 'pw' })).rejects.toMatchObject({ code: 'invalid' })
    expect(bad.server.state.requests.some((r) => r.path === '/api/account/login')).toBe(false)
  })

  it('wrong password -> invalid and nothing saved', async () => {
    await expect(ctx.client.login({ username: 'ada', password: 'nope' }))
      .rejects.toMatchObject({ name: 'AccountError', code: 'invalid', status: 401 })
    expect(ctx.store.saves).toEqual([])
  })

  it('unknown user -> invalid', async () => {
    await expect(ctx.client.login({ username: 'ghost', password: 'nope' }))
      .rejects.toMatchObject({ code: 'invalid' })
  })

  it('maps 423 to locked and 403 to disabled', async () => {
    ctx.server.state.users.get('ada').locked = true
    await expect(ctx.client.login({ username: 'ada', password: 'correct horse' }))
      .rejects.toMatchObject({ code: 'locked', status: 423 })
    ctx.server.state.users.get('ada').locked = false
    ctx.server.state.users.get('ada').disabled = true
    await expect(ctx.client.login({ username: 'ada', password: 'correct horse' }))
      .rejects.toMatchObject({ code: 'disabled', status: 403 })
  })

  it('maps a network failure to offline', async () => {
    const client = createAccountClient({
      baseUrl: BASE,
      fetch: async () => { throw new TypeError('down') },
      sessionStore: memoryStore(),
      minIterations: ITER,
    })
    await expect(client.login({ username: 'ada', password: 'x' })).rejects.toMatchObject({ code: 'offline' })
  })
})

describe('authenticated calls and refresh', () => {
  let ctx
  beforeEach(async () => {
    ctx = setup()
    ctx.server.state.extra = (req, user) => {
      if (!user) return json(401, {})
      if (req.method === 'GET' && req.path === '/api/devices') return json(200, [{ id: 'd1', name: 'Laptop', platform: 'web', updatedAt: 't' }])
      return json(404, {})
    }
    await ctx.client.setup({ setupToken: 't', username: 'ada', password: 'pw' })
    ctx.server.state.requests.length = 0
    ctx.store.saves.length = 0
  })

  it('sends the bearer token', async () => {
    await ctx.client.listDevices()
    expect(ctx.server.state.requests[0].headers.authorization).toBe('Bearer at-1')
    expect(ctx.server.state.refreshCalls).toBe(0)
  })

  it('refreshes exactly once on 401, retries, and saves the rotated token', async () => {
    ctx.server.state.rejectAccess.add('at-1')
    const devices = await ctx.client.listDevices()
    expect(devices).toHaveLength(1)
    expect(ctx.server.state.refreshCalls).toBe(1)
    const paths = ctx.server.state.requests.map((r) => r.path)
    expect(paths).toEqual(['/api/devices', '/api/account/refresh', '/api/devices'])
    expect(ctx.server.state.requests[1].body).toEqual({ refreshToken: 'rt-1' })
    expect(ctx.server.state.requests[2].headers.authorization).toBe('Bearer at-2')

    const saved = ctx.store.saves.at(-1)
    expect(saved.refreshToken).toBe('rt-2')
    expect(saved.accessToken).toBe('at-2')
    expect(saved.containerKey).toBe(ctx.store.value.containerKey)
    expect(saved.username).toBe('ada')

    // The next call uses the rotated token and does not refresh again.
    await ctx.client.listDevices()
    expect(ctx.server.state.refreshCalls).toBe(1)
  })

  it('does not loop when the retry is also rejected', async () => {
    ctx.server.state.extra = () => json(401, {})
    await expect(ctx.client.listDevices()).rejects.toMatchObject({ code: 'invalid' })
    expect(ctx.server.state.refreshCalls).toBe(1)
  })

  it('refresh answered 401 -> session-expired and the stored session is cleared', async () => {
    ctx.server.state.rejectAccess.add('at-1')
    ctx.server.state.failRefresh = '401'
    await expect(ctx.client.listDevices()).rejects.toMatchObject({ code: 'session-expired' })
    expect(ctx.store.saves.at(-1)).toBeNull()
    expect(ctx.store.value).toBeNull()
    await expect(ctx.client.listDevices()).rejects.toMatchObject({ code: 'session-expired' })
  })

  it('refresh failing on the network -> offline and the session is kept', async () => {
    ctx.server.state.rejectAccess.add('at-1')
    ctx.server.state.failRefresh = 'network'
    await expect(ctx.client.listDevices()).rejects.toMatchObject({ code: 'offline' })
    expect(ctx.store.saves).not.toContain(null)
    expect(ctx.store.value).not.toBeNull()
    expect(ctx.store.value.refreshToken).toBe('rt-1')
  })

  it('without any session, authed calls fail with session-expired and make no request', async () => {
    const { client, server } = setup()
    await expect(client.listDevices()).rejects.toMatchObject({ code: 'session-expired' })
    expect(server.state.requests).toEqual([])
  })

  it('loads a stored session lazily and refreshes when it has no access token', async () => {
    const fresh = createAccountClient({
      baseUrl: BASE,
      fetch: ctx.server.fetch,
      sessionStore: memoryStore({ ...ctx.store.value, accessToken: undefined, expiresAt: undefined }),
      minIterations: ITER,
    })
    ctx.server.state.requests.length = 0
    await fresh.listDevices()
    expect(ctx.server.state.requests.map((r) => r.path)).toEqual(['/api/account/refresh', '/api/devices'])
  })

  it('logout revokes the refresh token and clears the stored session', async () => {
    await ctx.client.logout()
    const req = ctx.server.state.requests.find((r) => r.path === '/api/account/logout')
    expect(req.body).toEqual({ refreshToken: 'rt-1' })
    expect(ctx.store.value).toBeNull()
    await expect(ctx.client.listDevices()).rejects.toMatchObject({ code: 'session-expired' })
  })

  it('logout clears the local session even when the server is unreachable', async () => {
    const offline = createAccountClient({
      baseUrl: BASE,
      fetch: async () => { throw new TypeError('down') },
      sessionStore: memoryStore({ ...ctx.store.value }),
      minIterations: ITER,
    })
    await offline.logout()
    expect(await offline.getSession()).toBeNull()
  })
})

describe('changePassword', () => {
  it('re-wraps both keys under the new password with a new salt; the container key survives', async () => {
    const { server, store, client } = setup()
    const first = await client.setup({ setupToken: 't', username: 'ada', password: 'old pw' })
    const rec = server.state.users.get('ada')
    const oldSalt = rec.salt
    const oldAuth = rec.authKey
    const oldPub = rec.publicKey
    server.state.requests.length = 0

    await client.changePassword({ currentPassword: 'old pw', newPassword: 'new pw' })

    const req = server.state.requests.find((r) => r.path === '/api/account/change-password')
    expect(Object.keys(req.body).sort()).toEqual([
      'authKey', 'currentAuthKey', 'iterations', 'salt', 'wrappedContainerKey', 'wrappedPrivateKey',
    ])
    expect(req.raw).not.toContain('old pw')
    expect(req.raw).not.toContain('new pw')
    expect(req.body.currentAuthKey).toBe(oldAuth)
    expect(req.body.salt).not.toBe(oldSalt)
    expect(req.body.iterations).toBeGreaterThanOrEqual(ITER)
    expect(rec.publicKey).toBe(oldPub)

    const { vaultKey, authKey } = await deriveKeys('new pw', rec.salt, rec.iterations)
    expect(rec.authKey).toBe(authKey)
    const ck = await unwrapContainerKey(rec.wrappedContainerKey, vaultKey)
    expect(exportContainerKey(ck)).toBe(first.session.containerKey)
    await unwrapPrivateKey(rec.wrappedPrivateKey, vaultKey)

    // The old password no longer logs in, the new one does and yields the same container key.
    await expect(client.login({ username: 'ada', password: 'old pw' })).rejects.toMatchObject({ code: 'invalid' })
    const again = await client.login({ username: 'ada', password: 'new pw' })
    expect(again.session.containerKey).toBe(first.session.containerKey)
    expect(store.value.containerKey).toBe(first.session.containerKey)
  })

  it('keeps the caller signed in after the other sessions are revoked', async () => {
    const { server, store, client } = setup()
    await client.setup({ setupToken: 't', username: 'ada', password: 'old pw' })
    server.state.extra = (req, user) => (user ? json(200, []) : json(401, {}))
    await client.changePassword({ currentPassword: 'old pw', newPassword: 'new pw' })
    server.state.requests.length = 0
    await client.listDevices()
    expect(server.state.refreshCalls).toBe(0)
    expect(store.value).not.toBeNull()
  })

  it('wrong current password -> invalid and nothing changes', async () => {
    const { server, client } = setup()
    await client.setup({ setupToken: 't', username: 'ada', password: 'old pw' })
    const before = { ...server.state.users.get('ada') }
    await expect(client.changePassword({ currentPassword: 'wrong', newPassword: 'new pw' }))
      .rejects.toMatchObject({ code: 'invalid' })
    expect(server.state.users.get('ada')).toEqual(before)
    expect(server.state.requests.some((r) => r.path === '/api/account/change-password')).toBe(false)
  })

  it('rejects a downgraded params response before any request that carries a key', async () => {
    const down = setup(
      { paramsOverride: { salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iterations: ITER } },
      { minIterations: 600000 },
    )
    down.store.value = {
      refreshToken: 'rt', accessToken: 'at', username: 'ada', userId: 'u1', role: 'user', containerKey: 'x',
    }
    await expect(down.client.changePassword({ currentPassword: 'a', newPassword: 'b' }))
      .rejects.toMatchObject({ code: 'invalid' })
    expect(down.server.state.requests.map((r) => r.path)).toEqual(['/api/account/params'])
  })
})

describe('devices, prefs, items and admin', () => {
  let ctx
  const calls = []
  beforeEach(async () => {
    calls.length = 0
    ctx = setup()
    ctx.server.state.extra = (req, user) => {
      if (!user) return json(401, {})
      calls.push(req)
      const key = `${req.method} ${req.path}`
      if (key === 'POST /api/devices') return json(201, { id: 'd2', ...req.body })
      if (key === 'PUT /api/devices/d2') return json(200, { id: 'd2', ...req.body })
      if (key === 'DELETE /api/devices/d2') return new Response(null, { status: 204 })
      if (key === 'GET /api/devices/d2/prefs') return json(200, { revision: 3, ciphertext: 'abc' })
      if (key === 'PUT /api/devices/d2/prefs') {
        return req.headers['if-match'] === '3' ? json(200, { revision: 4 }) : json(409, {})
      }
      if (key === 'POST /api/items/batch') {
        return json(200, { results: req.body.items.map((i) => ({ id: i.id, status: i.ifMatch === 0 ? 'ok' : 'conflict', revision: 1, cursor: 1 })) })
      }
      if (key === 'GET /api/items/changes') return json(200, { items: [], cursor: Number(req.query.get('since')) })
      if (key === 'POST /api/admin/invites') return json(200, { id: 'i1', code: 'CODE', expiresAt: 'x' })
      if (key === 'GET /api/admin/invites') return json(200, [{ id: 'i1' }])
      if (key === 'DELETE /api/admin/invites/i1') return new Response(null, { status: 204 })
      if (key === 'GET /api/admin/users') return json(200, [{ id: 'u1' }])
      if (key === 'POST /api/admin/users/u2/disable') return new Response(null, { status: 204 })
      if (key === 'POST /api/admin/users/u2/enable') return new Response(null, { status: 204 })
      return json(404, {})
    }
    await ctx.client.setup({ setupToken: 't', username: 'ada', password: 'pw' })
  })

  it('device CRUD', async () => {
    expect(await ctx.client.createDevice({ name: 'Phone', platform: 'ios' })).toMatchObject({ id: 'd2', name: 'Phone' })
    await ctx.client.renameDevice('d2', 'Tablet')
    expect(calls.at(-1).body).toEqual({ name: 'Tablet' })
    await ctx.client.deleteDevice('d2')
    expect(calls.at(-1).method).toBe('DELETE')
  })

  it('prefs carry the revision in If-Match and 409 maps to conflict', async () => {
    expect(await ctx.client.getDevicePrefs('d2')).toEqual({ revision: 3, ciphertext: 'abc' })
    expect(await ctx.client.putDevicePrefs('d2', 'zzz', 3)).toEqual({ revision: 4 })
    const put = calls.at(-1)
    expect(put.headers['if-match']).toBe('3')
    expect(put.body).toEqual({ ciphertext: 'zzz' })
    await expect(ctx.client.putDevicePrefs('d2', 'zzz', 2)).rejects.toMatchObject({ code: 'conflict', status: 409 })
  })

  it('putItems posts a batch and returns the results; getChanges passes the cursor', async () => {
    const results = await ctx.client.putItems([
      { id: 'a', ifMatch: 0, ciphertext: 'c1' },
      { id: 'b', ifMatch: 2, ciphertext: 'c2', deleted: true },
    ])
    expect(calls.at(-1).body.items).toEqual([
      { id: 'a', ifMatch: 0, ciphertext: 'c1', deleted: false },
      { id: 'b', ifMatch: 2, ciphertext: 'c2', deleted: true },
    ])
    expect(results.map((r) => r.status)).toEqual(['ok', 'conflict'])

    expect(await ctx.client.getChanges(42)).toEqual({ items: [], cursor: 42 })
    expect(calls.at(-1).query.get('since')).toBe('42')
  })

  it('admin calls', async () => {
    expect(await ctx.client.createInvite({ ttlHours: 24 })).toMatchObject({ code: 'CODE' })
    expect(calls.at(-1).body).toEqual({ ttlHours: 24 })
    expect(await ctx.client.listInvites()).toHaveLength(1)
    await ctx.client.revokeInvite('i1')
    expect(await ctx.client.listUsers()).toHaveLength(1)
    await ctx.client.setUserDisabled('u2', true)
    expect(calls.at(-1).path).toBe('/api/admin/users/u2/disable')
    await ctx.client.setUserDisabled('u2', false)
    expect(calls.at(-1).path).toBe('/api/admin/users/u2/enable')
  })
})
