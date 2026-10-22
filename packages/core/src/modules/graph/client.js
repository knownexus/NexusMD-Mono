// graph/client.js — shared, token-agnostic Microsoft Graph client. Both desktop
// (native PKCE binding) and web (MSAL) pass a getToken({force}) => Promise<string>
// callback; this module owns the request shape, 401-retry, and pagination —
// callers don't re-derive fetch/retry logic per platform or per feature.
const BASE = 'https://graph.microsoft.com/v1.0'

// Run a Graph request; on 401 refresh the token once (force) and retry.
export async function graphFetch(getToken, path, opts = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`
  const run = async (token) => fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
  })
  let token = await getToken()
  let res = await run(token)
  if (res.status === 401) {
    token = await getToken({ force: true })
    res = await run(token)
  }
  if (!res.ok) throw new Error(`Graph request failed (${res.status}): ${path}`)
  return res
}

export async function graphJSON(getToken, path, opts = {}) {
  const res = await graphFetch(getToken, path, opts)
  return res.json()
}

// Follows @odata.nextLink, concatenating each page's `value` array.
export async function graphList(getToken, path, opts = {}) {
  let out = []
  let next = path
  while (next) {
    const page = await graphJSON(getToken, next, opts)
    out = out.concat(page.value || [])
    next = page['@odata.nextLink'] || null
  }
  return out
}
