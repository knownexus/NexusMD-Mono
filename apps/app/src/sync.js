// App cloud-sync glue: the shared @nexusmd/ui controller with the secureStorage
// key cache + scoped getProfileKey (helm.p.<id>.* keys). Foreground trigger uses
// window focus (the Android WebView fires it on resume); change triggers via the
// shared DOM events. The engine lives in the controller.
import { createSyncController, domDispatch, domSubscribeForeground, domSubscribeChange } from '@nexusmd/ui';
import { appCloudProviders } from './cloud-auth.js';
import { getProfileKey, getActiveProfileId } from './profile-keys.js';
import { secureStorageAdapter } from './adapters/secureStorage.js';

const KEY_ID = 'sync.keyhex';
const keyStore = {
  get: () => secureStorageAdapter.get(KEY_ID),
  set: (hex) => secureStorageAdapter.set(KEY_ID, hex),
  remove: () => secureStorageAdapter.remove(KEY_ID),
};

export const appSync = createSyncController({
  storage: localStorage,
  namespace: 'helm',
  getProfileKey,
  getActiveProfileId,
  providers: appCloudProviders,
  keyStore,
  deviceIdPrefix: 'app',
  dispatch: domDispatch,
  subscribeForeground: domSubscribeForeground,
  subscribeChange: domSubscribeChange,
});

export function startAppAutoSync() { appSync.startAuto(); }
