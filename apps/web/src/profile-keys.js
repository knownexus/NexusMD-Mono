// profile-keys.js — thin platform binding over @nexusmd/core's makeProfileKeys.
//
// This replaces a local copy that had a slice(5) bug: for `nexusmd.`-prefixed keys
// (8 chars) it stripped only 5, leaking an "md." segment into the stored key. Core
// strips the full prefix. profile-migration.js rewrites any pre-existing buggy keys
// (nexusmd.p.{id}.md.* -> nexusmd.p.{id}.*) on boot so no data is orphaned.
//
// bareWhenInactive preserves the legacy "raw key when no active profile" behaviour
// for fresh installs that store prefs before a profile is created.
import { makeProfileKeys } from '@nexusmd/core';

export const { getProfileKey, getActiveProfileId } = makeProfileKeys({
  namespace: 'nexusmd',
  bareWhenInactive: true,
  getActiveId: () => {
    try { return localStorage.getItem('nexusmd.activeProfileId'); } catch (_) { return ''; }
  },
});
