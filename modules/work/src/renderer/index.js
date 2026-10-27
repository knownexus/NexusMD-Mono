import { createAdoHttpAdapter } from './ado-client.js'
import { WorkProvider } from './work-provider.jsx'
import { WorkTopbar, WorkBanner } from './work-slots.jsx'
import { useWorkNavBadges } from './work-store.js'
import {
  DashboardApp, WorkItemsApp, PullRequestsApp, BuildsApp, TestsApp, TeamApp, TriageApp,
} from './work-views.jsx'
import { WorkIntegrationsPanel, WorkBoardPanel, WorkCardsPanel, WorkDataRows } from './work-settings.jsx'
import { WorkScreensCard } from './work-screens-card.jsx'
import { useOffScreens } from './work-screens.js'

// What the shell gets from the Work app (see apps/desktop/src/shell/modules.js).
//   adapters        added to the core adapter set before initCore: `http` is what enables the Azure DevOps modules
//   views           view id -> component, rendered as <View adapters host tweaks setTweak />
//   provider        wraps the whole shell: the data, its refresh, the unseen markers and the drawers
//   topbar, banner  slots in the shell's top bar and under it
//   useNavBadges    { sidebar entry id: count of new items }
//   useOffViews     view ids the user has switched off: the shell leaves them out and won't open them
//   settingsCard    rendered in Settings > Desktop
//   settingsPanels  tab id -> panel (or { Panel, order }) the app puts into that Settings tab; 'data-sync'
//                   panels are rows inside the shell's "Data & sync" card
export default {
  id: 'work',
  adapters: { http: createAdoHttpAdapter() },
  views: {
    dashboard: DashboardApp,
    work: WorkItemsApp,
    prs: PullRequestsApp,
    builds: BuildsApp,
    tests: TestsApp,
    team: TeamApp,
    triage: TriageApp,
  },
  provider: WorkProvider,
  topbar: WorkTopbar,
  banner: WorkBanner,
  useNavBadges: () => useWorkNavBadges(),
  useOffViews: () => useOffScreens(),
  settingsCard: WorkScreensCard,
  settingsPanels: {
    integrations: WorkIntegrationsPanel,
    // After the Planner's own preferences.
    planner: { Panel: WorkBoardPanel, order: 100 },
    cards: WorkCardsPanel,
    'data-sync': WorkDataRows,
  },
}
