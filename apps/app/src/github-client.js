// github-client.js — GitHub binding for the Android app: profile-scoped config, an http adapter over
// native HTTP, and the GitHub half of the routed workItemSource. Logic lives in @nexusmd/core.
import { makeGithubConfig, makeGithubWorkItemSource } from '@nexusmd/core';
import { getProfileKey } from './profile-keys.js';
import { nativeHttp } from './native-http.js';

const rawStorage = {
  get: (k) => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
};

export const { getGithubConfig, saveGithubConfig, isGithubConfigured, usesGithubWorkItems } = makeGithubConfig({
  storage: rawStorage,
  key: (name) => getProfileKey('helm.android.github.' + name),
});

const parseJson = (s) => { try { return JSON.parse(s); } catch { return s; } };

// Same contract as the Jira adapter: { ok, status, headers.get, text(), json() }. A 401 fires
// nexusmd:github-401 (the expired-token notice) and is still returned, so the client turns it
// into a GithubError of kind 'auth' as usual.
export function createGithubHttpAdapter({
  getConfig = getGithubConfig,
  request = (req) => nativeHttp(req),
} = {}) {
  return {
    async fetch(path, options = {}) {
      const { pat } = getConfig();
      if (!pat) throw new Error('GitHub token not configured — open Settings first.');
      const resp = await request({
        method: options.method || 'GET',
        url: `https://api.github.com/${path}`,
        headers: {
          Authorization: 'Bearer ' + pat,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(options.headers || {}),
        },
        ...(options.body !== undefined ? { data: parseJson(options.body) } : {}),
      });
      if (resp.status === 401) window.dispatchEvent(new Event('nexusmd:github-401'));
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

export const androidGithubSource = makeGithubWorkItemSource({
  http: createGithubHttpAdapter(),
  getLogin: () => getGithubConfig().login,
});
