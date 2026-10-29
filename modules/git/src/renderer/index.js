import { ViewGit } from './view-git.jsx'
import { GitSettingsCard } from './git-settings-card.jsx'
import { PopoutApp } from './popout-app.jsx'
import { parsePopoutHash } from './popout-spec.js'
import { gitAdapter } from './git-adapter.js'
import { GitTopbar } from './github/github-mode.jsx'

// What the shell gets from the Git Workspace app (see apps/desktop/src/shell/modules.js).
//   adapters      added to the core adapter set before initCore, which is what enables the git module
//   views         view id -> component, rendered as <View adapters={...} />
//   topbar        the Local / GitHub switch, beside the screen's title on Git Workspace
//   settingsCard  rendered in Settings; receives the shell's `picker` adapter
//   popout        the editor / diff / conflict windows: how to read a window's request and render it
export default {
  id: 'git',
  adapters: { git: gitAdapter },
  views: { git: ViewGit },
  topbar: GitTopbar,
  settingsCard: GitSettingsCard,
  popout: { parse: parsePopoutHash, Component: PopoutApp, adapter: gitAdapter },
}
