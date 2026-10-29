import React from 'react'
import { mapGithubPR, mapGithubIssue, listGithubBranches } from '@nexusmd/core'
import { relativeTime } from '../history-pane.jsx'
import { GithubBranches } from './github-branches.jsx'
import { GithubHistory } from './github-history.jsx'
import { GithubFiles } from './github-files.jsx'

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

/** The chosen repository's right pane: a tab per view. History and Files share a picked branch. */
export function GithubRepoPane({ repo, client, refreshKey, openPR, openItem, initialTab = 'prs', confirm }) {
  const [tab, setTab] = React.useState(initialTab)
  const [loaded, setLoaded] = React.useState({ repo: null, client: null, list: null })
  const [picked, setPicked] = React.useState('')
  const [branchError, setBranchError] = React.useState('')
  const needsBranches = tab === 'history' || tab === 'files'
  const branches = loaded.repo === repo && loaded.client === client ? loaded.list : null

  // Branches reported by the Branches tab replace whatever list the pane has.
  const onBranchesChanged = React.useCallback(list => { setLoaded({ repo, client, list }); setBranchError('') }, [repo, client])
  React.useEffect(() => { setPicked('') }, [repo])

  React.useEffect(() => {
    if (!needsBranches || !client || branches) return undefined
    let live = true
    Promise.resolve().then(() => listGithubBranches(client, repo)).then(
      list => { if (live) { setLoaded(cur => (cur.repo === repo && cur.client === client && cur.list ? cur : { repo, client, list })); setBranchError('') } },
      e => { if (live) setBranchError(e?.message || String(e)) },
    )
    return () => { live = false }
  }, [needsBranches, client, repo, branches])

  const defaultName = branches ? (branches.find(b => b.isDefault)?.name ?? branches[0]?.name ?? '') : ''
  const branch = branches && branches.some(b => b.name === picked) ? picked : defaultName

  const picker = (
    <div style={{ padding: '8px 16px 0' }}>
      <select aria-label="Branch" value={branch} onChange={e => setPicked(e.target.value)}>
        {(branches || []).map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
      </select>
    </div>
  )
  const branchView = Component => {
    if (branchError) return <div className="nx-gw-empty" role="alert">{branchError}</div>
    if (!branches) return <div className="nx-gw-empty">Loading…</div>
    return <>{picker}<Component repo={repo} client={client} branch={branch} refreshKey={refreshKey} /></>
  }

  return (
    <div className="nx-gw-gh-pane">
      <div aria-label="Repository views" className="nx-gw-gh-tabs" style={{ display: 'flex', gap: 4, padding: '4px 0' }}>
        {GITHUB_TABS.map(t => (
          <button key={t.id} type="button" aria-pressed={tab === t.id} className={`btn sm ${tab === t.id ? '' : 'ghost'}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === 'prs' && <Listing client={client} repo={repo} kind="prs" refreshKey={refreshKey} onOpen={openPR} />}
      {tab === 'issues' && <Listing client={client} repo={repo} kind="issues" refreshKey={refreshKey} onOpen={openItem} />}
      {tab === 'branches' && <GithubBranches repo={repo} client={client} refreshKey={refreshKey} confirm={confirm} onBranchesChanged={onBranchesChanged} />}
      {tab === 'history' && branchView(GithubHistory)}
      {tab === 'files' && branchView(GithubFiles)}
    </div>
  )
}
