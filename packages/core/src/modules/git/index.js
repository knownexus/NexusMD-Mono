// packages/core/src/modules/git/index.js
//
// Git Workspace — local repositories, their worktrees and project groups. Pure logic only;
// git runs in the Electron main process through the desktop-only `git` adapter.

import { registerModule } from '../../features/module-registry.js'

export {
  GIT_AREAS, parseStatus, parseWorktrees, parseBranches, statusCode,
  worktreeId, worktreeName, activeBranchRef, branchLabel,
} from './parse.js'
export { loadSnapshot, applyStatus, worktreeSummary } from './snapshot.js'
export {
  ALL_PROJECTS, findGroup, groupIncludesWorktree, groupIncludesBranch, scopeSnapshot, changeCount,
  uniqueName, groupNameError, renameGroup, duplicateGroup, deleteGroup, registerRepo, unregisterRepo,
} from './groups.js'

export { GroupDraft, GroupSaveError } from './group-draft.js'

let _adapter = null

export function getGitAdapter() {
  return _adapter
}

registerModule({
  id: 'git',
  name: 'Git Workspace',
  // Desktop-only: running git needs the Electron main process.
  requiredAdapters: ['git'],
  defaultEnabled: false,
  init(adapters) {
    _adapter = adapters.git
  },
  async load() {
    return {}
  },
  dispose() {
    _adapter = null
  },
})
