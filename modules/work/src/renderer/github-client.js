// modules/work/src/renderer/github-client.js — desktop binding for GitHub: profile-scoped
// config, an http adapter straight to api.github.com (it allows CORS), and the GitHub half
// of the routed workItemSource. Logic lives in @nexusmd/core.
import { makeGithubConfig, makeGithubWorkItemSource } from '@nexusmd/core'
import { getProfileKey } from '@nexusmd/shell-sdk'

const rawStorage = {
  get: (k) => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
}

export const { getGithubConfig, saveGithubConfig, isGithubConfigured, usesGithubWorkItems } = makeGithubConfig({
  storage: rawStorage,
  key: (name) => getProfileKey('github.' + name),
})

// A 401 fires nexusmd:github-401 (the shell's expired-token notice) and still returns the
// response, so the client turns it into a GithubError of kind 'auth' as usual.
//
// GitHub lets its replies be kept for 60s, so a read soon after the last (the refresh that follows a
// merge) came straight from the browser cache, still showing the merged PR as open. 'no-cache'
// checks each read with GitHub: unchanged ones still come back as a 304, which costs no rate limit.
export function createGithubHttpAdapter({ getConfig = getGithubConfig, fetchImpl = (...a) => window.fetch(...a) } = {}) {
  return {
    async fetch(path, options = {}) {
      const { pat } = getConfig()
      if (!pat) throw new Error('GitHub token not configured — open Settings first.')
      const r = await fetchImpl(`https://api.github.com/${path}`, {
        method: options.method || 'GET',
        headers: {
          Authorization: 'Bearer ' + pat,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(options.headers || {}),
        },
        ...(options.body !== undefined ? { body: options.body } : {}),
        cache: 'no-cache',
      })
      if (r.status === 401) window.dispatchEvent(new Event('nexusmd:github-401'))
      return r
    },
  }
}

export const desktopGithubSource = makeGithubWorkItemSource({
  http: createGithubHttpAdapter(),
  getLogin: () => getGithubConfig().login,
})
