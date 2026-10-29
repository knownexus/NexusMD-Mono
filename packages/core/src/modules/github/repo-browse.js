// packages/core/src/modules/github/repo-browse.js — headless branch, commit and file browsing
// of a GitHub repository for the Git Workspace GitHub tab. Every function takes a client from
// makeGithubClient; failures throw the client's GithubError.

import { CHANGE_TYPES } from './pr-collab.js'

const MAX_TEXT_BYTES = 1048576
const COMMIT_PAGE = 50

const encPath = (p) => String(p || '').split('/').map(encodeURIComponent).join('/')
const repoPath = (repo) => `repos/${repo}`
const firstLine = (s) => String(s || '').split('\n')[0]
const authorOf = (c) => c.author?.login || c.commit?.author?.name || ''

export function githubRepoFromRemote(url) {
  const s = String(url || '').trim()
  const m = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|git@)github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(s)
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null
}

export async function githubRepoInfo(client, repo) {
  const info = await client.get(repoPath(repo))
  return { defaultBranch: info?.default_branch || '', htmlUrl: info?.html_url || '' }
}

export async function listGithubBranches(client, repo) {
  const [info, branches] = await Promise.all([client.get(repoPath(repo)), client.getPaged(`${repoPath(repo)}/branches`)])
  const def = info?.default_branch
  return branches
    .map(b => ({ name: b.name, sha: b.commit?.sha || '', protected: !!b.protected, isDefault: b.name === def }))
    .sort((a, b) => (b.isDefault - a.isDefault) || a.name.localeCompare(b.name))
}

export async function createGithubBranch(client, repo, { name, from }) {
  const ref = await client.get(`${repoPath(repo)}/git/ref/heads/${encPath(from)}`)
  const sha = ref?.object?.sha
  await client.post(`${repoPath(repo)}/git/refs`, { ref: `refs/heads/${name}`, sha })
  return { name, sha }
}

export async function deleteGithubBranch(client, repo, name) {
  await client.del(`${repoPath(repo)}/git/refs/heads/${encPath(name)}`)
}

export async function listGithubCommits(client, repo, branch) {
  const commits = await client.get(`${repoPath(repo)}/commits?sha=${encodeURIComponent(branch)}&per_page=${COMMIT_PAGE}`)
  return (commits || []).map(c => ({
    sha: c.sha, message: firstLine(c.commit?.message), author: authorOf(c), date: c.commit?.author?.date || '',
  }))
}

export async function getGithubCommit(client, repo, sha) {
  const c = await client.get(`${repoPath(repo)}/commits/${encodeURIComponent(sha)}`)
  return {
    sha: c.sha,
    message: String(c.commit?.message || ''),
    author: authorOf(c),
    date: c.commit?.author?.date || '',
    files: (c.files || []).map(f => ({
      path: f.filename,
      changeType: CHANGE_TYPES[f.status] || 'edit',
      additions: f.additions || 0,
      deletions: f.deletions || 0,
      patch: f.patch || '',
    })),
  }
}

export async function listGithubContents(client, repo, { path = '', ref } = {}) {
  const items = await client.get(`${repoPath(repo)}/contents${path ? '/' + encPath(path) : ''}?ref=${encodeURIComponent(ref)}`)
  return (Array.isArray(items) ? items : [])
    .map(i => ({ name: i.name, path: i.path, type: i.type === 'dir' ? 'dir' : 'file', size: i.size || 0 }))
    .sort((a, b) => ((a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1)) || a.name.localeCompare(b.name))
}

export async function getGithubFile(client, repo, { path, ref }) {
  const f = await client.get(`${repoPath(repo)}/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`)
  const url = f?.html_url || ''
  if ((f?.size || 0) > MAX_TEXT_BYTES) return { text: null, reason: 'too-large', url }
  const bytes = Buffer.from(String(f?.content || '').replace(/\s/g, ''), 'base64')
  if (bytes.includes(0)) return { text: null, reason: 'binary', url }
  return { text: bytes.toString('utf8'), reason: null, url }
}
