export class JiraError extends Error {
  constructor(message, { status = 0, path = '' } = {}) {
    super(message)
    this.name = 'JiraError'
    this.status = status
    this.path = path
  }
}

export function jiraErrorMessage(status, body) {
  const msgs = [
    ...(body?.errorMessages || []),
    ...Object.entries(body?.errors || {}).map(([k, v]) => `${k}: ${v}`),
  ]
  if (msgs.length) return msgs.join('; ').slice(0, 200)
  if (status === 401) return 'Jira rejected the credentials (401) — check the email and API token in Settings'
  if (status === 403) return 'Jira denied access (403) — check the account has permission for these projects'
  if (status === 404) return 'Not found in Jira (404)'
  if (status === 429) return 'Jira rate limit hit (429) — try again shortly'
  return `Jira request failed (${status})`
}

const defaultSleep = (ms) => new Promise(r => setTimeout(r, ms))

export function makeJiraClient(http, { sleep = defaultSleep } = {}) {
  if (!http?.fetch) throw new Error('makeJiraClient: http adapter is required')

  async function send(path, opts = {}) {
    let res = await http.fetch(path, opts)
    if (res.status === 429) {
      const ra = parseInt(res.headers?.get?.('retry-after') || '1', 10)
      await sleep(Math.min(Number.isFinite(ra) ? ra : 1, 10) * 1000)
      res = await http.fetch(path, opts)
    }
    if (!res.ok) {
      let body = null
      try { body = await res.json() } catch { /* non-JSON error body */ }
      throw new JiraError(jiraErrorMessage(res.status, body), { status: res.status, path })
    }
    if (res.status === 204) return null
    const text = await res.text()
    return text ? JSON.parse(text) : null
  }

  const withJson = (method) => (path, body) => send(path, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })

  return {
    send,
    get: (path) => send(path, { method: 'GET' }),
    post: withJson('POST'),
    put: withJson('PUT'),
  }
}
