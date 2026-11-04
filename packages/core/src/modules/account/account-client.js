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
   * @param {'locked'|'invalid'|'invalid-invite'|'disabled'|'forbidden'|'conflict'|'offline'|'session-expired'|'keys-corrupt'|'not-found'|'server'} code
   *   'disabled' is only produced by a login 403; any other 403 (wrong setup token, non-admin) is 'forbidden'.
   *   'keys-corrupt' means the server accepted the credentials but the wrapped keys do not open.
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

const MAX_ITERATIONS = 10_000_000 // mirrors the deriveKeys upper bound
const SALT_BYTES = 16

/** Sync format this client speaks; servers configured with Sync:MinFormat above it refuse writes (426). */
const SYNC_FORMAT = 2

function codeForStatus(status, login) {
  if (status === 426) return 'client-outdated'
  if (status === 401 || status === 400) return 'invalid'
  if (status === 423) return 'locked'
  if (status === 403) return login ? 'disabled' : 'forbidden'
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
    const h = { ...(headers || {}), 'X-Sync-Format': String(SYNC_FORMAT) }
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

  /** Throws for non-2xx. `login` marks the one call where a 403 means the account is disabled. */
  function check(r, { login = false } = {}) {
    if (!r.ok) throw new AccountError(codeForStatus(r.status, login), r.status, messageOf(r.data, r.status))
    return r.data
  }

  /** A 2xx body that is missing, non-JSON or the wrong shape is a server error, never a silent default. */
  function shaped(data, ok, what) {
    if (!ok(data)) throw new AccountError('server', 0, `Malformed ${what} response`)
    return data
  }
  const isObject = (d) => !!d && typeof d === 'object' && !Array.isArray(d)
  const isArray = (d) => Array.isArray(d)

  /** Persist first: if the store rejects, memory must not hold a token the store never saw. */
  async function setSession(next) {
    await sessionStore.save(next)
    session = next
    loaded = true
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
      // Re-read the store: another client sharing it may already have rotated the token.
      const mem = await current()
      const stored = (await sessionStore.load()) || null
      if (!stored || !stored.refreshToken) {
        if (mem) await setSession(null)
        throw new AccountError('session-expired', 401, 'Not signed in')
      }
      if (mem && stored.refreshToken !== mem.refreshToken) {
        session = stored
        return stored
      }
      const s = stored
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
      || params.iterations > MAX_ITERATIONS
    ) {
      throw new AccountError('server', 0, 'Malformed key parameters from server')
    }
    let saltLength
    try {
      saltLength = atob(params.salt).length
    } catch {
      saltLength = -1
    }
    if (saltLength !== SALT_BYTES) {
      throw new AccountError('server', 0, 'Malformed key parameters from server')
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
    let keys
    try {
      keys = await deriveKeys(password, params.salt, params.iterations)
    } catch {
      throw new AccountError('server', 0, 'Could not derive keys from the server parameters')
    }
    const { authKey, vaultKey } = keys
    const resp = check(await send('POST', '/api/account/login', { body: { username, authKey } }), { login: true })
    return { resp, vaultKey, authKey }
  }

  return {
    async status() {
      const data = shaped(
        check(await send('GET', '/api/account/status')),
        (d) => isObject(d) && typeof d.needsSetup === 'boolean',
        'status',
      )
      return { needsSetup: data.needsSetup }
    },

    setup({ setupToken, username, password }) {
      return createAccount('/api/account/setup', { setupToken }, { username, password })
    },

    async redeem({ inviteCode, username, password }) {
      try {
        return await createAccount('/api/account/redeem', { inviteCode }, { username, password })
      } catch (e) {
        // A 400 here is about the invite (invalid, expired or already used), never a wrong password.
        if (e instanceof AccountError && e.status === 400) throw new AccountError('invalid-invite', 400, e.message)
        throw e
      }
    },

    async login({ username, password }) {
      const { resp, vaultKey } = await authenticate(username, password)
      let ck
      try {
        ck = await unwrapContainerKey(resp.wrappedContainerKey, vaultKey)
      } catch {
        // The server accepted the credentials, so this is damaged key material, not a wrong password.
        throw new AccountError('keys-corrupt', 0, 'The stored account keys could not be opened')
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
     * Re-authenticates with the current password (proving it and fetching the wrapped keys) and
     * re-wraps the container key and private key under the new password with a fresh salt. The
     * server revokes every session of the user, this one included, and answers 200 with a freshly
     * issued session; that session replaces the stored one and is returned.
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
        throw new AccountError('keys-corrupt', 0, 'The stored account keys could not be opened')
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
      // Authorise with the token the verification login just issued; the stored session stays
      // as it was until the server confirms the change.
      const data = check(await send('POST', '/api/account/change-password', { body, token: resp.accessToken }))
      let next
      try {
        next = buildSession(data, exportContainerKey(ck))
      } catch (e) {
        // The change happened and every old session is revoked, so the stored one is useless.
        await setSession(null)
        throw e
      }
      await setSession(next)
      return { session: next, containerKey: ck }
    },

    listDevices: async () => shaped(await authed('GET', '/api/devices'), isArray, 'device list'),
    createDevice: async ({ name, platform }) => shaped(
      await authed('POST', '/api/devices', { body: { name, platform } }),
      isObject,
      'device',
    ),
    renameDevice: (id, name) => authed('PUT', `/api/devices/${encodeURIComponent(id)}`, { body: { name } }),
    deleteDevice: (id) => authed('DELETE', `/api/devices/${encodeURIComponent(id)}`),
    getDevicePrefs: async (id) => shaped(
      await authed('GET', `/api/devices/${encodeURIComponent(id)}/prefs`),
      (d) => isObject(d) && Number.isInteger(d.revision),
      'device prefs',
    ),
    putDevicePrefs: async (id, ciphertext, revision) => shaped(
      await authed('PUT', `/api/devices/${encodeURIComponent(id)}/prefs`, {
        body: { ciphertext },
        headers: { 'If-Match': String(revision) },
      }),
      (d) => isObject(d) && Number.isInteger(d.revision),
      'device prefs',
    ),

    async putItems(items) {
      const body = {
        items: items.map((i) => ({
          id: i.id,
          ifMatch: i.ifMatch,
          ciphertext: i.ciphertext,
          deleted: !!i.deleted,
        })),
      }
      const data = shaped(
        await authed('POST', '/api/items/batch', { body }),
        (d) => isObject(d) && Array.isArray(d.results),
        'item batch',
      )
      return data.results
    },

    /**
     * One page of the change feed: `{ items, cursor, hasMore }`. Pages are bounded by count and
     * bytes, so a short page can still have more behind it; `hasMore` is undefined when an
     * older server omits it.
     */
    getChanges(since = 0, limit) {
      const q = `since=${encodeURIComponent(since)}${limit ? `&limit=${encodeURIComponent(limit)}` : ''}`
      return authed('GET', `/api/items/changes?${q}`).then((d) => shaped(
        d,
        (x) => isObject(x) && Array.isArray(x.items) && (!('hasMore' in x) || typeof x.hasMore === 'boolean'),
        'item changes',
      ))
    },

    createInvite: async ({ ttlHours } = {}) => shaped(
      await authed('POST', '/api/admin/invites', { body: { ttlHours } }),
      isObject,
      'invite',
    ),
    listInvites: async () => shaped(await authed('GET', '/api/admin/invites'), isArray, 'invite list'),
    revokeInvite: (id) => authed('DELETE', `/api/admin/invites/${encodeURIComponent(id)}`),
    listUsers: async () => shaped(await authed('GET', '/api/admin/users'), isArray, 'user list'),
    setUserDisabled: (id, disabled) => authed(
      'POST',
      `/api/admin/users/${encodeURIComponent(id)}/${disabled ? 'disable' : 'enable'}`,
    ),
  }
}
