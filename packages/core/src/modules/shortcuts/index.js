// Dashboard shortcuts to one file, folder or document. Pure: no React, no storage. A shortcut is the `config`
// of a `link` Home widget (see widgets/index.js) and is one of three targets:
//   { target: 'git', kind: 'file'|'folder', path, branch?, repo: { provider, name, fullName?, project?, remote? } }
//   { target: 'doc', tool: 'markdown'|'json', docId, name }
//   { target: 'editor', kind: 'file'|'folder', path, name, platform }
// The widget list syncs between devices, so a git target names the repo by identity (remote, owner/name) rather
// than by anything local, and each device resolves it to what it has (resolveRepo / resolveLink).

import { ignore, rendererLog } from '../../log.js'

const log = rendererLog('core', 'shortcuts')

export const LINK_TARGETS = ['git', 'doc', 'editor']
export const DOC_TOOLS = ['markdown', 'json']
export const LINK_UNAVAILABLE = {
  repo: 'This repository is not available on this device.',
  doc: 'This document no longer exists.',
  platform: 'This was made on another kind of device and opens only there.',
  invalid: 'This shortcut is incomplete.',
}

const str = (v) => (typeof v === 'string' ? v.trim() : '')
const lower = (v) => str(v).toLowerCase()

// A repo-relative path, always with one leading slash and no empty, "." or ".." parts.
export function normalizeRepoPath(p) {
  const parts = String(p ?? '').replace(/\\/g, '/').split('/').filter(s => s && s !== '.' && s !== '..')
  return '/' + parts.join('/')
}

const baseName = (p) => String(p ?? '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || ''
const parentOf = (p) => {
  const parts = String(p ?? '').replace(/\\/g, '/').split('/').filter(Boolean)
  parts.pop()
  return parts.length ? parts.join('/') : ''
}

// "host/owner/name", lower case, for any way of writing a git remote (https, scp-style, ssh; Azure DevOps in
// its https, ssh and visualstudio.com forms). '' when it is not a remote.
export function normalizeRemote(url) {
  let s = str(url)
  if (!s) return ''
  const scp = /^[\w.-]+@([^:/\s]+):(?!\/)(.+)$/.exec(s)
  if (scp) s = `${scp[1]}/${scp[2]}`
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  // Credentials in the authority (`user:token@`) never survive; the host starts after the last "@" before the first "/".
  const slash = s.indexOf('/')
  const at = (slash < 0 ? s : s.slice(0, slash)).lastIndexOf('@')
  if (at >= 0) s = s.slice(at + 1)
  try { s = decodeURIComponent(s) } catch (e) { ignore(log, 'a remote with a bad percent escape is kept as written', e) }
  s = s.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase()
  let m = /^ssh\.dev\.azure\.com\/v3\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(s)
  if (m) return `dev.azure.com/${m[1]}/${m[2]}/${m[3]}`
  m = /^dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)$/.exec(s)
  if (m) return `dev.azure.com/${m[1]}/${m[2]}/${m[3]}`
  m = /^([^./]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/]+)$/.exec(s)
  if (m) return `dev.azure.com/${m[1]}/${m[2]}/${m[3]}`
  return /^[^/\s]+\/.+/.test(s) ? s : ''
}

// The normalized remote of a repository from its `git remote -v` listing ("<name>\t<url> (fetch)" lines):
// origin's, else the first one that is a remote. '' when there is none.
// Only the normalized form is returned, so credentials in a URL go no further.
export function remoteFromRemotes(text) {
  const found = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const [name, raw, kind] = line.trim().split(/\s+/)
    if (kind === '(push)') continue
    const url = normalizeRemote(raw)
    if (name && url) found.push({ name, url })
  }
  return (found.find(r => r.name === 'origin') || found[0] || {}).url || ''
}

