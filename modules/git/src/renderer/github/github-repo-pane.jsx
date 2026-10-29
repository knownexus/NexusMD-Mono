import React from 'react'
import { mapGithubPR, mapGithubIssue } from '@nexusmd/core'
import { relativeTime } from '../history-pane.jsx'

export const GITHUB_TABS = [
  { id: 'prs', label: 'Pull requests' },
  { id: 'issues', label: 'Issues' },
  { id: 'branches', label: 'Branches' },
  { id: 'history', label: 'History' },
  { id: 'files', label: 'Files' },
]

// Open pull requests or issues for a repository, fetched live. A repo, client or refresh change
// refetches, and a late answer for an earlier one is dropped.
function useList(client, path, refreshKey) {
  const [state, setState] = React.useState({ path: null, items: null, error: '' })
  React.useEffect(() => {
    let live = true
    if (!client) { setState({ path, items: [], error: '' }); return undefined }
    Promise.resolve().then(() => client.getPaged(path)).then(
      items => { if (live) setState({ path, items, error: '' }) },
      err => { if (live) setState({ path, items: [], error: err?.message || String(err) }) },
    )
    return () => { live = false }
  }, [client, path, refreshKey])
  return state.path === path ? state : { path, items: null, error: '' }
}

function Rows({ rows, onOpen, empty }) {
  if (!rows.length) return <div className="nx-empty" style={{ padding: 16 }}>{empty}</div>
  return (
    <ul className="nx-gw-list">
      {rows.map(r => (
        <li key={r.key}>
          <button type="button" className="nx-gw-row" onClick={() => onOpen(r.raw)}>
            <span className="nx-gw-dot" data-tone={r.tone} />
            <span className="nx-gw-row-body">
              <span className="nx-gw-row-title">{`#${r.number} ${r.title}`}</span>
              <span className="nx-gw-row-meta">
                <span>{r.author}</span>
                <span>{r.time ? relativeTime(r.time) : ''}</span>
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Listing({ client, repo, kind, refreshKey, onOpen }) {
  const path = `repos/${repo}/${kind === 'prs' ? 'pulls' : 'issues'}?state=open`
  const { items, error } = useList(client, path, refreshKey)
  if (error) return <div className="nx-empty" role="alert" style={{ padding: 16 }}>{error}</div>
  if (!items) return <div className="nx-empty" style={{ padding: 16 }}>Loading…</div>
  const list = kind === 'prs' ? items : items.filter(i => !i.pull_request)
  const rows = list.map(p => ({
    key: p.number,
    number: p.number,
    title: p.title,
    author: p.user?.login || '',
    time: Date.parse(p.updated_at || p.created_at || '') || 0,
    tone: p.draft ? 'muted' : 'ok',
    raw: p,
  }))
  const open = raw => onOpen(kind === 'prs' ? mapGithubPR(raw, repo) : mapGithubIssue(raw, repo))
  return <Rows rows={rows} onOpen={open} empty={kind === 'prs' ? 'No open pull requests.' : 'No open issues.'} />
}

/** The chosen repository's right pane: a tab per view; Branches, History and Files are wired in later. */
export function GithubRepoPane({ repo, client, refreshKey, openPR, openItem, initialTab = 'prs' }) {
  const [tab, setTab] = React.useState(initialTab)
  return (
    <div className="nx-gw-gh-pane">
      <div aria-label="Repository views" className="nx-gw-gh-tabs" style={{ display: 'flex', gap: 4, padding: '4px 0' }}>
        {GITHUB_TABS.map(t => (
          <button key={t.id} type="button" aria-pressed={tab === t.id} className={`btn sm ${tab === t.id ? '' : 'ghost'}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === 'prs' && <Listing client={client} repo={repo} kind="prs" refreshKey={refreshKey} onOpen={openPR} />}
      {tab === 'issues' && <Listing client={client} repo={repo} kind="issues" refreshKey={refreshKey} onOpen={openItem} />}
      {tab !== 'prs' && tab !== 'issues' && <div className="nx-empty" style={{ padding: 16 }}>Coming soon</div>}
    </div>
  )
}
