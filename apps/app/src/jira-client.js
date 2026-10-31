// jira-client.js — Jira Cloud binding for the Android app: profile-scoped config, an http
// adapter over CapacitorHttp (native HTTP, so no CORS), and the Jira half of the routed
// workItemSource. Logic lives in @nexusmd/core.
import {
  makeJiraConfig, makeJiraClient, loadCachedJiraData, jiraKeyFromId,
  loadJiraDetail, loadJiraComments, addJiraComment, loadJiraRawFields,
  jiraPatchFromAdoField, transitionJiraIssue, updateJiraIssue, listJiraTransitions,
  fetchJiraCreateTypes, fetchJiraCreateFields, fetchJiraLinkTypes, createJiraIssue,
  transitionJiraIssueToAny, fetchJiraBoards,
} from '@nexusmd/core';
import { localStorageAdapter } from '@nexusmd/web-adapters';
import { getProfileKey } from './profile-keys.js';
import { nativeHttp } from './native-http.js';

const rawStorage = {
  get: (k) => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
};

export const { getJiraConfig, saveJiraConfig, isJiraConfigured, isJiraActive } = makeJiraConfig({
  storage: rawStorage,
  key: (name) => getProfileKey('helm.android.jira.' + name),
});

const parseJson = (s) => { try { return JSON.parse(s); } catch { return s; } };

// Same contract as the desktop adapter: { ok, status, headers.get, text(), json() }.
export function createJiraHttpAdapter({
  getConfig = getJiraConfig,
  request = (req) => nativeHttp(req),
} = {}) {
  return {
    async fetch(path, options = {}) {
      const { site, email, apiToken } = getConfig();
      if (!site) throw new Error('Jira site not configured — open Settings first.');
      if (options.attachment) throw new Error('Attachments are not supported on Android yet.');
      const headers = {
        Authorization: 'Basic ' + btoa(`${email}:${apiToken}`),
        Accept: 'application/json',
        // Cookie-less REST calls must opt out of Jira's XSRF check.
        'X-Atlassian-Token': 'no-check',
        ...(options.headers || {}),
      };
      const resp = await request({
        method: options.method || 'GET',
        url: `${site}/${path}`,
        headers,
        ...(options.body !== undefined ? { data: parseJson(options.body) } : {}),
      });
      const data = typeof resp.data === 'string' ? parseJson(resp.data) : resp.data;
      const lower = Object.fromEntries(Object.entries(resp.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
      return {
        ok: resp.status >= 200 && resp.status < 300,
        status: resp.status,
        headers: { get: (n) => lower[String(n).toLowerCase()] ?? null },
        text: async () => (typeof data === 'string' ? data : data == null ? '' : JSON.stringify(data)),
        json: async () => data ?? null,
      };
    },
  };
}

const cachedJira = () => loadCachedJiraData(getJiraConfig(), { storage: localStorageAdapter });

export function createJiraWorkItemSource({
  http = createJiraHttpAdapter(),
  getMeta = () => cachedJira()?._jiraMeta || {},
  getPeople = () => cachedJira()?.PEOPLE || [],
  getSite = () => getJiraConfig().site,
  getPointsFieldId = () => cachedJira()?.BOARD_ESTIMATION_FIELD || null,
} = {}) {
  const client = makeJiraClient(http);
  const keyOf = (id) => jiraKeyFromId(id);
  return {
    loadDetail: (id) => loadJiraDetail(client, keyOf(id), getMeta()),
    loadComments: (id) => loadJiraComments(client, keyOf(id)),
    addComment: (id, _project, html) => addJiraComment(client, keyOf(id), html),
    loadRawFields: (id) => loadJiraRawFields(client, keyOf(id)),
    async saveField(id, field, value) {
      const meta = getMeta();
      const t = jiraPatchFromAdoField(field, value, { people: getPeople(), priorities: meta.priorities || [] });
      if (t.transition) { await transitionJiraIssue(client, keyOf(id), t.transition); return; }
      await updateJiraIssue(client, keyOf(id), t.patch, { ...meta, pointsFieldId: getPointsFieldId() });
    },
    moveToCategory: (id, category, item) => transitionJiraIssue(client, keyOf(id), { category }, { currentState: item?.state }),
    moveToStatuses: (id, statuses, item) => transitionJiraIssueToAny(client, keyOf(id), statuses, { currentState: item?.state }),
    getBoards: (projectKeys) => fetchJiraBoards(client, projectKeys),
    async availableTargetStates(id) {
      return (await listJiraTransitions(client, keyOf(id))).map(t => t.toName);
    },
    webUrl: (item) => `${getSite()}/browse/${encodeURIComponent(keyOf(item.id))}`,
    getCreateTypes: (projectKey) => fetchJiraCreateTypes(client, projectKey),
    getCreateFields: (projectKey, typeId) => fetchJiraCreateFields(client, projectKey, typeId, getMeta().fieldIds || {}, { pointsFieldId: getPointsFieldId() }),
    getLinkTypes: () => fetchJiraLinkTypes(client),
    createIssue: (input, extras) => createJiraIssue(client, input, extras),
  };
}
