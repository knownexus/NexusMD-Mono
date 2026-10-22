import './profile-migration.js';
import 'flatpickr/dist/flatpickr.min.css';
import '@nexusmd/ui/styles.css';
import './styles/app-overrides.css';
import './styles/helm-mobile.css';

import { initCore, createNoOpAdapters } from '@nexusmd/core';
import {
  localStorageAdapter, networkAdapter, lifecycleAdapter, themeAdapter,
  clipboardAdapter, shareAdapter, notificationAdapter,
} from '@nexusmd/web-adapters';
import { createAdoHttpAdapter } from './ado-client.js';
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
