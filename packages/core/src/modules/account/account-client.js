/**
 * Account client: talks to the NexusMD account/admin/device/item HTTP API.
 *
 * Zero-knowledge rules enforced here:
 *   - the password, vault key and container key are never sent; login sends only
 *     `authKey`, setup/redeem send salt/iterations/authKey/publicKey and the
 *     vault-wrapped private and container keys.
 *   - the client enforces the PBKDF2 floor (`minIterations`) on server-supplied
 *     params, so a hostile server cannot downgrade key stretching.
 *
 * @typedef {{ refreshToken: string, accessToken?: string, expiresAt?: number,
 *   username: string, userId: string, role: string, containerKey: string }} Session
 * @typedef {{ load(): Promise<Session|null>, save(s: Session|null): Promise<void> }} SessionStore
 */
import {
  MIN_ITERATIONS, randomSalt, deriveKeys,
  generateContainerKey, exportContainerKey, importContainerKey,
  wrapContainerKey, unwrapContainerKey,
  generateKeyPair, wrapPrivateKey, unwrapPrivateKey,
} from './crypto.js'

export class AccountError extends Error {
  /**
   * @param {'locked'|'invalid'|'disabled'|'conflict'|'offline'|'session-expired'|'not-found'|'server'} code
   * @param {number} status HTTP status, or 0 when no response was received
   * @param {string} [message]
   */
  constructor(code, status = 0, message) {
    super(message || code)
    this.name = 'AccountError'
    this.code = code
    this.status = status
  }
}

function codeForStatus(status) {
  if (status === 401 || status === 400) return 'invalid'
  if (status === 423) return 'locked'
  if (status === 403) return 'disabled'
  if (status === 409) return 'conflict'
  if (status === 404) return 'not-found'
  return 'server'
}

