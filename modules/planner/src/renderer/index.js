import { PlannerApp } from './planner-app.jsx'
import { DesktopPlannerPrefsCard, DesktopConfidentialCard } from './planner-settings.jsx'
import { plannerStore } from './planner-store.js'

// What the shell gets from the Planner app (see apps/desktop/src/shell/modules.js).
//   views           view id -> component, rendered as <View adapters={...} host={...} />
//   settingsPanels  tab id -> panel the app puts into that Settings tab
//   activate        registers what this app offers other apps:
//                     planner.updateData(fn)   change the week data being shown, like setState
//                                              (e.g. the Dashboard's Quick note)
export default {
  id: 'planner',
  views: { planner: PlannerApp },
  settingsPanels: { planner: DesktopPlannerPrefsCard, confidential: DesktopConfidentialCard },
  activate(host) {
    host.capabilities.provide('planner.updateData', updater => plannerStore.setData(updater))
  },
}
