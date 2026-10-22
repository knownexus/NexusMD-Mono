import React from 'react'
import { parseAliases, parseShellAliases, parseShellScripts } from '@nexusmd/core'
import { effectiveDotfiles } from '../../git-config.js'
import { useGitConfig } from './use-git-config.js'

/**
 * The command line's aliases for a worktree: git's own, and the DotFiles PowerShell shortcuts and
 * scripts. Returns GitCommandLine's loadAliases, or null when the adapter can read neither.
 */
export function useCommandAliases(adapter, repo, worktreePath, registered) {
  const dotfiles = effectiveDotfiles(useGitConfig())
  const repoPath = repo?.path
  const repoName = repo?.name
  return React.useMemo(() => (worktreePath && (adapter.aliases || adapter.shellAliases) ? async () => {
    const r = { name: repoName, path: repoPath }
    const [git, profile] = await Promise.all([
      adapter.aliases ? adapter.aliases(r, worktreePath, registered).then(parseAliases, () => []) : [],
      adapter.shellAliases && dotfiles ? adapter.shellAliases(dotfiles).catch(() => '') : '',
    ])
    const scripts = adapter.shellRun ? parseShellScripts(profile) : []
    // PowerShell takes seconds to start and load the profile: have it ready before a script is typed.
    if (scripts.length) adapter.shellWarm?.(dotfiles).catch(() => {})
    return { git, shell: parseShellAliases(profile), scripts }
  } : null), [adapter, repoName, repoPath, worktreePath, registered, dotfiles])
}
