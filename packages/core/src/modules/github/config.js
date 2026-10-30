// github/config.js — read/write the local GitHub connection config (per profile).
//
// Headless like ado/config.js: storage and the key-naming strategy are injected.
// Values are stored as raw strings; the PAT is never logged.

export const MAX_GITHUB_REPOS = 50

/**
 * @param {object} opts
 * @param {{ get(k:string): (string|null), set(k:string, v:string): void }} opts.storage
 * @param {(name: string) => string} opts.key
 */
export function makeGithubConfig({ storage, key }) {
  if (!storage || typeof key !== 'function') {
    throw new Error('makeGithubConfig requires { storage, key }')
  }
  const get = (name) => storage.get(key(name))

  function getGithubConfig() {
    let repos = []
    try {
      const parsed = JSON.parse(get('repos') || '[]')
      if (Array.isArray(parsed)) repos = parsed
    } catch { /* ignore */ }
    const refresh = parseInt(get('refreshSecs') || '60', 10)
    return {
      pat:         get('pat') || '',
      repos,
      issues:      get('issues') !== '0',
      // Issues and Actions runs also show in Work's screens; false keeps them to the Git tab.
      inWork:      get('inWork') !== '0',
      login:       get('login') || '',
      refreshSecs: Number.isFinite(refresh) ? refresh : 60,
    }
  }

  function saveGithubConfig(values = {}) {
    if (values.repos !== undefined && values.repos.length > MAX_GITHUB_REPOS) {
      throw new Error(`Select at most ${MAX_GITHUB_REPOS} repositories`)
    }
    const set = (name, v) => storage.set(key(name), v)
    if (values.pat         !== undefined) set('pat',         values.pat)
    if (values.repos       !== undefined) set('repos',       JSON.stringify(values.repos))
    if (values.login       !== undefined) set('login',       values.login)
    if (values.refreshSecs !== undefined) set('refreshSecs', String(values.refreshSecs))
    if (values.issues      !== undefined) set('issues',      values.issues ? '1' : '0')
    if (values.inWork      !== undefined) set('inWork',      values.inWork ? '1' : '0')
  }

  function isGithubConfigured() {
    const c = getGithubConfig()
    return !!(c.pat && c.repos.length > 0)
  }

  // Connected, and its issues are wanted as work items.
  const usesGithubWorkItems = () => isGithubConfigured() && getGithubConfig().issues

  return { getGithubConfig, saveGithubConfig, isGithubConfigured, usesGithubWorkItems }
}

/** Selected repos from a profile stub `{ owner, repos }` as unique `owner/name` strings. */
export function repoListFromStub(stub) {
  if (!stub || !Array.isArray(stub.repos)) return []
  const out = []
  for (const r of stub.repos) {
    if (typeof r !== 'string' || !r) continue
    const full = r.includes('/') ? r : (stub.owner ? `${stub.owner}/${r}` : r)
    if (!out.includes(full)) out.push(full)
  }
  return out
}
