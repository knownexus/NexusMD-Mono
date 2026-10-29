// github-history.jsx — a GitHub branch's commits; selecting one shows its message and files.
import React from 'react'
import { listGithubCommits, getGithubCommit, timeAgo } from '@nexusmd/core'
import { GithubPatch } from '@nexusmd/ui'
import { GithubCard, Notice } from './github-ui.jsx'

const { useState, useEffect } = React

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
  if (state.status === 'loading') return <Notice>Loading commit…</Notice>
  if (state.status === 'error') return <Notice kind="error">{state.error}</Notice>
  const c = state.commit
  const url = `https://github.com/${repo}/commit/${sha}`
  // The first line is the row's title; what follows is the body.
  const body = String(c.message || '').split('\n').slice(1).join('\n').trim()
  return (
    <div className="nx-gw-gh-commit">
      {body && <p className="nx-gw-gh-commit-body">{body}</p>}
      {(c.files || []).map(f => {
        const filename = f.path.split('/').pop()
        const dir = f.path.slice(0, f.path.length - filename.length)
        return (
          <div key={f.path} className="nx-gw-gh-file">
            <button type="button" className="nx-gw-gh-file-head" aria-expanded={!!open[f.path]} onClick={() => setOpen(o => ({ ...o, [f.path]: !o[f.path] }))}>
              <span className="nx-gw-gh-file-path"><span className="dir">{dir}</span>{filename}</span>
              <span className="add">+{f.additions}</span>
              <span className="del">−{f.deletions}</span>
            </button>
            {open[f.path] && <div className="nx-gw-gh-file-diff"><GithubPatch patch={f.patch} url={url} /></div>}
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
  if (state.status === 'loading') return <Notice>Loading commits…</Notice>
  if (state.status === 'error') return <Notice kind="error">{state.error}</Notice>
  if (!state.commits.length) return <Notice kind="empty">No commits on this branch.</Notice>
  return (
    <GithubCard title={`Commits on ${branch}`} hint={`${state.commits.length} most recent`} tone="info" label="Commits">
      <ul className="nx-gw-gh-rows">
        {state.commits.map(c => (
          <li key={c.sha} className="nx-gw-gh-commit-row" data-open={selected === c.sha ? 'true' : undefined}>
            <button type="button" className="nx-gw-attn-open" aria-pressed={selected === c.sha} onClick={() => setSelected(s => (s === c.sha ? null : c.sha))}>
              <span className="branch">{c.message.split('\n')[0]}</span>
              <span className="nx-gw-row-meta">
                <span>{c.author}</span>
                {c.date && <span>{`${timeAgo(c.date)} ago`}</span>}
                <span className="mono">{c.sha.slice(0, 7)}</span>
              </span>
            </button>
            {selected === c.sha && <CommitDetail repo={repo} client={client} sha={c.sha} />}
          </li>
        ))}
      </ul>
    </GithubCard>
  )
}
