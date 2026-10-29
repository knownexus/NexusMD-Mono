// github-history.jsx — a GitHub branch's commits; selecting one shows its message and files.
import React from 'react'
import { listGithubCommits, getGithubCommit, timeAgo } from '@nexusmd/core'
import { GithubPatch } from '@nexusmd/ui'

const { useState, useEffect } = React

const alertStyle = { color: 'var(--danger)' }

function CommitDetail({ repo, client, sha }) {
  const [state, setState] = useState({ status: 'loading', commit: null, error: '' })
  const [open, setOpen] = useState({})
  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading', commit: null, error: '' })
    getGithubCommit(client, repo, sha)
      .then(commit => { if (!cancelled) setState({ status: 'ok', commit, error: '' }) })
      .catch(e => { if (!cancelled) setState({ status: 'error', commit: null, error: e.message }) })
    return () => { cancelled = true }
  }, [client, repo, sha])
  if (state.status === 'loading') return <div className="nx-gw-empty">Loading commit…</div>
  if (state.status === 'error') return <div className="nx-gw-empty" role="alert" style={alertStyle}>{state.error}</div>
  const c = state.commit
  const url = `https://github.com/${repo}/commit/${sha}`
  return (
    <div className="nx-gw-gh-commit">
      <pre style={{ whiteSpace: 'pre-wrap', margin: '0 0 8px' }}>{c.message}</pre>
      {(c.files || []).map(f => {
        const filename = f.path.split('/').pop()
        const dir = f.path.slice(0, f.path.length - filename.length)
        return (
          <div key={f.path} style={{ border: '1px solid var(--border)', borderRadius: 6, marginBottom: 4, overflow: 'hidden' }}>
            <button type="button" aria-expanded={!!open[f.path]} onClick={() => setOpen(o => ({ ...o, [f.path]: !o[f.path] }))}
              style={{ display: 'flex', gap: 8, width: '100%', padding: '6px 10px', border: 0, background: 'var(--surface-2)', color: 'var(--text)', cursor: 'pointer', textAlign: 'left', fontSize: 12 }}>
              <span style={{ flex: 1, minWidth: 0 }}><span className="muted">{dir}</span><b>{filename}</b></span>
              <span style={{ color: 'var(--success)' }}>+{f.additions}</span>
              <span style={{ color: 'var(--danger)' }}>−{f.deletions}</span>
            </button>
            {open[f.path] && <div style={{ overflow: 'auto', maxHeight: 480 }}><GithubPatch patch={f.patch} url={url} /></div>}
          </div>
        )
      })}
    </div>
  )
}

export function GithubHistory({ repo, client, branch, refreshKey }) {
  const [state, setState] = useState({ status: 'loading', commits: [], error: '' })
  const [selected, setSelected] = useState(null)
  useEffect(() => {
    let cancelled = false
    setSelected(null)
    setState({ status: 'loading', commits: [], error: '' })
    listGithubCommits(client, repo, branch)
      .then(commits => { if (!cancelled) setState({ status: 'ok', commits, error: '' }) })
      .catch(e => { if (!cancelled) setState({ status: 'error', commits: [], error: e.message }) })
    return () => { cancelled = true }
  }, [client, repo, branch, refreshKey])
  if (state.status === 'loading') return <div className="nx-gw-empty">Loading commits…</div>
  if (state.status === 'error') return <div className="nx-gw-empty" role="alert" style={alertStyle}>{state.error}</div>
  if (!state.commits.length) return <div className="nx-gw-empty">No commits.</div>
  return (
    <div className="nx-gw-gh-history">
      <ul className="nx-gw-gh-list">
        {state.commits.map(c => (
          <li key={c.sha}>
            <button type="button" className="nx-gw-gh-item" aria-pressed={selected === c.sha} onClick={() => setSelected(s => (s === c.sha ? null : c.sha))}>
              <span>{c.message.split('\n')[0]}</span>
              <span className="muted" style={{ fontSize: 11 }}>
                {' · '}{c.author}{c.date ? ` · ${timeAgo(c.date)} ago` : ''}{' · '}<span className="mono">{c.sha.slice(0, 7)}</span>
              </span>
            </button>
            {selected === c.sha && <CommitDetail repo={repo} client={client} sha={c.sha} />}
          </li>
        ))}
      </ul>
    </div>
  )
}
