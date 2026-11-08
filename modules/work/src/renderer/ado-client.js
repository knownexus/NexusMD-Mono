import { makeAdoConfig } from '@nexusmd/core';
import { getProfileKey } from '@nexusmd/shell-sdk';
import { tokenStore } from './token-store.js';

// Raw string storage (ADO values are stored as plain strings, not JSON) under the
// profile-namespaced `ado.*` keys. The read/write logic lives in @nexusmd/core.
const rawStorage = {
  get: (k) => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
  remove: (k) => localStorage.removeItem(k),
};

export const { getAdoConfig, saveAdoConfig, removeAdoConfig, isAdoConfigured, usesAdoWorkItems } = makeAdoConfig({
  storage: rawStorage,
  secrets: tokenStore,
  key: (name) => getProfileKey('ado.' + name),
});

export function createAdoHttpAdapter() {
  return {
    async fetch(path, options = {}) {
      const { org, pat } = getAdoConfig();
      if (!org) throw new Error('ADO org not configured — open Settings first.');
      const url = `https://dev.azure.com/${encodeURIComponent(org)}/${path}`;
      const headers = {
        Authorization: 'Basic ' + btoa(':' + pat),
        Accept: 'application/json',
        ...(options.headers || {}),
      };
      return window.fetch(url, {
        method:  options.method || 'GET',
        headers,
        ...(options.body !== undefined ? { body: options.body } : {}),
      });
    },
  };
}
