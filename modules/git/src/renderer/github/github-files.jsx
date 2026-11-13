// github-files.jsx — a GitHub repository's files at a branch, in the same explorer as a local worktree's.
import React from 'react'
import { getGithubFile, rendererLog } from '@nexusmd/core'
import { Segmented, MarkdownPreview, pinToHome } from '@nexusmd/ui'
import { FileExplorer } from '../file-explorer.jsx'
import { PathBar } from '../path-bar.jsx'
import { PopoverMenu } from '../popover-menu.jsx'
import { useRail } from '../use-rail.js'
import { GithubFileRail } from './github-file-rail.jsx'
import { useFilePrs, useFileCommits } from './use-file-prs.js'
import { TextPreview } from '../file-preview.jsx'
import { githubBlobUrl } from './github-open.js'

const log = rendererLog('git', 'github-files')

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
const isMarkdown = path => /\.(md|markdown)$/i.test(path)

// The picked file's panel: its open pull request, its history on the branch and the ways to open or link it.
function FilesRail({ repo, client, branch, sha, path, openPRs, refreshKey, actions, onViewPrs, fail }) {
  const { prs } = useFilePrs({ client, repo, openPRs, path, refreshKey })
  const { commits } = useFileCommits({ client, repo, branch, path, refreshKey })
  const list = actions(path)
  const primary = list.find(a => a.primary) ?? list.find(a => a.label !== 'Open on GitHub') ?? null
  const github = list.find(a => a.label === 'Open on GitHub')
  const copy = () => {
    const done = navigator.clipboard?.writeText(githubBlobUrl(repo, sha || branch, path))
    if (done) done.catch(e => { log.warn('the permalink could not be copied', e); fail(e?.message || String(e)) })
  }
  return (
    <GithubFileRail branch={branch} path={path} prs={prs} commits={commits} primary={primary}
      onOpenGithub={() => (github ? github.onSelect() : window.open(githubBlobUrl(repo, branch, path), '_blank', 'noopener,noreferrer'))}
      onCopyPermalink={copy} onViewPrs={onViewPrs} />
  )
}

export function GithubFiles({
  repo, client, branch, sha, refreshKey = 0, fileActions = path => [{ label: 'Open on GitHub', onSelect: () => window.open(githubBlobUrl(repo, branch, path), '_blank', 'noopener,noreferrer') }],
  branches = [], onBranch = null, openPRs = [], onViewPrs = () => {},
}) {
  const [state, setState] = React.useState({ key: null, files: null, truncated: false, error: null })
  const [note, setNote] = React.useState(null)
  const rootRef = React.useRef(null)
  const rail = useRail('github-files', { rootRef })
  // Source or Preview for a Markdown file; another file starts at Source.
  const [md, setMd] = React.useState({ path: null, view: 'source' })
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
  const rootName = repo.split('/').pop() || repo
  const mdView = path => (md.path === path ? md.view : 'source')
  const preview = path => (
    <TextPreview path={path} loadKey={key}
      load={() => getGithubFile(client, repo, { path, ref: branch }).then(f => (f.text == null ? { text: null, note: REASONS[f.reason] ?? REASONS.binary } : { text: f.text }))}
      renderText={isMarkdown(path) && mdView(path) === 'preview' ? text => <div className="nx-gw-fx-md"><MarkdownPreview markdown={text} strict /></div> : null}
      extra={<a href={githubBlobUrl(repo, branch, path)} target="_blank" rel="noopener noreferrer">Open on GitHub</a>} />
  )
  // The branch picker comes first in the path bar, which shows even before a file is picked.
  const head = picked => (
    <PathBar segments={[rootName, ...(picked ? picked.split('/') : [])]}
      lead={branches.length > 0 && onBranch ? (
        <PopoverMenu label={`⑂ ${branch} ▾`} menuLabel="Branches" align="left" buttonClassName="btn sm" buttonProps={{ title: 'Branch' }}
          items={branches.map(b => ({ label: b.name, checked: b.name === branch, onSelect: () => onBranch(b.name) }))} />
      ) : null}>
      {picked && isMarkdown(picked) && (
        <Segmented size="sm" ariaLabel="Source or preview" value={mdView(picked)} onChange={view => setMd({ path: picked, view })}
          options={[{ id: 'source', label: 'Source' }, { id: 'preview', label: 'Preview' }]} />
      )}
    </PathBar>
  )
  const details = picked => (picked
    ? <FilesRail key={picked} repo={repo} client={client} branch={branch} sha={sha} path={picked} openPRs={openPRs} refreshKey={refreshKey} actions={actions} onViewPrs={onViewPrs} fail={setNote} />
    : <div className="nx-gw-crail"><div className="nx-gw-rail-note">Pick a file to see its details.</div></div>)
  return (
    <div className="nx-gw-gh-files" ref={rootRef}>
      {note && <div role="alert" className="nx-alert bad">{note}</div>}
      <FileExplorer label="Files" rootName={repo.split('/').pop() || repo} files={current.files} truncated={current.truncated} error={current.error}
        viewKey={`github:${repo}@${branch}`} menuItems={row => [
          ...(row.kind === 'file' ? actions(row.path).map(({ label, onSelect }) => ({ label, onSelect })) : []),
          // On the branch being looked at, so the shortcut opens what was pinned.
          { label: 'Pin to Dashboard', onSelect: () => pinToHome({ target: 'git', kind: row.kind === 'file' ? 'file' : 'folder', path: `/${row.path}`, branch, repo: { provider: 'github', name: repo.split('/').pop(), fullName: repo } }) },
        ]}
        preview={preview} highlightMatches previewHead={head} rail={details} railLabel="File details" railOpen={rail.open} onRailToggle={rail.toggle} />
    </div>
  )
}