async function readBody(res) {
  try {
    const text = await res.text()
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

function messageOf(data, status) {
  const m = data && (data.error || data.message || data.title)
  return typeof m === 'string' && m ? m : `Request failed (${status})`
}

/**
 * @param {{ baseUrl: string, fetch?: typeof fetch, sessionStore: SessionStore, minIterations?: number }} opts
 */
export function createAccountClient({
  baseUrl,
  fetch: fetchImpl = globalThis.fetch,
  sessionStore,
  minIterations = MIN_ITERATIONS,
}) {
  const root = String(baseUrl || '').replace(/\/+$/, '')
  let session = null
  let loaded = false
  let refreshing = null

  /** One network round trip. Network failures become `offline`; HTTP errors are returned, not thrown. */
  async function send(method, path, { body, headers, token } = {}) {
    const h = { ...(headers || {}) }
    if (body !== undefined) h['Content-Type'] = 'application/json'
    if (token) h.Authorization = `Bearer ${token}`
    let res
    try {
      res = await fetchImpl(root + path, {
        method,
        headers: h,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new AccountError('offline', 0, 'Network unavailable')
    }
    return { status: res.status, ok: res.ok, data: await readBody(res) }
  }

  function check(r) {
    if (!r.ok) throw new AccountError(codeForStatus(r.status), r.status, messageOf(r.data, r.status))
    return r.data
  }

  async function setSession(next) {
    session = next
    loaded = true
    await sessionStore.save(next)
  }

  async function current() {
    if (!loaded) {
      session = (await sessionStore.load()) || null
      loaded = true
    }
    return session
  }

  function buildSession(resp, containerKeyB64) {
    if (!resp || typeof resp.accessToken !== 'string' || typeof resp.refreshToken !== 'string' || !resp.user) {
      throw new AccountError('server', 0, 'Malformed session response')
    }
    return {
      refreshToken: resp.refreshToken,
      accessToken: resp.accessToken,
      expiresAt: Number.isFinite(resp.expiresIn) ? Date.now() + resp.expiresIn * 1000 : undefined,
      username: resp.user.username,
      userId: resp.user.id,
      role: resp.user.role,
      containerKey: containerKeyB64,
    }
  }

  /** Rotate the token pair. Only a 401 answer ends the session; network/server errors keep it. */
  function refresh() {
    if (refreshing) return refreshing
    refreshing = (async () => {
      const s = await current()
      if (!s || !s.refreshToken) throw new AccountError('session-expired', 401, 'Not signed in')
      const r = await send('POST', '/api/account/refresh', { body: { refreshToken: s.refreshToken } })
      if (r.status === 401) {
        await setSession(null)
        throw new AccountError('session-expired', 401, 'Session expired')
      }
      const data = check(r)
      if (!data || typeof data.accessToken !== 'string' || typeof data.refreshToken !== 'string') {
        throw new AccountError('server', r.status, 'Malformed refresh response')
      }
      const next = {
        ...s,
        refreshToken: data.refreshToken,
        accessToken: data.accessToken,
        expiresAt: Number.isFinite(data.expiresIn) ? Date.now() + data.expiresIn * 1000 : undefined,
      }
      if (data.user && data.user.role) next.role = data.user.role
      await setSession(next)
      return next
    })().finally(() => { refreshing = null })
    return refreshing
  }

  /** Authenticated call: refreshes once on 401, then retries. */
  async function authed(method, path, opts = {}) {
    let s = await current()
    if (!s) throw new AccountError('session-expired', 401, 'Not signed in')
    if (!s.accessToken) s = await refresh()
    const used = s.accessToken
    const bodyOf = (sess) => (typeof opts.body === 'function' ? opts.body(sess) : opts.body)
    let r = await send(method, path, { ...opts, body: bodyOf(s), token: used })
    if (r.status === 401) {
      // Another call may already have rotated the token while this one was in flight.
      const now = await current()
      if (!now) throw new AccountError('session-expired', 401, 'Session expired')
      s = now.accessToken && now.accessToken !== used ? now : await refresh()
      r = await send(method, path, { ...opts, body: bodyOf(s), token: s.accessToken })
    }
    return check(r)
  }

  function requireIterations(params) {
    if (
      !params || typeof params.salt !== 'string'
      || !Number.isInteger(params.iterations)
    ) {
      throw new AccountError('invalid', 0, 'Malformed key parameters from server')
    }
    if (params.iterations < minIterations) {
      throw new AccountError('invalid', 0,
        `Server requested ${params.iterations} PBKDF2 iterations; at least ${minIterations} are required`)
    }
  }

  async function fetchParams(username) {
    const data = check(await send('GET', `/api/account/params?username=${encodeURIComponent(username)}`))
    requireIterations(data)
    return data
  }

  async function createAccount(path, extra, { username, password }) {
    const iterations = minIterations
    const salt = randomSalt()
    const { authKey, vaultKey } = await deriveKeys(password, salt, iterations)
    const ck = await generateContainerKey()
    const { publicKey, privateKey } = await generateKeyPair()
    const body = {
      ...extra,
      username,
      salt,
      iterations,
      authKey,
      publicKey,
      wrappedPrivateKey: await wrapPrivateKey(privateKey, vaultKey),
      wrappedContainerKey: await wrapContainerKey(ck, vaultKey),
    }
    const resp = check(await send('POST', path, { body }))
    const next = buildSession(resp, exportContainerKey(ck))
    await setSession(next)
    return { session: next, containerKey: ck }
  }

  /** Params + derive + authenticate. Returns the raw server session and the derived vault key. */
  async function authenticate(username, password) {
    const params = await fetchParams(username)
    const { authKey, vaultKey } = await deriveKeys(password, params.salt, params.iterations)
    const resp = check(await send('POST', '/api/account/login', { body: { username, authKey } }))
    return { resp, vaultKey, authKey }
  }

  return {
    async status() {
      const data = check(await send('GET', '/api/account/status'))
      return { needsSetup: !!(data && data.needsSetup) }
    },

    setup({ setupToken, username, password }) {
      return createAccount('/api/account/setup', { setupToken }, { username, password })
    },

    redeem({ inviteCode, username, password }) {
      return createAccount('/api/account/redeem', { inviteCode }, { username, password })
    },

    async login({ username, password }) {
      const { resp, vaultKey } = await authenticate(username, password)
      let ck
      try {
        ck = await unwrapContainerKey(resp.wrappedContainerKey, vaultKey)
      } catch {
        throw new AccountError('invalid', 0, 'Could not unlock the account keys')
      }
      const next = buildSession(resp, exportContainerKey(ck))
      await setSession(next)
      return { session: next, containerKey: ck }
    },

    /** The current session (loaded from the store on first use), or null. */
    getSession() {
      return current()
    },

    /** Revoke the refresh token on the server (best effort) and always clear the local session. */
    async logout() {
      const s = await current()
      try {
        if (s && s.refreshToken) {
          // The body is built per attempt so a mid-call refresh revokes the rotated token.
          await authed('POST', '/api/account/logout', { body: (cur) => ({ refreshToken: cur.refreshToken }) })
        }
      } catch {
        // Offline or already expired: the local session is still cleared below.
      }
      await setSession(null)
    },

    /**
     * Re-authenticates with the current password (proving it and fetching the wrapped keys),
     * re-wraps the container key and private key under the new password with a fresh salt, and
     * adopts the new session (the server revokes the caller's other sessions).
     */
    async changePassword({ currentPassword, newPassword }) {
      const s = await current()
      if (!s) throw new AccountError('session-expired', 401, 'Not signed in')
      const { resp, vaultKey: oldVault, authKey: currentAuthKey } = await authenticate(s.username, currentPassword)
      let ck
      let privateKey
      try {
        ck = await unwrapContainerKey(resp.wrappedContainerKey, oldVault)
        privateKey = await unwrapPrivateKey(resp.wrappedPrivateKey, oldVault)
      } catch {
        throw new AccountError('invalid', 0, 'Could not unlock the account keys')
      }
      const iterations = minIterations
      const salt = randomSalt()
      const { authKey, vaultKey } = await deriveKeys(newPassword, salt, iterations)
      const body = {
        currentAuthKey,
        salt,
        iterations,
        authKey,
        wrappedPrivateKey: await wrapPrivateKey(privateKey, vaultKey),
        wrappedContainerKey: await wrapContainerKey(ck, vaultKey),
      }
      // Use the freshly issued tokens: the server keeps the caller's session and revokes the rest.
      await setSession(buildSession(resp, exportContainerKey(ck)))
      await authed('POST', '/api/account/change-password', { body })
      return { session, containerKey: await importContainerKey(session.containerKey) }
    },

    listDevices: () => authed('GET', '/api/devices'),
    createDevice: ({ name, platform }) => authed('POST', '/api/devices', { body: { name, platform } }),
    renameDevice: (id, name) => authed('PUT', `/api/devices/${encodeURIComponent(id)}`, { body: { name } }),
    deleteDevice: (id) => authed('DELETE', `/api/devices/${encodeURIComponent(id)}`),
    getDevicePrefs: (id) => authed('GET', `/api/devices/${encodeURIComponent(id)}/prefs`),
    putDevicePrefs: (id, ciphertext, revision) => authed('PUT', `/api/devices/${encodeURIComponent(id)}/prefs`, {
      body: { ciphertext },
      headers: { 'If-Match': String(revision) },
    }),

    async putItems(items) {
      const body = {
        items: items.map((i) => ({
          id: i.id,
          ifMatch: i.ifMatch,
          ciphertext: i.ciphertext,
          deleted: !!i.deleted,
        })),
      }
      const data = await authed('POST', '/api/items/batch', { body })
      return data.results
    },

    getChanges(since = 0, limit) {
      const q = `since=${encodeURIComponent(since)}${limit ? `&limit=${encodeURIComponent(limit)}` : ''}`
      return authed('GET', `/api/items/changes?${q}`)
    },

    createInvite: ({ ttlHours } = {}) => authed('POST', '/api/admin/invites', { body: { ttlHours } }),
    listInvites: () => authed('GET', '/api/admin/invites'),
    revokeInvite: (id) => authed('DELETE', `/api/admin/invites/${encodeURIComponent(id)}`),
    listUsers: () => authed('GET', '/api/admin/users'),
    setUserDisabled: (id, disabled) => authed(
      'POST',
      `/api/admin/users/${encodeURIComponent(id)}/${disabled ? 'disable' : 'enable'}`,
    ),
  }
}
