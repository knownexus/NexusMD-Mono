import React from 'react'
import { Icon, CardFrame, SettField } from '@nexusmd/ui'
import { makeGithubClient, discoverGithubRepos, MAX_GITHUB_REPOS } from '@nexusmd/core'
import { getProfileKey } from '@nexusmd/shell-sdk'
import { getGithubConfig, saveGithubConfig, createGithubHttpAdapter } from './github-client.js'
import { settInputStyle } from './form-style.js'

const defaultClient = (pat) => makeGithubClient(createGithubHttpAdapter({ getConfig: () => ({ pat }) }))

// The older Settings > Integrations > GitHub card kept a token and "owner/repo, ..." text
// under these keys. They seed this card until it is saved once.
function readLegacy() {
  try {
    return {
      pat: localStorage.getItem(getProfileKey('nexusmd.github.pat')) || '',
      repos: localStorage.getItem(getProfileKey('nexusmd.github.repos')) || '',
    }
  } catch { return { pat: '', repos: '' } }
}
const legacyRepoList = (text) => [...new Set(String(text || '').split(/[,\n]+/).map(s => s.trim()).filter(s => /^[^/\s]+\/[^/\s]+$/.test(s)))]

export function GithubConnectionCard({ onRefreshData, makeClient = defaultClient, discover = discoverGithubRepos, legacy = readLegacy() }) {
  const [saved] = React.useState(() => getGithubConfig())
  const [pat, setPat]           = React.useState('')
  const [issues, setIssues]     = React.useState(saved.issues !== false)
  const [selected, setSelected] = React.useState(() => (saved.repos.length ? saved.repos : legacyRepoList(legacy?.repos)))
  const [found, setFound]       = React.useState(null) // { repos, ssoOrgs } after Discover
  const [search, setSearch]     = React.useState('')
  const [status, setStatus]     = React.useState('')
  const [busy, setBusy]         = React.useState('')

  const token = () => pat.trim() || saved.pat || legacy?.pat || ''
  const overCap = selected.length > MAX_GITHUB_REPOS

  const discoverRepos = async () => {
    if (!token()) { setStatus('Error: Enter a token first.'); return }
    setBusy('discover'); setStatus('Discovering…')
    try {
      const result = await discover(makeClient(token()))
      setFound(result)
      setStatus(`Found ${result.repos.length} repositor${result.repos.length === 1 ? 'y' : 'ies'}.`)
    } catch (e) {
      setStatus('Error: ' + (e.message || 'Discovery failed'))
    } finally { setBusy('') }
  }

  const save = async () => {
    if (overCap) return
    if (!token()) { setStatus('Error: Enter a token first.'); return }
    setBusy('save'); setStatus('Saving…')
    try {
      const me = await makeClient(token()).get('user')
      const newPat = pat.trim() || (!saved.pat && legacy?.pat) || ''
      saveGithubConfig({ ...(newPat ? { pat: newPat } : {}), repos: selected, issues, login: me?.login || '' })
      setPat('')
      setStatus('Saved! Loading data…')
      onRefreshData?.().catch(() => {})
      setTimeout(() => setStatus(''), 3000)
    } catch (e) {
      setStatus('Error: ' + (e.message || 'Save failed'))
    } finally { setBusy('') }
  }

  const toggle = (fullName) => setSelected(s => (s.includes(fullName) ? s.filter(r => r !== fullName) : [...s, fullName]))

  // Before Discover, the list shows what is selected so it can still be unticked.
  const rows = found ? found.repos : selected.map(fullName => ({ fullName, owner: fullName.split('/')[0] }))
  const q = search.trim().toLowerCase()
  const groups = React.useMemo(() => {
    const m = new Map()
    for (const r of rows) {
      if (q && !r.fullName.toLowerCase().includes(q)) continue
      if (!m.has(r.owner)) m.set(r.owner, [])
      m.get(r.owner).push(r)
    }
    return [...m.entries()]
  }, [rows, q])

  const message = overCap ? `Select at most ${MAX_GITHUB_REPOS} repositories` : status
  const isError = overCap || status.startsWith('Error')
  const tag = { fontSize: 11, color: 'var(--text-subtle)', border: '1px solid var(--border)', borderRadius: 4, padding: '0 5px' }

  return (
    <CardFrame title="GitHub Connection" icon={<Icon name="pr" size={16} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={issues} onChange={e => setIssues(e.target.checked)} />
          Load GitHub issues
        </label>
        {!issues && (
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: -8 }}>
            Pull requests and Actions runs still come from GitHub.
          </div>
        )}
        <SettField label="Personal Access Token" hint="A classic token needs the repo, read:org and workflow scopes; a fine-grained token needs read access to Issues, Pull requests, Actions and Metadata (write to Issues to edit them). Leave blank to keep existing.">
          <input type="password" value={pat} onChange={e => setPat(e.target.value)}
            placeholder="Leave blank to keep existing token" style={settInputStyle} />
        </SettField>

        <SettField label="Repositories" hint="Discover lists every repository the token can reach, across your organizations.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search repositories" style={{ ...settInputStyle, flex: 1 }} />
              <span style={{ fontSize: 12, color: overCap ? 'var(--danger)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {selected.length} of {MAX_GITHUB_REPOS} selected
              </span>
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {groups.map(([owner, list]) => (
                <div key={owner} role="group" aria-label={owner}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 2 }}>{owner}</div>
                  {list.map(r => (
                    <label key={r.fullName} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '1px 0' }}>
                      <input type="checkbox" checked={selected.includes(r.fullName)} onChange={() => toggle(r.fullName)} aria-label={r.fullName} />
                      <span>{r.fullName}</span>
                      {r.private && <span style={tag}>private</span>}
                      {r.archived && <span style={tag}>archived</span>}
                      {r.hasIssues === false && <span style={tag}>issues off</span>}
                    </label>
                  ))}
                </div>
              ))}
            </div>
            {found?.ssoOrgs?.length > 0 && (
              <div style={{ fontSize: 12.5 }}>
                <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Orgs needing SSO authorization</div>
                {found.ssoOrgs.map(o => (
                  <div key={o.login}>
                    <a href={o.url} target="_blank" rel="noopener noreferrer">Authorize the token for {o.login}</a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SettField>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn sm ghost" onClick={discoverRepos} disabled={!!busy}>
            {busy === 'discover' ? 'Discovering…' : 'Discover repositories'}
          </button>
          <button className="btn primary" onClick={save} disabled={!!busy || overCap}>
            {busy === 'save' ? 'Saving…' : 'Save & connect'}
          </button>
          {message && (
            <span style={{ fontSize: 12.5, color: isError ? 'var(--danger)' : 'var(--success)' }}>
              {message}
            </span>
          )}
        </div>
      </div>
    </CardFrame>
  )
}
