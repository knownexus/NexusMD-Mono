import React from 'react'
import ReactDOM from 'react-dom/client'

import { initCore, createNoOpAdapters } from '@nexusmd/core'
import {
  localStorageAdapter, networkAdapter, lifecycleAdapter, themeAdapter,
  clipboardAdapter, shareAdapter, notificationAdapter,
} from '@nexusmd/web-adapters'
import { createAdoHttpAdapter } from './ado-client.js'
import { webWorkItemSource } from './work-item-source.js'
import { navigationAdapter }    from './adapters/navigation.js'
import { deepLinkAdapter }      from './adapters/deepLink.js'
import { pickerAdapter }        from './adapters/picker.js'
import { secureStorageAdapter } from './adapters/secureStorage.js'
import { fileAdapter }          from './adapters/file.js'
import { NexusDataProvider } from '@nexusmd/ui'
import { NexusMDData, NexusMDApi } from './data.js'
import { nexusMDPushPref } from './components.jsx'
import { GoogleAuth } from './google-auth.js'
import { startWebAutoSync } from './sync.js'
import App from './app.jsx'

initCore({
  ...createNoOpAdapters(),
  storage:       localStorageAdapter,
  http:          createAdoHttpAdapter(),
  network:       networkAdapter,
  lifecycle:     lifecycleAdapter,
  theme:         themeAdapter,
  clipboard:     clipboardAdapter,
  share:         shareAdapter,
  notification:  notificationAdapter,
  navigation:    navigationAdapter,
  deepLink:      deepLinkAdapter,
  picker:        pickerAdapter,
  secureStorage: secureStorageAdapter,
  file:          fileAdapter,
})

// Supplies the shared @nexusmd/ui views with web's data layer. getProfileKey is
// identity because web's persisted keys are already fully namespaced; pushPref
// debounces preference writes to the ASP.NET host (/api/prefs).
const nexusDataValue = {
  data:          NexusMDData,
  api:           NexusMDApi,
  storage:       window.localStorage,
  getProfileKey: (k) => k,
  pushPref:      nexusMDPushPref,
  namespace:     'nexusmd',
  googleAuth:    GoogleAuth,
  workItemSource: webWorkItemSource,
  // Web-only: after a planner week is saved, dispatch a DOM event so the new
  // cloud-sync engine (Task 3) can subscribe to nexusmd:planner-changed.
  plannerOnWeekSaved: (year, week) => document.dispatchEvent(new CustomEvent('nexusmd:planner-changed', { detail: { year, week } })),
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <NexusDataProvider value={nexusDataValue}>
      <App />
    </NexusDataProvider>
  </React.StrictMode>
)

// Start continuous cloud sync (guarded no-op until key + provider are configured).
startWebAutoSync()
