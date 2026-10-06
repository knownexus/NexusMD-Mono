// apps/desktop/src/jira-settings.jsx — Jira Cloud connection + work-item display settings.
import React from 'react'
import { CardFrame, Icon } from '@nexusmd/ui'
import { makeJiraClient, JIRA_CACHE_KEY } from '@nexusmd/core'
import { SettField, settInputStyle } from './desktop-settings.jsx'
import { getJiraConfig, saveJiraConfig, createJiraHttpAdapter } from './jira-client.js'
import { getProfileKey } from './profile-keys.js'

const TOKEN_URL = 'https://id.atlassian.com/manage-profile/security/api-tokens'
const splitKeys = (s) => s.split(/[,\s]+/).map(k => k.trim()).filter(Boolean)

export function JiraConnectionCard({ onRefreshData }) {
  const [site, setSite]         = React.useState('')
  const [email, setEmail]       = React.useState('')
  const [token, setToken]       = React.useState('')
  const [keys, setKeys]         = React.useState('')
  const [jql, setJql]           = React.useState('')
  const [enabled, setEnabled]   = React.useState(true)
  const [available, setAvailable] = React.useState([])
  const [status, setStatus]     = React.useState('')
  const [busy, setBusy]         = React.useState(false)

  React.useEffect(() => {
    const c = getJiraConfig()
    setSite(c.site || '')
    setEmail(c.email || '')
    setKeys((c.projectKeys || []).join(', '))
    setJql(c.jql || '')
    setEnabled(c.enabled !== false)
  }, [])

  const connectionValues = () => ({
    site: site.trim(), email: email.trim(), ...(token.trim() ? { apiToken: token.trim() } : {}),
  })

  const testConnection = async () => {
    setBusy(true)
    setStatus('Testing…')
    try {
      saveJiraConfig(connectionValues())
      const client = makeJiraClient(createJiraHttpAdapter())
      const me = await client.get('rest/api/3/myself')
      setStatus(`Connected as ${me?.displayName || 'unknown user'}`)
      const projects = await client.get('rest/api/3/project/search?maxResults=100&orderBy=name').catch(() => null)
      setAvailable((projects?.values || []).map(p => ({ key: p.key, name: p.name })))
    } catch (e) {
      setStatus('Error: ' + (e?.message || 'connection failed'))
    } finally {
      setBusy(false)
    }
  }

  const toggleKey = (key) => {
    const current = splitKeys(keys)
    const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key]
    setKeys(next.join(', '))
  }

  const save = () => {
    saveJiraConfig({ ...connectionValues(), projectKeys: splitKeys(keys), jql: jql.trim(), enabled })
    setToken('')
    setStatus('Saved! Loading data…')
    // Drop the cache so the refresh refetches metadata for the new settings.
    try { localStorage.removeItem(JIRA_CACHE_KEY) } catch {}
    onRefreshData?.().catch(() => {})
    setTimeout(() => setStatus(''), 3000)
  }

  const isError = status.startsWith('Error')
  const selected = new Set(splitKeys(keys).map(k => k.toUpperCase()))

  return (
    <CardFrame title="Jira Cloud Connection" icon={<Icon name="settings" size={16} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          Load Jira work items
        </label>
        <SettField label="Site" hint="yoursite, yoursite.atlassian.net, or a full Jira URL">
          <input aria-label="Site" value={site} onChange={e => setSite(e.target.value)} placeholder="yoursite" style={settInputStyle} />
        </SettField>
        <SettField label="Email" hint="The Atlassian account email the API token belongs to">
          <input aria-label="Email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" style={settInputStyle} />
        </SettField>
        <SettField label="API token" hint="Leave blank to keep the existing token.">
          <input aria-label="API token" type="password" value={token} onChange={e => setToken(e.target.value)}
            placeholder="Leave blank to keep existing token" style={settInputStyle} />
          <a href={TOKEN_URL} target="_blank" rel="noopener" style={{ fontSize: 11.5 }}
            onClick={e => { if (window.electronAPI?.openLink) { e.preventDefault(); window.electronAPI.openLink(TOKEN_URL) } }}>
            Create an API token
          </a>
        </SettField>
        <SettField label="Project keys" hint="Comma-separated, e.g. ABC, DEF. Test the connection to pick from a list.">
          <input aria-label="Project keys" value={keys} onChange={e => setKeys(e.target.value)} placeholder="ABC, DEF" style={settInputStyle} />
        </SettField>
        {available.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
            {available.map(p => (
              <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                <input type="checkbox" aria-label={`${p.key} — ${p.name}`} checked={selected.has(p.key)} onChange={() => toggleKey(p.key)} />
                <span className="mono">{p.key}</span> {p.name}
              </label>
            ))}
          </div>
        )}
        <details>
          <summary style={{ fontSize: 12.5, cursor: 'pointer' }}>Advanced</summary>
          <SettField label="Extra JQL filter" hint="ANDed with the project filter, e.g. assignee in membersOf(&quot;my-team&quot;)">
            <input aria-label="Extra JQL filter" value={jql} onChange={e => setJql(e.target.value)} style={settInputStyle} />
          </SettField>
        </details>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn sm ghost" onClick={testConnection} disabled={busy}>
            {busy ? 'Testing…' : 'Test connection'}
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>Save &amp; connect</button>
          {status && (
            <span style={{ fontSize: 12.5, color: isError ? 'var(--danger)' : 'var(--success)' }}>{status}</span>
          )}
        </div>
      </div>
    </CardFrame>
  )
}

const DISPLAY_KEY = 'nexusmd.wi.displayMode'

export function WorkItemsDisplayCard() {
  const read = () => {
    try { return JSON.parse(localStorage.getItem(getProfileKey(DISPLAY_KEY)) || '"merged"') } catch { return 'merged' }
  }
  const [mode, setMode] = React.useState(read)
  const choose = (m) => {
    setMode(m)
    try { localStorage.setItem(getProfileKey(DISPLAY_KEY), JSON.stringify(m)) } catch { /* quota */ }
  }
  return (
    <CardFrame title="Work Items Display" icon={<Icon name="list" size={16} />}>
      <SettField label="When both ADO and Jira are connected" hint="Also switchable from the Work Items toolbar.">
        <div style={{ display: 'flex', gap: 6 }}>
          {[['merged', 'Merged'], ['separate', 'Separate']].map(([v, l]) => (
            <button key={v} className={`btn sm ${mode === v ? 'primary' : 'ghost'}`} aria-pressed={mode === v} onClick={() => choose(v)}>{l}</button>
          ))}
        </div>
      </SettField>
    </CardFrame>
  )
}
