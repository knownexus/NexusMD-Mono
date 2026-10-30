// github-files.jsx — a GitHub repository's files at a branch, in the same explorer as a local worktree's.
import React from 'react'
import { getGithubFile } from '@nexusmd/core'
import { FileExplorer, PreviewHead } from '../file-explorer.jsx'
import { TextPreview } from '../file-preview.jsx'
import { githubBlobUrl } from './github-open.js'

// Every file at a commit, from one call (git's recursive tree). GitHub cuts very large trees short.
export async function listGithubTree(client, repo, sha) {
  const r = await client.get(`repos/${repo}/git/trees/${encodeURIComponent(sha)}?recursive=1`)
  return { files: (r?.tree ?? []).filter(e => e.type === 'blob').map(e => e.path), truncated: !!r?.truncated }
}

const REASONS = { binary: 'This is a binary file, so it isn’t shown here.', 'too-large': 'This file is too large to show here.' }

/**
 * The GitHub tab's Files: the tree at `branch` (its commit `sha`) and the picked file's text.
 * `fileActions(path)` gives the preview's buttons and the right-click menu (see github-open.js).
 */
export function GithubFiles({ repo, client, branch, sha, refreshKey = 0, fileActions = path => [{ label: 'Open on GitHub', onSelect: () => window.open(githubBlobUrl(repo, branch, path), '_blank', 'noopener,noreferrer') }] }) {
  const [state, setState] = React.useState({ key: null, files: null, truncated: false, error: null })
  const [note, setNote] = React.useState(null)
  const key = `${repo}@${sha || branch}#${refreshKey}`
  React.useEffect(() => {
    let live = true
    Promise.resolve().then(() => listGithubTree(client, repo, sha || branch)).then(
      r => { if (live) setState({ key, ...r, error: null }) },
      e => { if (live) setState({ key, files: null, truncated: false, error: e?.message || String(e) }) },
    )
    return () => { live = false }
    // `key` holds everything the list depends on.
  }, [client, key]) // eslint-disable-line react-hooks/exhaustive-deps
  const current = state.key === key ? state : { files: null, truncated: false, error: null }

  const attempt = action => async () => {
    setNote(null)
    try { await action.onSelect() } catch (e) { setNote(e?.message || String(e)) }
  }
  const actions = path => fileActions(path).map(a => ({ ...a, onSelect: attempt(a) }))
  const preview = path => (
    <>
      <PreviewHead path={path} actions={actions(path)} />
      <TextPreview path={path} loadKey={key}
        load={() => getGithubFile(client, repo, { path, ref: branch }).then(f => (f.text == null ? { text: null, note: REASONS[f.reason] ?? REASONS.binary } : { text: f.text }))}
        extra={<a href={githubBlobUrl(repo, branch, path)} target="_blank" rel="noopener noreferrer">Open on GitHub</a>} />
    </>
  )
  return (
    <div className="nx-gw-gh-files">
      {note && <div role="alert" className="nx-alert bad">{note}</div>}
      <FileExplorer label="Files" rootName={repo.split('/').pop() || repo} files={current.files} truncated={current.truncated} error={current.error}
        viewKey={`github:${repo}@${branch}`} menuItems={row => (row.kind === 'file' ? actions(row.path).map(({ label, onSelect }) => ({ label, onSelect })) : [])}
        preview={preview} />
    </div>
  )
}
