import './profile-migration.js';
import 'flatpickr/dist/flatpickr.min.css';

import { initCore, createNoOpAdapters } from '@nexusmd/core';
import { localStorageAdapter }  from './storage-adapter.js';
import { createAdoHttpAdapter } from './ado-client.js';
import { networkAdapter }       from './adapters/network.js';
import { lifecycleAdapter }     from './adapters/lifecycle.js';
import { themeAdapter }         from './adapters/theme.js';
import { clipboardAdapter }     from './adapters/clipboard.js';
import { shareAdapter }         from './adapters/share.js';
import { notificationAdapter }  from './adapters/notification.js';
import { navigationAdapter }    from './adapters/navigation.js';
import { deepLinkAdapter }      from './adapters/deepLink.js';
import { pickerAdapter }        from './adapters/picker.js';
import { secureStorageAdapter } from './adapters/secureStorage.js';
import { authAdapter }          from './adapters/auth.js';
import { badgeAdapter }         from './adapters/badge.js';
import { fileAdapter }          from './adapters/file.js';

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
  auth:          authAdapter,
  badge:         badgeAdapter,
  file:          fileAdapter,
});

import('./app.jsx');
