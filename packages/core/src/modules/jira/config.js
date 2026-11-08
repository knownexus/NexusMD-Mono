// packages/core/src/modules/jira/config.js — read/write the local Jira Cloud connection.
// Mirrors ado/config.js: storage and key naming are injected per platform.

import { rendererLog, ignore } from '../../log.js'

const log = rendererLog('jira', 'config')
export function normaliseSite(input) {
  const raw = String(input || '').trim()
  if (!raw) return ''
  let host = raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase()
  if (!host.includes('.')) host = `${host}.atlassian.net`
  return `https://${host}`
}

// Every name saveJiraConfig can write (the same set account sync carries; a test keeps them in step).
export const JIRA_FIELDS = ['site', 'email', 'apiToken', 'projectKeys', 'jql', 'boardId', 'enabled', 'refreshSecs']

const normaliseKeys = (keys) => keys.map(k => String(k).trim().toUpperCase()).filter(Boolean)

// `secrets` (optional): where the API token is kept instead of `storage`, under the same key
// (see ado/config.js).
export function makeJiraConfig({ storage, key, secrets = null }) {
  if (!storage || typeof key !== 'function') {
    throw new Error('makeJiraConfig requires { storage, key }')
  }
  const storeOf = (name) => (secrets && name === 'apiToken' ? secrets : storage)
  const get = (name) => storeOf(name).get(key(name))

  function getJiraConfig() {
    let projectKeys = []
    try { projectKeys = JSON.parse(get('projectKeys') || '[]') } catch (err) { ignore(log, 'the saved project keys are not valid JSON, so none are used', err, 'warn') }
    return {
      site:        get('site')     || '',
      email:       get('email')    || '',
      apiToken:    get('apiToken') || '',
      projectKeys: Array.isArray(projectKeys) ? projectKeys : [],
      jql:         get('jql')      || '',
      boardId:     get('boardId')  || '',
      enabled:     get('enabled') !== '0',
      refreshSecs: parseInt(get('refreshSecs') || '60', 10),
    }
  }

  function saveJiraConfig(values = {}) {
    const set = (name, v) => storeOf(name).set(key(name), v)
    if (values.site        !== undefined) set('site',        normaliseSite(values.site))
    if (values.email       !== undefined) set('email',       String(values.email).trim())
    if (values.apiToken    !== undefined) set('apiToken',    values.apiToken)
    if (values.projectKeys !== undefined) set('projectKeys', JSON.stringify(normaliseKeys(values.projectKeys)))
    if (values.jql         !== undefined) set('jql',         values.jql)
    if (values.boardId     !== undefined) set('boardId',     String(values.boardId))
    if (values.enabled     !== undefined) set('enabled',     values.enabled ? '1' : '0')
    if (values.refreshSecs !== undefined) set('refreshSecs', String(values.refreshSecs))
  }

  // Disconnects: takes every field out of storage (the API token out of `secrets`). Removed, not
  // saved empty, so account sync sees a deletion. Needs `remove` on `storage` (and on `secrets`).
  function removeJiraConfig() {
    for (const name of JIRA_FIELDS) storeOf(name).remove(key(name))
  }

  function isJiraConfigured() {
    const c = getJiraConfig()
    return !!(c.site && c.email && c.apiToken && c.projectKeys.length > 0)
  }

  const isJiraActive = () => isJiraConfigured() && getJiraConfig().enabled

  return { getJiraConfig, saveJiraConfig, removeJiraConfig, isJiraConfigured, isJiraActive }
}
