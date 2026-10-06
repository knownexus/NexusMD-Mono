// apps/desktop/src/jira-client.js — desktop binding for Jira Cloud: profile-scoped
// config, an http adapter over the main-process proxy (Jira has no CORS), and the
// Jira half of the routed workItemSource. Logic lives in @nexusmd/core.
import {
  makeJiraConfig, makeJiraClient, loadCachedJiraData, jiraKeyFromId,
  loadJiraDetail, loadJiraComments, addJiraComment, loadJiraRawFields,
  jiraPatchFromAdoField, transitionJiraIssue, updateJiraIssue, listJiraTransitions,
  fetchJiraCreateTypes, fetchJiraCreateFields, fetchJiraLinkTypes, createJiraIssue,
  transitionJiraIssueToAny, fetchJiraBoards,
} from '@nexusmd/core'
import { localStorageAdapter } from '@nexusmd/web-adapters'
import { getProfileKey } from './profile-keys.js'

const rawStorage = {
  get: (k) => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
}

export const { getJiraConfig, saveJiraConfig, isJiraConfigured, isJiraActive } = makeJiraConfig({
  storage: rawStorage,
  key: (name) => getProfileKey('jira.' + name),
})

export function createJiraHttpAdapter({
  getConfig = getJiraConfig,
  invoke = (req) => window.electronAPI.jira.request(req),
} = {}) {
  return {
    async fetch(path, options = {}) {
      const { site, email, apiToken } = getConfig()
      if (!site) throw new Error('Jira site not configured — open Settings first.')
      const headers = {
        Authorization: 'Basic ' + btoa(`${email}:${apiToken}`),
        Accept: 'application/json',
        ...(options.headers || {}),
      }
      const r = await invoke({
        url: `${site}/${path}`,
        method: options.method || 'GET',
        headers,
        body: options.body,
        attachment: options.attachment,
      })
      if (!r.status && r.error) throw new Error(r.error)
      return {
        ok: r.ok,
        status: r.status,
        headers: { get: (n) => r.headers?.[String(n).toLowerCase()] ?? null },
        text: async () => r.body || '',
        json: async () => JSON.parse(r.body || 'null'),
      }
    },
  }
}

const cachedJira = () => loadCachedJiraData(getJiraConfig(), { storage: localStorageAdapter })

export function createJiraWorkItemSource({
  http = createJiraHttpAdapter(),
  getMeta = () => cachedJira()?._jiraMeta || {},
  getPeople = () => cachedJira()?.PEOPLE || [],
  getSite = () => getJiraConfig().site,
} = {}) {
  const client = makeJiraClient(http)
  const keyOf = (id) => jiraKeyFromId(id)
  return {
    loadDetail: (id) => loadJiraDetail(client, keyOf(id), getMeta()),
    loadComments: (id) => loadJiraComments(client, keyOf(id)),
    addComment: (id, _project, html) => addJiraComment(client, keyOf(id), html),
    loadRawFields: (id) => loadJiraRawFields(client, keyOf(id)),
    async saveField(id, field, value) {
      const meta = getMeta()
      const t = jiraPatchFromAdoField(field, value, { people: getPeople(), priorities: meta.priorities || [] })
      if (t.transition) { await transitionJiraIssue(client, keyOf(id), t.transition); return }
      await updateJiraIssue(client, keyOf(id), t.patch, meta)
    },
    moveToCategory: (id, category, item) => transitionJiraIssue(client, keyOf(id), { category }, { currentState: item?.state }),
    moveToStatuses: (id, statuses, item) => transitionJiraIssueToAny(client, keyOf(id), statuses, { currentState: item?.state }),
    getBoards: (projectKeys) => fetchJiraBoards(client, projectKeys),
    async availableTargetStates(id) {
      return (await listJiraTransitions(client, keyOf(id))).map(t => t.toName)
    },
    webUrl: (item) => `${getSite()}/browse/${encodeURIComponent(keyOf(item.id))}`,
    getCreateTypes: (projectKey) => fetchJiraCreateTypes(client, projectKey),
    getCreateFields: (projectKey, typeId) => fetchJiraCreateFields(client, projectKey, typeId, getMeta().fieldIds || {}),
    getLinkTypes: () => fetchJiraLinkTypes(client),
    createIssue: (input, extras) => createJiraIssue(client, input, extras),
  }
}
