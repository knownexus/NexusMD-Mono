// sync.js — web cloud-sync glue. Instantiates the shared @nexusmd/ui controller
// with web's localStorage key cache (bare keys via identity getProfileKey),
// OAuth providers, and DOM triggers. The engine lives in the controller.
//
// Key-match: web's NexusDataProvider passes getProfileKey: (k) => k (identity),
// so the five synced collections resolve to the bare keys web actually uses
// (nexusmd.planner.week.*, nexusmd.planner.globalNotes, nexusmd.team.custom,
// nexusmd.team.removed, nexusmd.tweaks).
import { createSyncController } from '@nexusmd/core';
import { domDispatch, domSubscribeForeground, domSubscribeChange } from '@nexusmd/web-adapters';
import { webCloudProviders } from './cloud-auth.js'
import { getActiveProfileId } from './profile-keys.js'

const KEY_CACHE = 'nexusmd.sync.keyhex'
const keyStore = {
  get: async () => localStorage.getItem(KEY_CACHE),
  set: async (hex) => localStorage.setItem(KEY_CACHE, hex),
  remove: async () => localStorage.removeItem(KEY_CACHE),
}

export const webSync = createSyncController({
  storage: localStorage,
  namespace: 'nexusmd',
  getProfileKey: (k) => k, // identity — matches web's NexusDataProvider (bare keys)
  getActiveProfileId,
  providers: webCloudProviders,
  keyStore,
  deviceIdPrefix: 'web',
  dispatch: domDispatch,
  subscribeForeground: domSubscribeForeground,
  subscribeChange: domSubscribeChange,
})

export function startWebAutoSync() { webSync.startAuto() }
export function stopWebAutoSync() { webSync.stopAuto() }
