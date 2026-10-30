// ado-client.js — direct Azure DevOps REST client for the Android app.
// Uses CapacitorHttp (native HTTP, no CORS) on-device; falls back to fetch in browser dev.
import { CapacitorHttp } from '@capacitor/core';
import { makeAdoConfig } from '@nexusmd/core';
import { getProfileKey } from './profile-keys.js';

// ── Config ────────────────────────────────────────────────────────────────────
// Read/write logic lives in @nexusmd/core; the app keeps its `helm.android.*` key
// scheme (via getProfileKey) and raw-string localStorage.
const rawStorage = {
  get: (k) => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
};

const { getAdoConfig, saveAdoConfig, isAdoConfigured, usesAdoWorkItems } = makeAdoConfig({
  storage: rawStorage,
  key: (name) => getProfileKey('helm.android.' + name),
});

// ── HTTP ──────────────────────────────────────────────────────────────────────
function authHeader(pat) {
  return 'Basic ' + btoa(':' + pat);
}

async function adoRequest(method, path, body) {
  const { org, pat } = getAdoConfig();
  if (!org) throw new Error('ADO org not configured — open Settings first.');
  const url = `https://dev.azure.com/${encodeURIComponent(org)}/${path}`;
  const isWit = path.includes('/wit/workitems/');
  const contentType = (method !== 'GET' && isWit)
    ? 'application/json-patch+json'
    : 'application/json';

  const headers = {
    Authorization: authHeader(pat),
    Accept: 'application/json',
    ...(body !== undefined ? { 'Content-Type': contentType } : {}),
  };

  let resp;
  // CapacitorHttp.request is available on-device; fall back to fetch in browser.
  if (CapacitorHttp?.request) {
    resp = await CapacitorHttp.request({
      method,
      url,
      headers,
      // Explicitly stringify so arrays serialise correctly on all Android targets.
      ...(body !== undefined ? { data: JSON.stringify(body) } : {}),
    });
    if (resp.status >= 400) throw new Error(`ADO ${resp.status}: ${path}`);
    if (typeof resp.data === 'string') {
      try { return JSON.parse(resp.data); } catch (_) { return resp.data; }
    }
    return resp.data;
  } else {
    const r = await fetch(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!r.ok) throw new Error(`ADO ${r.status}: ${path}`);
    return r.json();
  }
}

const adoGet   = (path)       => adoRequest('GET',   path, undefined);
const adoPost  = (path, body) => adoRequest('POST',  path, body);
const adoPatch = (path, body) => adoRequest('PATCH', path, body);
const adoPut   = (path, body) => adoRequest('PUT',   path, body);

// Expose on window so JSX files (non-module globals) can call them directly.
Object.assign(window, { adoGet, adoPost, adoPatch, adoPut, getAdoConfig, saveAdoConfig, isAdoConfigured, usesAdoWorkItems });

export function createAdoHttpAdapter() {
  return {
    async fetch(path, options = {}) {
      const { org, pat } = getAdoConfig()
      if (!org) throw new Error('ADO org not configured — open Settings first.')
      const url = `https://dev.azure.com/${encodeURIComponent(org)}/${path}`
      const method = options.method || 'GET'
      const headers = {
        Authorization: 'Basic ' + btoa(':' + pat),
        Accept: 'application/json',
        ...(options.headers || {}),
      }

      if (CapacitorHttp?.request) {
        const resp = await CapacitorHttp.request({
          method, url, headers,
          ...(options.body !== undefined ? { data: options.body } : {}),
        })
        const data = typeof resp.data === 'string'
          ? (() => { try { return JSON.parse(resp.data) } catch { return resp.data } })()
          : resp.data
        return {
          ok: resp.status < 400, status: resp.status, json: async () => data,
          text: async () => (typeof data === 'string' ? data : JSON.stringify(data, null, 2)),
        }
      } else {
        const r = await window.fetch(url, {
          method, headers,
          ...(options.body !== undefined ? { body: options.body } : {}),
        })
        return r
      }
    },
  }
}

export { adoGet, adoPost, adoPatch, adoPut, getAdoConfig, saveAdoConfig, isAdoConfigured, usesAdoWorkItems };
