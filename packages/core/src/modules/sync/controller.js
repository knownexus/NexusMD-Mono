// controller.js — platform-agnostic sync controller. Wraps the Phase 1–4 engine
// (runtime, collections, startAutoSync, singleFlight, local-bundle) behind one
// object each platform instantiates with its own storage, namespace,
// getProfileKey, cloud providers, key store, dispatch and triggers.
import { createSyncRuntime } from './runtime.js';
import { startAutoSync } from './auto.js';
import { singleFlight } from './single-flight.js';
import { exportBundle, importBundle } from './local-bundle.js';
import {
  plannerCollection, notesCollection, teamCustomCollection,
  teamRemovedCollection, tweaksCollection,
} from './collections.js';
import { hashPassword } from '../planner/confidential.js';

export function createSyncController({
  storage, namespace, getProfileKey, getActiveProfileId,
  providers, keyStore, deviceIdPrefix = 'dev',
  dispatch, subscribeForeground, subscribeChange,
  intervalMs = 300000, debounceMs = 5000,
}) {
  const PROVIDER_KEY = `${namespace}.sync.provider`;
  const DEVICE_KEY = `${namespace}.sync.deviceId`;

  const setSyncPassphrase = async (pw) => { await keyStore.set(await hashPassword(pw)); };
  const hasSyncKey = async () => !!(await keyStore.get());
  const clearSyncKey = async () => { await keyStore.remove(); };
  const getKey = async () => keyStore.get();

  const getSyncProvider = () => {
    const id = storage.getItem(PROVIDER_KEY);
    return id ? (providers.find(p => p.id === id) || null) : null;
  };
  const setSyncProvider = (id) => {
    if (id) storage.setItem(PROVIDER_KEY, id); else storage.removeItem(PROVIDER_KEY);
  };

  const getDeviceId = () => {
    let id = storage.getItem(DEVICE_KEY);
    if (!id) { id = `${deviceIdPrefix}-` + Math.random().toString(36).slice(2); storage.setItem(DEVICE_KEY, id); }
    return id;
  };

  const buildCollections = () => {
    const opts = { storage, getProfileKey, namespace };
    return [
      plannerCollection(opts), notesCollection(opts),
      teamCustomCollection(opts), teamRemovedCollection(opts), tweaksCollection(opts),
    ];
  };

  const buildRuntime = (getKeyFn = getKey) => createSyncRuntime({
    storage, getProfileKey, namespace,
    profileId: getActiveProfileId() || 'default',
    cloud: getSyncProvider(), getKey: getKeyFn, deviceId: getDeviceId(),
    collections: buildCollections(),
    onChanged: (collId) => dispatch('nexusmd:sync-applied', { collId }),
  });

  const syncOnce = singleFlight(async () => {
    const key = await keyStore.get(); // read once; reuse for the runtime (one secure-store decrypt)
    if (!key) return { skipped: 'no-key' };
    const provider = getSyncProvider();
    if (!provider) return { skipped: 'no-provider' };
    if (!provider.isConnected()) return { skipped: 'not-connected' };
    try { return await buildRuntime(async () => key).syncNow(); }
    catch (err) { if (err && err.code === 'bad-passphrase') return { skipped: 'bad-passphrase' }; throw err; }
  });

  const exportLocalBundle = () => exportBundle({
    collections: buildCollections(), getKey, profileId: getActiveProfileId() || 'default',
  });
  const importLocalBundle = async (text) => {
    const r = await importBundle({
      collections: buildCollections(), getKey, text,
      onChanged: (collId) => dispatch('nexusmd:sync-applied', { collId }),
    });
    syncOnce().catch(() => {});
    return r;
  };

  let _stop = null;
  const startAuto = () => {
    if (_stop) return;
    _stop = startAutoSync({ syncNow: syncOnce, intervalMs, debounceMs, subscribeForeground, subscribeChange });
  };
  const stopAuto = () => { if (_stop) { _stop(); _stop = null; } };

  return {
    setSyncPassphrase, hasSyncKey, clearSyncKey,
    getSyncProvider, setSyncProvider,
    syncOnce, exportLocalBundle, importLocalBundle,
    getActiveProfileId, startAuto, stopAuto,
  };
}
