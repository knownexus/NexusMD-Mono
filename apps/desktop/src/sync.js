// Desktop cloud-sync glue: the shared @nexusmd/ui controller with the encrypted
// secureStorage key cache + scoped getProfileKey (nexusmd.p.<id>.* keys) + DOM
// triggers. The engine lives in the controller.
import { createSyncController } from '@nexusmd/core'
import { domDispatch, domSubscribeForeground, domSubscribeChange } from '@nexusmd/web-adapters'
import { desktopCloudProviders } from './cloud-auth.js'
import { getProfileKey, getActiveProfileId } from './profile-keys.js'
import { secureStorageAdapter } from './adapters/secureStorage.js'

const KEY_ID = 'sync.keyhex'
const keyStore = {
  get: () => secureStorageAdapter.get(KEY_ID),
  set: (hex) => secureStorageAdapter.set(KEY_ID, hex),
  remove: () => secureStorageAdapter.remove(KEY_ID),
}

export const desktopSync = createSyncController({
  storage: localStorage,
  namespace: 'nexusmd',
  getProfileKey,
  getActiveProfileId,
  providers: desktopCloudProviders,
  keyStore,
  deviceIdPrefix: 'desktop',
  dispatch: domDispatch,
  subscribeForeground: domSubscribeForeground,
  subscribeChange: domSubscribeChange,
})

export function startDesktopAutoSync() { desktopSync.startAuto() }
