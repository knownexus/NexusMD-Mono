import React from 'react'
import ReactDOM from 'react-dom/client'

import { initCore, createNoOpAdapters } from '@nexusmd/core'
import { localStorageAdapter }  from './storage-adapter.js'
import { createAdoHttpAdapter } from './ado-client.js'
import { networkAdapter }       from './adapters/network.js'
import { lifecycleAdapter }     from './adapters/lifecycle.js'
import { themeAdapter }         from './adapters/theme.js'
import { clipboardAdapter }     from './adapters/clipboard.js'
import { shareAdapter }         from './adapters/share.js'
import { notificationAdapter }  from './adapters/notification.js'
import { navigationAdapter }    from './adapters/navigation.js'
import { deepLinkAdapter }      from './adapters/deepLink.js'
import { pickerAdapter }        from './adapters/picker.js'
import { secureStorageAdapter } from './adapters/secureStorage.js'
import { fileAdapter }          from './adapters/file.js'
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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
