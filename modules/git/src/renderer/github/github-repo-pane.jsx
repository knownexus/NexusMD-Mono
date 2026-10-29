import React from 'react'
import { mapGithubPR, mapGithubIssue, listGithubBranches } from '@nexusmd/core'
import { relativeTime } from '../history-pane.jsx'
import { GithubBranches } from './github-branches.jsx'
import { GithubHistory } from './github-history.jsx'
import { GithubFiles } from './github-files.jsx'
import { GithubCard, Notice } from './github-ui.jsx'

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

function Rows({ rows, onOpen }) {
  return (
    <ul className="nx-gw-gh-rows">
      {rows.map(r => (
        <li key={r.key} className="nx-gw-attn-row">
          <button type="button" className="nx-gw-attn-open" onClick={() => onOpen(r.raw)}>
            <span className="branch"><span className="nx-gw-gh-num">{`#${r.number}`}</span>{r.title}</span>
            <span className="nx-gw-row-meta">
              {r.meta.filter(Boolean).map((m, i) => <span key={i}>{m}</span>)}
            </span>
          </button>
          {r.tags.length > 0 && (
            <span className="nx-gw-attn-actions">{r.tags.map(t => <span key={t} className="nx-badge">{t}</span>)}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

function Listing({ client, repo, kind, refreshKey, onOpen }) {
  const path = `repos/${repo}/${kind === 'prs' ? 'pulls' : 'issues'}?state=open`
  const { items, error } = useList(client, path, refreshKey)
  if (error) return <Notice kind="error">{error}</Notice>
  if (!items) return <Notice>{kind === 'prs' ? 'Loading pull requests…' : 'Loading issues…'}</Notice>
  const list = kind === 'prs' ? items : items.filter(i => !i.pull_request)
  if (!list.length) return <Notice kind="empty">{kind === 'prs' ? 'No open pull requests.' : 'No open issues.'}</Notice>
  const when = p => Date.parse(p.updated_at || p.created_at || '') || 0
  const rows = list.map(p => ({
    key: p.number,
    number: p.number,
    title: p.title,
    meta: kind === 'prs'
      ? [p.user?.login, p.head?.ref && p.base?.ref ? `${p.head.ref} → ${p.base.ref}` : '', when(p) ? `updated ${relativeTime(when(p))}` : '']
      : [p.user?.login, p.comments ? `${p.comments} ${p.comments === 1 ? 'comment' : 'comments'}` : '', when(p) ? `updated ${relativeTime(when(p))}` : ''],
    tags: [...(p.draft ? ['Draft'] : []), ...(p.labels || []).map(l => l.name).filter(Boolean)],
    raw: p,
  }))
  const open = raw => onOpen(kind === 'prs' ? mapGithubPR(raw, repo) : mapGithubIssue(raw, repo))
  const title = kind === 'prs' ? 'Open pull requests' : 'Open issues'
  return (
    <GithubCard title={title} hint={String(rows.length)} tone={kind === 'prs' ? 'info' : 'ok'}>
      <Rows rows={rows} onOpen={open} />
    </GithubCard>
  )
}

/** The chosen repository's right pane: a tab per view. History and Files share a picked branch. */
export function GithubRepoPane({ repo, client, refreshKey, openPR, openItem, initialTab = 'prs', confirm, openPRs, counts = {} }) {
  const [tab, setTab] = React.useState(initialTab)
  const [loaded, setLoaded] = React.useState({ repo: null, client: null, list: null })
  const [picked, setPicked] = React.useState('')
  const [branchError, setBranchError] = React.useState('')
  const needsBranches = tab === 'history' || tab === 'files'
  const branches = loaded.repo === repo && loaded.client === client ? loaded.list : null

  // Branches reported by the Branches tab replace whatever list the pane has; a response that was
  // requested before such a report is older than it and is dropped.
  const version = React.useRef(0)
  const onBranchesChanged = React.useCallback(list => { version.current += 1; setLoaded({ repo, client, list }); setBranchError('') }, [repo, client])
  React.useEffect(() => { setPicked('') }, [repo])

  // Loaded when History or Files is shown and again on every refresh; the current list stays on
  // screen while the new one loads.
  React.useEffect(() => {
    if (!needsBranches || !client) return undefined
    let live = true
    const started = version.current
    Promise.resolve().then(() => listGithubBranches(client, repo)).then(
      list => { if (live && version.current === started) { setLoaded({ repo, client, list }); setBranchError('') } },
      e => { if (live && version.current === started) setBranchError(e?.message || String(e)) },
    )
    return () => { live = false }
  }, [needsBranches, client, repo, refreshKey])

  const defaultName = branches ? (branches.find(b => b.isDefault)?.name ?? branches[0]?.name ?? '') : ''
  const branch = branches && branches.some(b => b.name === picked) ? picked : defaultName

  const branchView = Component => {
    if (branchError) return <Notice kind="error">{branchError}</Notice>
    if (!branches) return <Notice>Loading branches…</Notice>
    return <Component repo={repo} client={client} branch={branch} refreshKey={refreshKey} />
  }
  const count = { prs: counts.prs, issues: counts.issues }

  return (
    <div className="nx-gw-gh-pane">
      <div className="nx-gw-tabs">
        <div role="tablist" aria-label="Repository views" style={{ display: 'contents' }}>
          {GITHUB_TABS.map(t => (
            <button key={t.id} type="button" role="tab" className="nx-gw-tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}{count[t.id] > 0 && <>{' '}<span className="n">{count[t.id]}</span></>}
            </button>
          ))}
        </div>
        {needsBranches && branches && branches.length > 0 && (
          <div className="nx-gw-tabs-end">
            <label className="nx-gw-gh-pick">
              <span>Branch</span>
              <select className="nx-input" aria-label="Branch" value={branch} onChange={e => setPicked(e.target.value)}>
                {branches.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
              </select>
            </label>
          </div>
        )}
      </div>
      <div className="nx-gw-gh-view">
        {tab === 'prs' && <Listing client={client} repo={repo} kind="prs" refreshKey={refreshKey} onOpen={openPR} />}
        {tab === 'issues' && <Listing client={client} repo={repo} kind="issues" refreshKey={refreshKey} onOpen={openItem} />}
        {tab === 'branches' && <GithubBranches repo={repo} client={client} refreshKey={refreshKey} confirm={confirm} onBranchesChanged={onBranchesChanged} openPRs={openPRs} />}
        {tab === 'history' && branchView(GithubHistory)}
        {tab === 'files' && branchView(GithubFiles)}
      </div>
    </div>
  )
}
