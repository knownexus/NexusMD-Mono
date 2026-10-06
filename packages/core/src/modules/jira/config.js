// packages/core/src/modules/jira/config.js — read/write the local Jira Cloud connection.
// Mirrors ado/config.js: storage and key naming are injected per platform.

export function normaliseSite(input) {
  const raw = String(input || '').trim()
  if (!raw) return ''
  let host = raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase()
  if (!host.includes('.')) host = `${host}.atlassian.net`
  return `https://${host}`
}

const normaliseKeys = (keys) => keys.map(k => String(k).trim().toUpperCase()).filter(Boolean)

export function makeJiraConfig({ storage, key }) {
  if (!storage || typeof key !== 'function') {
    throw new Error('makeJiraConfig requires { storage, key }')
  }
  const get = (name) => storage.get(key(name))

  function getJiraConfig() {
    let projectKeys = []
    try { projectKeys = JSON.parse(get('projectKeys') || '[]') } catch { /* ignore */ }
    return {
      site:        get('site')     || '',
      email:       get('email')    || '',
      apiToken:    get('apiToken') || '',
      projectKeys: Array.isArray(projectKeys) ? projectKeys : [],
      jql:         get('jql')      || '',
      enabled:     get('enabled') !== '0',
      refreshSecs: parseInt(get('refreshSecs') || '60', 10),
    }
  }

  function saveJiraConfig(values = {}) {
    const set = (name, v) => storage.set(key(name), v)
    if (values.site        !== undefined) set('site',        normaliseSite(values.site))
    if (values.email       !== undefined) set('email',       String(values.email).trim())
    if (values.apiToken    !== undefined) set('apiToken',    values.apiToken)
    if (values.projectKeys !== undefined) set('projectKeys', JSON.stringify(normaliseKeys(values.projectKeys)))
    if (values.jql         !== undefined) set('jql',         values.jql)
    if (values.enabled     !== undefined) set('enabled',     values.enabled ? '1' : '0')
    if (values.refreshSecs !== undefined) set('refreshSecs', String(values.refreshSecs))
  }

  function isJiraConfigured() {
    const c = getJiraConfig()
    return !!(c.site && c.email && c.apiToken && c.projectKeys.length > 0)
  }

  const isJiraActive = () => isJiraConfigured() && getJiraConfig().enabled

  return { getJiraConfig, saveJiraConfig, isJiraConfigured, isJiraActive }
}