// Every identity a repo can be known by: its remote, GitHub owner/name, Azure DevOps project/name.
export function repoKeys(repo) {
  if (!repo || typeof repo !== 'object') return []
  const keys = []
  const remote = normalizeRemote(repo.remote)
  if (remote) keys.push(remote)
  // An Azure DevOps remote also names the project and repo the phone lists it by.
  const azure = /^dev\.azure\.com\/[^/]+\/([^/]+)\/([^/]+)$/.exec(remote)
  if (azure) keys.push(`ado:${azure[1]}/${azure[2]}`)
  const provider = lower(repo.provider)
  if (provider === 'github') {
    const full = lower(repo.fullName) || (repo.project && repo.name ? `${lower(repo.project)}/${lower(repo.name)}` : '')
    if (full) keys.push(`github.com/${full}`)
  } else if (provider === 'ado' && repo.project && repo.name) {
    keys.push(`ado:${lower(repo.project)}/${lower(repo.name)}`)
  }
  return keys
}

// The GitHub "owner/name" a repo is, from its provider identity or its remote; '' when it is not on GitHub.
export function githubRepoOf(repo) {
  if (!repo || typeof repo !== 'object') return ''
  const own = str(repo.fullName)
  if (lower(repo.provider) === 'github' && /^[^/\s]+\/[^/\s]+$/.test(own)) return own
  const key = repoKeys(repo).find(k => /^github\.com\/[^/]+\/[^/]+$/.test(k))
  return key ? key.slice('github.com/'.length) : ''
}

// The repo among `available` that a shortcut's repo means: same remote or provider identity, else the only
// one with the same name. null when there is none (or the name is ambiguous).
export function resolveRepo(shortcutRepo, available) {
  const list = Array.isArray(available) ? available.filter(r => r && typeof r === 'object') : []
  if (!shortcutRepo || !list.length) return null
  const want = repoKeys(shortcutRepo)
  if (want.length) {
    const hit = list.find(r => repoKeys(r).some(k => want.includes(k)))
    if (hit) return hit
  }
  const name = lower(shortcutRepo.name)
  if (!name) return null
  const same = list.filter(r => lower(r.name) === name)
  return same.length === 1 ? same[0] : null
}

// The target of a config as the app may rely on it, or null when it is not a usable shortcut. Configs arrive
// by sync, so nothing in them is trusted.
export function readTarget(config) {
  const c = config && typeof config === 'object' ? config : null
  if (!c) return null
  if (c.target === 'git') {
    const r = c.repo && typeof c.repo === 'object' ? c.repo : null
    const name = str(r?.name)
    if (!name) return null
    const repo = { provider: ['github', 'ado', 'local'].includes(r.provider) ? r.provider : 'local', name }
    for (const k of ['fullName', 'project']) if (str(r[k])) repo[k] = str(r[k])
    // Only the normalized identity is kept: a raw remote URL can carry credentials, and this config syncs.
    const remote = normalizeRemote(r.remote)
    if (remote) repo.remote = remote
    const out = { target: 'git', kind: c.kind === 'file' ? 'file' : 'folder', path: normalizeRepoPath(c.path), repo }
    if (str(c.branch)) out.branch = str(c.branch)
    if (str(c.label)) out.label = str(c.label)
    return out
  }
  if (c.target === 'doc') {
    if (!DOC_TOOLS.includes(c.tool) || !str(c.docId)) return null
    return { target: 'doc', tool: c.tool, docId: str(c.docId), name: str(c.name), ...(str(c.label) ? { label: str(c.label) } : {}) }
  }
  if (c.target === 'editor') {
    if (!str(c.path)) return null
    return {
      target: 'editor', kind: c.kind === 'file' ? 'file' : 'folder', path: str(c.path), name: str(c.name) || baseName(c.path),
      platform: str(c.platform), ...(str(c.label) ? { label: str(c.label) } : {}),
    }
  }
  return null
}

