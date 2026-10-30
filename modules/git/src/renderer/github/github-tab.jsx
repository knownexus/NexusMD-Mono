import React from 'react'
import { githubRepoFromRemote, worktreeId } from '@nexusmd/core'
import { Icon } from '@nexusmd/ui'
import { setGitConfig, getGitConfig, LIST_WIDTH } from '../git-config.js'
import { PaneResizer, usePaneWidth } from '../pane-resizer.jsx'
import { useGithub } from './use-github.js'
import { GithubRepoPane } from './github-repo-pane.jsx'
import { githubFileActions } from './github-open.js'
import { isMainWorktree } from '../branch-header.jsx'

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase()

// Every GitHub repository (owner/name, lowercased) named by a `git remote -v` listing.
export function githubReposInRemotes(text) {
  const found = new Set()
  for (const line of String(text || '').split(/\r?\n/)) {
    const repo = githubRepoFromRemote(line.trim().split(/\s+/)[1])
    if (repo) found.add(repo)
  }
  return found
}

// Which registered repository holds a local copy of each GitHub repository: { 'owner/name': repoName }.
// git runs in each repository's main worktree (or, with none, any usable one) from the snapshot.
function useLocalCopies(adapter, repos, snapshot) {
  const trees = snapshot?.worktrees ?? []
  const where = repos.map(r => {
    const usable = trees.filter(t => t.repo === r.name && !t.prunable && !t.error)
    const tree = usable.find(t => same(worktreeId(t), worktreeId({ path: r.path }))) ?? usable[0]
    return tree ? { name: r.name, repo: { name: r.name, path: tree.repoRoot }, path: tree.path } : null
  }).filter(Boolean)
  const registered = repos.map(r => r.path)
  const key = where.map(w => `${w.name}\0${w.path}`).join('\n') + '\n\n' + registered.join('\n')
  // The config is rebuilt on every write; only `key` says the repositories really changed.
  const registeredRef = React.useRef(registered)
  registeredRef.current = registered
  const [copies, setCopies] = React.useState({})
  React.useEffect(() => {
    if (!adapter?.remotes || !where.length) return undefined
    let live = true
    Promise.all(where.map(w => Promise.resolve().then(() => adapter.remotes(w.repo, w.path, registeredRef.current)).then(text => [w.name, text], () => [w.name, ''])))
      .then(results => {
        if (!live) return
        const next = {}
        for (const [name, text] of results) for (const gh of githubReposInRemotes(text)) next[gh] ??= name
        setCopies(next)
      })
    return () => { live = false }
    // `where` is rebuilt each render; `key` says when it really changed.
  }, [adapter, key]) // eslint-disable-line react-hooks/exhaustive-deps
  return copies
}

/**
 * The GitHub tab: the repositories ticked in Work's GitHub connection down the left, with their
 * open PR and issue counts from Work's cached data, and the chosen one on the right.
 */
