import React from 'react'
import { githubRepoFromRemote, worktreeId } from '@nexusmd/core'
import { setGitConfig, getGitConfig } from '../git-config.js'
import { useGithub } from './use-github.js'

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
  const registered = React.useMemo(() => repos.map(r => r.path), [repos])
  const trees = snapshot?.worktrees ?? []
  const where = repos.map(r => {
    const usable = trees.filter(t => t.repo === r.name && !t.prunable && !t.error)
    const tree = usable.find(t => same(worktreeId(t), worktreeId({ path: r.path }))) ?? usable[0]
    return tree ? { name: r.name, repo: { name: r.name, path: tree.repoRoot }, path: tree.path } : null
  }).filter(Boolean)
  const key = where.map(w => `${w.name}\0${w.path}`).join('\n')
  const [copies, setCopies] = React.useState({})
  React.useEffect(() => {
    if (!adapter?.remotes || !where.length) return undefined
    let live = true
    Promise.all(where.map(w => Promise.resolve().then(() => adapter.remotes(w.repo, w.path, registered)).then(text => [w.name, text], () => [w.name, ''])))
      .then(results => {
        if (!live) return
        const next = {}
        for (const [name, text] of results) for (const gh of githubReposInRemotes(text)) next[gh] ??= name
        setCopies(next)
      })
    return () => { live = false }
    // `where` is rebuilt each render; `key` says when it really changed.
  }, [adapter, key, registered]) // eslint-disable-line react-hooks/exhaustive-deps
  return copies
}

/**
 * The GitHub tab: the repositories ticked in Work's GitHub connection down the left, with their
 * open PR and issue counts from Work's cached data, and the chosen one on the right.
 */
export function GithubTab({ host, adapter, config, snapshot, onOpenLocal }) {
  const github = useGithub(host)
  const copies = useLocalCopies(adapter, config.repos, snapshot)
  if (!github) return null
  const { repos, cached } = github
  const chosen = repos.find(r => same(r, config.view.githubRepo)) ?? repos[0]
  const choose = repo => setGitConfig({ view: { ...getGitConfig().view, githubRepo: repo } })
  const prs = repo => (cached.prs ?? []).filter(p => same(p.repo, repo)).length
  const issues = repo => (cached.issues ?? []).filter(i => same(i.projectKey, repo)).length
  return (
    <div className="nx-gw-body" data-list="github">
      <nav aria-label="GitHub" className="nx-gw-aside">
        <ul aria-label="GitHub repositories" className="nx-gw-list nx-gw-gh-list">
          {repos.map(repo => {
            const local = copies[repo.toLowerCase()]
            return (
              <li key={repo} aria-label={repo}>
                <button type="button" className="nx-gw-row" aria-current={repo === chosen ? 'true' : undefined} onClick={() => choose(repo)}>
                  <span className="nx-gw-dot" data-tone="info" />
                  <span className="nx-gw-row-body">
                    <span className="nx-gw-row-title">{repo}</span>
                    <span className="nx-gw-row-meta"><span>{`${plural(prs(repo), 'PR', 'PRs')} · ${plural(issues(repo), 'issue', 'issues')}`}</span></span>
                  </span>
                </button>
                {local && (
                  <button type="button" className="btn sm ghost nx-gw-gh-local" title={`Show ${local} in Registered repos`} onClick={() => onOpenLocal(local)}>Open local copy</button>
                )}
              </li>
            )
          })}
        </ul>
      </nav>
      <aside aria-label="GitHub repository" className="nx-gw-main">
        <div className="nx-gw-gh-head">
          <h3 className="nx-gw-gh-title">{chosen}</h3>
          <span className="nx-gw-spacer" />
          <a className="btn sm ghost" href={`https://github.com/${chosen}`} target="_blank" rel="noopener noreferrer">Open on GitHub</a>
        </div>
        <div className="nx-empty" style={{ padding: 16 }}>This repository&apos;s pull requests, issues, branches, history and files will show here.</div>
      </aside>
    </div>
  )
}
