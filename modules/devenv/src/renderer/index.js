import { DevenvView } from './view-devenv.jsx'
import { DevenvSettingsCard } from './devenv-settings-card.jsx'
import { DevenvProvider } from './provider.jsx'
import { devenvAdapter } from './devenv-adapter.js'

// What the shell gets from the Dev Environment app (see apps/desktop/src/shell/modules.js).
//   adapters      added to the core adapter set before initCore, which is what enables the devenv module
//   views         view id -> component, rendered as <View adapters={...} />
//   settingsCard  rendered in Settings; receives the shell's `picker` adapter
//   provider      wraps the whole shell; receives { adapters, notify, children }
export default {
  id: 'devenv',
  adapters: { devenv: devenvAdapter },
  views: { devenv: DevenvView },
  settingsCard: DevenvSettingsCard,
  provider: DevenvProvider,
}
