// github-files.jsx — read-only browser of a GitHub repo's files at a branch.
import React from 'react'
import { listGithubContents, getGithubFile } from '@nexusmd/core'

const { useState, useEffect } = React

const alertStyle = { color: 'var(--danger)' }

function FileView({ repo, client, branch, path }) {
  const [state, setState] = useState({ status: 'loading', file: null, error: '' })
  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading', file: null, error: '' })
    getGithubFile(client, repo, { path, ref: branch })
      .then(file => { if (!cancelled) setState({ status: 'ok', file, error: '' }) })
      .catch(e => { if (!cancelled) setState({ status: 'error', file: null, error: e.message }) })
    return () => { cancelled = true }
  }, [client, repo, branch, path])
  if (state.status === 'loading') return <div className="nx-gw-empty">Loading file…</div>
  if (state.status === 'error') return <div className="nx-gw-empty" role="alert" style={alertStyle}>{state.error}</div>
  const { file } = state
  if (file.reason) {
    return (
      <div className="nx-gw-empty">
        {file.reason === 'binary' ? 'Binary file.' : 'File is too large to show.'}{' '}
        <a href={file.url} target="_blank" rel="noopener">Open on GitHub</a>
      </div>
    )
  }
  return <pre className="mono" style={{ margin: 0, padding: 10, overflow: 'auto', fontSize: 12 }}>{file.text}</pre>
}

export function GithubFiles({ repo, client, branch }) {
  const [path, setPath] = useState('')
  const [file, setFile] = useState(null)
  const [state, setState] = useState({ status: 'loading', items: [], error: '' })
  useEffect(() => { setPath(''); setFile(null) }, [repo, branch])
  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading', items: [], error: '' })
    listGithubContents(client, repo, { path, ref: branch })
      .then(items => { if (!cancelled) setState({ status: 'ok', items, error: '' }) })
      .catch(e => { if (!cancelled) setState({ status: 'error', items: [], error: e.message }) })
    return () => { cancelled = true }
  }, [client, repo, branch, path])

  const go = (p) => { setPath(p); setFile(null) }
  const parts = path ? path.split('/') : []
  const crumb = (label, p, last) => (last
    ? <span key={`c${p}`} aria-current="page">{label}</span>
    : <button key={`c${p}`} type="button" onClick={() => go(p)} style={{ all: 'unset', cursor: 'pointer', color: 'var(--accent)' }}>{label}</button>)
  const crumbs = [crumb(repo.split('/').pop() || repo, '', !parts.length && !file)]
  parts.forEach((seg, i) => {
    crumbs.push(<span key={`s${i}`}> / </span>)
    crumbs.push(crumb(seg, parts.slice(0, i + 1).join('/'), i === parts.length - 1 && !file))
  })
  if (file) { crumbs.push(<span key="sf"> / </span>); crumbs.push(<span key="f" aria-current="page">{file.split('/').pop()}</span>) }

  const sorted = [...state.items].sort((a, b) => (a.type === b.type ? 0 : a.type === 'dir' ? -1 : 1))
  let body
  if (file) body = <FileView repo={repo} client={client} branch={branch} path={file} />
  else if (state.status === 'loading') body = <div className="nx-gw-empty">Loading…</div>
  else if (state.status === 'error') body = <div className="nx-gw-empty" role="alert" style={alertStyle}>{state.error}</div>
  else if (!sorted.length) body = <div className="nx-gw-empty">Empty folder.</div>
  else {
    body = (
      <ul className="nx-gw-gh-list">
        {sorted.map(it => (
          <li key={it.path}>
            <button type="button" onClick={() => (it.type === 'dir' ? go(it.path) : setFile(it.path))}
              style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}>
              <span aria-hidden="true">{it.type === 'dir' ? '▸ ' : ''}</span>{it.name}
            </button>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <div className="nx-gw-gh-files">
      <nav aria-label="Path" style={{ padding: '6px 10px', fontSize: 12 }}>{crumbs}</nav>
      {body}
    </div>
  )
}
