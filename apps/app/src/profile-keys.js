// profile-keys.js — thin platform binding over @nexusmd/core's makeProfileKeys.
// The App keeps its established `helm.` namespace; the key logic lives in core.
//
// `slice('helm.')` is exactly 5 chars so the App never had the Web slice(5) bug;
// bareWhenInactive preserves the legacy "raw key when no active profile" behaviour
// (in practice profile-migration.js always sets an active profile on boot first).
import { makeProfileKeys } from '@nexusmd/core';

export const { getProfileKey, getActiveProfileId } = makeProfileKeys({
  namespace: 'helm',
  bareWhenInactive: true,
  getActiveId: () => {
    try { return localStorage.getItem('helm.activeProfileId'); } catch (_) { return ''; }
  },
});
