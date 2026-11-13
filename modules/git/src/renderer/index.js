import { ViewGit } from './view-git.jsx'
import { GitSettingsCard } from './git-settings-card.jsx'
import { PopoutApp } from './popout-app.jsx'
import { parsePopoutHash } from './popout-spec.js'
import { gitAdapter } from './git-adapter.js'
import { GitTopbar } from './github/github-mode.jsx'
import { getGitConfig } from './git-config.js'
import { listLocalRepos, requestOpen } from './shortcut-open.js'

// What the shell gets from the Git Workspace app (see apps/desktop/src/shell/modules.js).
//   adapters      added to the core adapter set before initCore, which is what enables the git module
//   views         view id -> component, rendered as <View adapters={...} />
//   topbar        the Local / GitHub switch, beside the screen's title on Git Workspace
//   settingsCard  rendered in Settings; receives the shell's `picker` adapter
//   popout        the editor / diff / conflict windows: how to read a window's request and render it
//   activate      registers what this app offers other apps (for the Dashboard's File-or-folder shortcuts, see shortcut-open.js):
//                   git.listRepos()     the registered repositories as { name, path, provider: 'local', remote }
//                   git.openPath(spec)  show a file or folder in Git Workspace; spec is
//                                       { repoPath?, githubRepo?, branch?, path, kind: 'file' | 'folder' }
export default {
  id: 'git',
  adapters: { git: gitAdapter },
  views: { git: ViewGit },
  topbar: GitTopbar,
  settingsCard: GitSettingsCard,
  popout: { parse: parsePopoutHash, Component: PopoutApp, adapter: gitAdapter },
  activate(host) {
    host.capabilities.provide('git.listRepos', () => listLocalRepos(gitAdapter, getGitConfig().repos))
    host.capabilities.provide('git.openPath', spec => {
      requestOpen(spec)
      host.navigate('git')
      return true
    })
  },
}
