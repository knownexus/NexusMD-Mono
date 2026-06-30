import { makeAdoConfig } from '@nexusmd/core';
import { getProfileKey } from './profile-keys.js';

// Raw string storage (ADO values are stored as plain strings, not JSON) under the
// profile-namespaced `ado.*` keys. The read/write logic lives in @nexusmd/core.
const rawStorage = {
  get: (k) => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
};

const { getAdoConfig, saveAdoConfig, isAdoConfigured } = makeAdoConfig({
  storage: rawStorage,
  key: (name) => getProfileKey('ado.' + name),
});

async function adoRequest(method, path, body) {
  const { org, pat } = getAdoConfig();
  if (!org) throw new Error('ADO org not configured — open Settings first.');
  const url = `https://dev.azure.com/${encodeURIComponent(org)}/${path}`;
  const isWit = path.includes('/wit/workitems/');
  const contentType = (method !== 'GET' && isWit)
    ? 'application/json-patch+json'
    : 'application/json';

  const headers = {
    Authorization: 'Basic ' + btoa(':' + pat),
    Accept: 'application/json',
    ...(body !== undefined ? { 'Content-Type': contentType } : {}),
  };

  const r = await fetch(url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) throw new Error(`ADO ${r.status}: ${path}`);
  return r.json();
}

export const adoGet   = (path)       => adoRequest('GET',   path, undefined);
export const adoPost  = (path, body) => adoRequest('POST',  path, body);
export const adoPatch = (path, body) => adoRequest('PATCH', path, body);
export const adoPut   = (path, body) => adoRequest('PUT',   path, body);

export { getAdoConfig, saveAdoConfig, isAdoConfigured };

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
