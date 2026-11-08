// github/config.js — read/write the local GitHub connection config (per profile).
//
// Headless like ado/config.js: storage and the key-naming strategy are injected.
// Values are stored as raw strings; the PAT is never logged.

import { rendererLog, ignore } from '../../log.js'

const log = rendererLog('github', 'config')
export const MAX_GITHUB_REPOS = 50
// Every name saveGithubConfig can write (the same set account sync carries; a test keeps them in step).
export const GITHUB_FIELDS = ['pat', 'repos', 'issues', 'inWork', 'login', 'refreshSecs']

/**
 * @param {object} opts
 * @param {{ get(k:string): (string|null), set(k:string, v:string): void }} opts.storage
 * @param {(name: string) => string} opts.key
 * @param {{ get(k:string): (string|null), set(k:string, v:string): void }} [opts.secrets]
 *   Where the PAT is kept instead of `storage`, under the same key (see ado/config.js).
 */
export function makeGithubConfig({ storage, key, secrets = null }) {
  if (!storage || typeof key !== 'function') {
    throw new Error('makeGithubConfig requires { storage, key }')
  }
  const storeOf = (name) => (secrets && name === 'pat' ? secrets : storage)
  const get = (name) => storeOf(name).get(key(name))

  function getGithubConfig() {
    let repos = []
    try {
      const parsed = JSON.parse(get('repos') || '[]')
      if (Array.isArray(parsed)) repos = parsed
    } catch (err) { ignore(log, 'the saved repository list is not valid JSON, so none is used', err, 'warn') }
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
    const set = (name, v) => storeOf(name).set(key(name), v)
    if (values.pat         !== undefined) set('pat',         values.pat)
    if (values.repos       !== undefined) set('repos',       JSON.stringify(values.repos))
    if (values.login       !== undefined) set('login',       values.login)
    if (values.refreshSecs !== undefined) set('refreshSecs', String(values.refreshSecs))
    if (values.issues      !== undefined) set('issues',      values.issues ? '1' : '0')
    if (values.inWork      !== undefined) set('inWork',      values.inWork ? '1' : '0')
  }

  // Disconnects: takes every field out of storage (the PAT out of `secrets`). Removed, not saved
  // empty, so account sync sees a deletion. Needs `remove` on `storage` (and on `secrets`).
  function removeGithubConfig() {
    for (const name of GITHUB_FIELDS) storeOf(name).remove(key(name))
  }

  function isGithubConfigured() {
    const c = getGithubConfig()
    return !!(c.pat && c.repos.length > 0)
  }

  // Connected, and its issues are wanted as work items.
  const usesGithubWorkItems = () => isGithubConfigured() && getGithubConfig().issues

  return { getGithubConfig, saveGithubConfig, removeGithubConfig, isGithubConfigured, usesGithubWorkItems }
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
