// github-files.jsx — read-only browser of a GitHub repo's files at a branch.
import React from 'react'
import { listGithubContents, getGithubFile } from '@nexusmd/core'
import { Icon } from '@nexusmd/ui'
import { GithubCard, Notice } from './github-ui.jsx'

const { useState, useEffect } = React

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
  if (state.status === 'loading') return <Notice>Loading file…</Notice>
  if (state.status === 'error') return <Notice kind="error">{state.error}</Notice>
  const { file } = state
  if (file.reason) {
    return (
      <div className="nx-gw-empty">
        {file.reason === 'binary' ? 'This is a binary file, so it isn’t shown here.' : 'This file is too large to show here.'}{' '}
        <a href={file.url} target="_blank" rel="noopener">Open on GitHub</a>
      </div>
    )
  }
  return <pre className="nx-gw-gh-code mono">{file.text}</pre>
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
    : <button key={`c${p}`} type="button" className="nx-gw-gh-crumb" onClick={() => go(p)}>{label}</button>)
  const crumbs = [crumb(repo.split('/').pop() || repo, '', !parts.length && !file)]
  parts.forEach((seg, i) => {
    crumbs.push(<span key={`s${i}`} className="sep">/</span>)
    crumbs.push(crumb(seg, parts.slice(0, i + 1).join('/'), i === parts.length - 1 && !file))
  })
  if (file) { crumbs.push(<span key="sf" className="sep">/</span>); crumbs.push(<span key="f" aria-current="page">{file.split('/').pop()}</span>) }

  const sorted = [...state.items].sort((a, b) => (a.type === b.type ? 0 : a.type === 'dir' ? -1 : 1))
  let body
  if (file) body = <FileView repo={repo} client={client} branch={branch} path={file} />
  else if (state.status === 'loading') body = <Notice>Loading…</Notice>
  else if (state.status === 'error') body = <Notice kind="error">{state.error}</Notice>
  else if (!sorted.length) body = <div className="nx-gw-empty">This folder is empty.</div>
  else {
    body = (
      <ul className="nx-gw-gh-rows">
        {sorted.map(it => (
          <li key={it.path}>
            <button type="button" className="nx-gw-gh-item" onClick={() => (it.type === 'dir' ? go(it.path) : setFile(it.path))}>
              <Icon name={it.type === 'dir' ? 'folder' : 'doc'} size={13} />
              <span className="name">{it.name}</span>
            </button>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <GithubCard title={`Files on ${branch}`} label="Files" head={<nav aria-label="Path" className="nx-gw-gh-path">{crumbs}</nav>}>
      {body}
    </GithubCard>
  )
}
