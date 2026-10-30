export class GithubError extends Error {
  constructor(message, { status = 0, kind = 'other', ssoUrl } = {}) {
    super(message)
    this.name = 'GithubError'
    this.status = status
    this.kind = kind
    if (ssoUrl) this.ssoUrl = ssoUrl
  }
}

const hget = (headers, name) => {
  if (!headers) return null
  if (typeof headers.get === 'function') return headers.get(name) ?? null
  const k = Object.keys(headers).find(x => x.toLowerCase() === name)
  return k ? headers[k] : null
}

export function classifyGithubError(status, headers, bodyText) {
  const text = String(bodyText || '')
  let apiMsg = ''
  try { apiMsg = String(JSON.parse(text)?.message || '') } catch { /* non-JSON body */ }
  const detail = (apiMsg || '').slice(0, 160)

  if (status === 401) {
    return { kind: 'auth', message: 'GitHub rejected the token (401) — it may be invalid or expired; check the token in Settings' }
  }
  if (status === 403 || status === 429) {
    const sso = hget(headers, 'x-github-sso')
    if (sso && /required/i.test(sso)) {
      const m = /url=(\S+?)(?:[;,]|$)/.exec(sso)
      return {
        kind: 'sso',
        message: 'This organization requires SAML SSO — authorize the token for it on GitHub, then retry',
        ...(m ? { ssoUrl: m[1] } : {}),
      }
    }
    const remaining = hget(headers, 'x-ratelimit-remaining')
    if (status === 429 || remaining === '0' || remaining === 0 || hget(headers, 'retry-after') != null
      || /rate limit/i.test(apiMsg)) {
      return { kind: 'rate-limit', message: 'GitHub rate limit reached — wait a bit and try again' }
    }
    if (/not accessible by (personal access )?token|resource not accessible|insufficient|scope/i.test(text)) {
      return { kind: 'scope', message: 'The token lacks permission for this action — grant it the required repository access or scopes' }
    }
    return { kind: 'other', message: detail ? `GitHub denied the request (403): ${detail}` : 'GitHub denied the request (403)' }
  }
  if (status === 404) {
    return { kind: 'not-found', message: 'Not found on GitHub (404) — the item may not exist, or the token cannot see it' }
  }
  if (status === 410) {
    return { kind: 'gone', message: 'This GitHub resource is gone (410) — for example, issues are disabled for the repository' }
  }
  return { kind: 'other', message: detail ? `GitHub request failed (${status}): ${detail}` : `GitHub request failed (${status})` }
}

const API_ROOT = 'https://api.github.com/'

function nextLink(res) {
  const link = hget(res.headers, 'link')
  if (!link) return null
  for (const part of String(link).split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part)
    if (m) return m[1].startsWith(API_ROOT) ? m[1].slice(API_ROOT.length) : m[1]
  }
  return null
}

export function makeGithubClient(http) {
  if (!http?.fetch) throw new Error('makeGithubClient: http adapter is required')

  const baseHeaders = () => ({
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  })

  async function raw(path, opts = {}) {
    const res = await http.fetch(path, { ...opts, headers: { ...baseHeaders(), ...(opts.headers || {}) } })
    if (!res.ok) {
      let text = ''
      try { text = await res.text() } catch { /* unreadable body */ }
      const c = classifyGithubError(res.status, res.headers, text)
      throw new GithubError(c.message, { status: res.status, kind: c.kind, ssoUrl: c.ssoUrl })
    }
    return res
  }

  async function parse(res) {
    if (res.status === 204) return null
    const text = await res.text()
    return text ? JSON.parse(text) : null
  }

  const get = async (path) => parse(await raw(path, { method: 'GET' }))

  async function getPaged(path, { max = 1000 } = {}) {
    let next = /[?&]per_page=/.test(path) ? path : `${path}${path.includes('?') ? '&' : '?'}per_page=100`
    const out = []
    while (next && out.length < max) {
      const res = await raw(next, { method: 'GET' })
      const items = await parse(res)
      if (Array.isArray(items)) out.push(...items)
      next = nextLink(res)
    }
    return out.slice(0, max)
  }

  const withJson = (method) => async (path, body) => parse(await raw(path, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))

  const del = async (path) => parse(await raw(path, { method: 'DELETE' }))

  return { get, getPaged, post: withJson('POST'), patch: withJson('PATCH'), put: withJson('PUT'), del }
}
