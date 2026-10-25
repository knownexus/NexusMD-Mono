import { DatabaseApp } from './database-app.jsx'
import { DatabaseConnectionCard } from './database-settings.jsx'
import { dbManagerAdapter } from './db-manager-adapter.js'

// What the shell gets from the Database app (see apps/desktop/src/shell/modules.js).
//   adapters        added to the core adapter set before initCore, which is what enables the db-manager module
//   views           view id -> component, rendered as <View adapters={...} host={...} />
//   settingsPanels  tab id -> panel the app puts into that Settings tab
export default {
  id: 'database',
  adapters: { dbManager: dbManagerAdapter },
  views: { 'db-manager': DatabaseApp },
  settingsPanels: { integrations: DatabaseConnectionCard },
}
