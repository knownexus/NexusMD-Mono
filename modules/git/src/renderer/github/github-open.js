// Where a file in the GitHub tab can be opened from its preview and its right-click menu.
//
// With a local copy registered in Git Workspace, "Open in Editor" opens that copy's file from disk
// (in the worktree on the branch being browsed when there is one), so it can be edited. Without one,
// the GitHub version opens in a read-only Editor tab (editor.openText, Editor 1.0.1 and later).
// "Open on GitHub" is always there.
import { getGithubFile } from '@nexusmd/core'
import { absolutePath } from '../open-elsewhere.js'

/** The file's page on GitHub at a branch. */
export const githubBlobUrl = (repo, branch, path) =>
  `https://github.com/${repo}/blob/${String(branch).split('/').map(encodeURIComponent).join('/')}/${path.split('/').map(encodeURIComponent).join('/')}`

/** The local worktree to open a file from: the one on `branch`, else the repository's main one. */
export function localTreeFor(trees, branch) {
  return trees.find(t => t.branch === branch) ?? trees.find(t => t.main) ?? trees[0] ?? null
}

/**
 * The actions for one file: [{ label, title?, primary?, onSelect }]. `local` lists the local copy's
 * worktrees ({ path, branch, main }); onSelect may return a promise that rejects with why it failed.
 */
export function githubFileActions({ host, client, repo, branch, local = [], openUrl = url => window.open(url, '_blank', 'noopener,noreferrer') }) {
  const caps = host?.capabilities
  const can = name => !!caps?.has?.(name)
  const tree = localTreeFor(local, branch)
  return path => {
    const actions = []
    if (tree && can('editor.openPath')) {
      const other = tree.branch !== branch
      actions.push({
        label: other ? `Open local copy (${tree.branch})` : 'Open in Editor', primary: true,
        title: other ? `Your local copy is on ${tree.branch}, not ${branch}: ${tree.path}` : `Opens your local copy in ${tree.path}`,
        onSelect: () => caps.call('editor.openPath', absolutePath(tree.path, path)),
      })
    } else if (can('editor.openText')) {
      actions.push({
        label: 'Open in Editor', primary: true, title: `Opens the ${branch} version read-only`,
        onSelect: async () => {
          const file = await getGithubFile(client, repo, { path, ref: branch })
          if (file.text == null) { openUrl(file.url || githubBlobUrl(repo, branch, path)); return }
          caps.call('editor.openText', { id: `github:${repo}@${branch}:${path}`, name: path.split('/').pop(), text: file.text, origin: `${repo} on GitHub, ${branch}: ${path}` })
        },
      })
    }
    actions.push({ label: 'Open on GitHub', onSelect: () => openUrl(githubBlobUrl(repo, branch, path)) })
    return actions
  }
}