// Where a git target puts the file browser: the folder to show and the file to open in it (null for a folder
// shortcut). A file opens inside its own folder, so going back from it lands there.
export function targetPlace(config) {
  const t = readTarget(config)
  if (!t || t.target !== 'git') return null
  if (t.kind === 'folder') return { path: t.path, file: null }
  const dir = parentOf(t.path)
  return { path: dir ? `/${dir}` : '/', file: t.path }
}

// The documents in a store's saved value, as { id }: the Markdown store keeps { docs: [...] }, the JSON one a bare
// list. Anything that is not a document with an id is left out, and a value that is not JSON has none.
export function savedDocIds(raw) {
  let value = raw
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw) } catch (e) {
      ignore(log, 'a documents store that is not JSON has no documents to match a shortcut against', e)
      return []
    }
  }
  const list = Array.isArray(value) ? value : Array.isArray(value?.docs) ? value.docs : []
  return list.filter(d => d && typeof d.id === 'string' && d.id).map(d => ({ id: d.id }))
}

// The catalogue page a target lives on (core WIDGET_PAGES), so a host can tell whether that app is switched off.
export function linkPage(config) {
  const t = readTarget(config)
  return t ? { git: 'git', doc: 'markdown', editor: 'editor' }[t.target] : null
}

export function shortcutTitle(config) {
  const t = readTarget(config)
  if (!t) return 'Shortcut'
  if (t.label) return t.label
  if (t.target === 'doc') return t.name || (t.tool === 'json' ? 'JSON document' : 'Document')
  if (t.target === 'editor') return t.name || baseName(t.path) || 'Editor'
  return (t.path === '/' ? '' : baseName(t.path)) || t.repo.name
}

export function shortcutSub(config) {
  const t = readTarget(config)
  if (!t) return ''
  if (t.target === 'doc') return t.tool === 'json' ? 'JSON' : 'Markdown'
  if (t.target === 'editor') return parentOf(t.path) || t.path
  const dir = t.kind === 'file' ? parentOf(t.path) : t.path === '/' ? '' : parentOf(t.path)
  return [t.repo.name, dir].filter(Boolean).join(' / ')
}

export function shortcutIcon(config) {
  const t = readTarget(config)
  if (!t) return 'link'
  if (t.target === 'doc') return 'doc'
  return t.kind === 'folder' ? 'folder' : 'doc'
}

// A short stable hash, so the same target always gets the same widget id.
function hash(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36)
}

export function linkId(config) {
  const t = readTarget(config)
  if (!t) return null
  const key = t.target === 'git' ? [t.target, repoKeys(t.repo)[0] || lower(t.repo.name), t.branch || '', t.path]
    : t.target === 'doc' ? [t.target, t.tool, t.docId]
      : [t.target, t.platform, t.path]
  return `lk-${hash(key.join('\n'))}`
}

// The Home widget for a target, or null when it is not usable. Pinning the same target again gives the same
// id, so newWidgetsAfterSave replaces the widget rather than adding a second.
export function makeLinkWidget(config) {
  const t = readTarget(config)
  return t ? { id: linkId(t), type: 'link', config: t } : null
}

// Whether this device can open a shortcut, and what it opens:
//   { ok: true, repo? }   or   { ok: false, reason }
// `available`: { repos: [...] the repos this device has, docs: { markdown: [{id}], json: [{id}] }, platform }.
export function resolveLink(config, { repos = [], docs = {}, platform = '' } = {}) {
  const t = readTarget(config)
  if (!t) return { ok: false, reason: LINK_UNAVAILABLE.invalid }
  if (t.target === 'git') {
    const repo = resolveRepo(t.repo, repos)
    return repo ? { ok: true, repo } : { ok: false, reason: LINK_UNAVAILABLE.repo }
  }
  if (t.target === 'doc') {
    const list = Array.isArray(docs[t.tool]) ? docs[t.tool] : []
    return list.some(d => d && d.id === t.docId) ? { ok: true } : { ok: false, reason: LINK_UNAVAILABLE.doc }
  }
  return !t.platform || t.platform === platform ? { ok: true } : { ok: false, reason: LINK_UNAVAILABLE.platform }
}