export function GithubTab({ host, adapter, config, snapshot, onOpenLocal }) {
  const github = useGithub(host)
  const copies = useLocalCopies(adapter, config.repos, snapshot)
  // Refresh in this tab: added to Work's refreshKey, so every pane and the branch picker reload.
  const [reloads, setReloads] = React.useState(0)
  // The repository list shares its width with the branch list on Local.
  const list = usePaneWidth('listWidth', LIST_WIDTH)
  const bodyRef = React.useRef(null)
  if (!github) return null
  const { repos, cached, client } = github
  const refreshKey = github.refreshKey + reloads
  // Work's drawers, when Work still offers them. Work's cached copy carries more than the list
  // endpoint gives (reviews, +/−, linked items), so it is opened in place of the mapped row.
  const call = (name, value) => { const caps = host?.capabilities; if (caps?.has?.(name)) caps.call(name, value) }
  const cachedCopy = (list, item) => (list ?? []).find(c => same(c.id, item?.id)) ?? item
  const openPR = pr => call('work.openPR', cachedCopy(cached.prs, pr))
  const openItem = item => call('work.openItem', cachedCopy(cached.issues, item))
  // A Work too old to open builds: the run's page on GitHub instead.
  const openBuild = build => {
    if (host?.capabilities?.has?.('work.openBuild')) call('work.openBuild', cachedCopy(cached.builds, build))
    else if (build?.url) window.open(build.url, '_blank', 'noopener,noreferrer')
  }
  const chosen = repos.find(r => same(r, config.view.githubRepo)) ?? repos[0]
  const choose = repo => setGitConfig({ view: { ...getGitConfig().view, githubRepo: repo } })
  const prsOf = repo => (cached.prs ?? []).filter(p => same(p.repo, repo))
  // Work also keeps issues closed in the last few days; the counts are of open ones, as the list is.
  const issuesOf = repo => (cached.issues ?? []).filter(i => same(i.projectKey, repo) && i.state !== 'Closed')
  const chosenLocal = copies[String(chosen).toLowerCase()]
  // The local copy's worktrees, for opening a GitHub file from disk (see github-open.js).
  const localTrees = chosenLocal
    ? (snapshot?.worktrees ?? []).filter(t => t.repo === chosenLocal && !t.prunable && !t.error).map(t => ({ path: t.path, branch: t.branch, main: isMainWorktree(t) }))
    : []
  const fileActionsFor = branch => githubFileActions({ host, client, repo: chosen, branch, local: localTrees })
  const counts = { prs: prsOf(chosen).length, issues: issuesOf(chosen).length }
  return (
    <div className="nx-gw-body" data-list="github" ref={bodyRef} style={{ '--gw-list': `${list.width}px` }}>
      <nav aria-label="GitHub" className="nx-gw-aside">
        <ul aria-label="GitHub repositories" className="nx-gw-list">
          {repos.map(repo => {
            const local = copies[repo.toLowerCase()]
            const cut = repo.indexOf('/') + 1
            const prs = prsOf(repo).length
            return (
              <li key={repo} aria-label={repo} className="nx-gw-gh-repo">
                <button type="button" className="nx-gw-row" aria-current={repo === chosen ? 'true' : undefined} onClick={() => choose(repo)}
                  aria-label={`${repo}, ${plural(prs, 'open PR', 'open PRs')}, ${plural(issuesOf(repo).length, 'issue', 'issues')}`}>
                  <span className="nx-gw-dot" data-tone={prs ? 'info' : 'muted'} />
                  <span className="nx-gw-row-body">
                    <span className="nx-gw-row-title"><span className="nx-gw-gh-owner">{repo.slice(0, cut)}</span>{repo.slice(cut)}</span>
                    <span className="nx-gw-row-meta">
                      <span>{plural(prs, 'open PR', 'open PRs')}</span>
                      <span>{plural(issuesOf(repo).length, 'issue', 'issues')}</span>
                    </span>
                  </span>
                </button>
                {local && (
                  <button type="button" className="nx-gw-gh-local" aria-label={`Open local copy (${local})`} title={`Show ${local} in Registered repos`} onClick={() => onOpenLocal(local)}>
                    <Icon name="folder" size={12} />Local
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </nav>
      <PaneResizer label="Resize repository list" width={list.width} fallback={LIST_WIDTH} boxRef={bodyRef} onDrag={list.onDrag} onDone={list.onDone} />
      <section aria-label="GitHub repository" className="nx-gw-main">
        <header className="nx-gw-dhead">
          <div className="nx-gw-dhead-title">
            <div className="nx-gw-dhead-branch"><h3 className="nx-gw-branch-name">{chosen}</h3></div>
            <div className="nx-gw-dhead-meta">
              <span>{plural(counts.prs, 'open pull request', 'open pull requests')}</span>
              <span>{plural(counts.issues, 'open issue', 'open issues')}</span>
              {chosenLocal && <span>{`Local copy in ${chosenLocal}`}</span>}
            </div>
          </div>
          <div className="nx-gw-dhead-actions">
            {chosenLocal && <button type="button" className="btn sm ghost" onClick={() => onOpenLocal(chosenLocal)}>Open local copy</button>}
            <button type="button" className="btn sm ghost" aria-label="Refresh" title="Read this repository from GitHub again" onClick={() => setReloads(n => n + 1)}>
              <Icon name="refresh" size={12} />Refresh
            </button>
            <a className="btn sm" href={`https://github.com/${chosen}`} target="_blank" rel="noopener noreferrer"><Icon name="link" size={12} />Open on GitHub</a>
          </div>
        </header>
        <GithubRepoPane key={chosen} repo={chosen} client={client} refreshKey={refreshKey} openPR={openPR} openItem={openItem} openBuild={openBuild}
          openPRs={prsOf(chosen)} counts={counts} fileActionsFor={fileActionsFor} />
      </section>
    </div>
  )
}
