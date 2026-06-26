// ado-client.js — direct Azure DevOps REST client for the Android app.
// Uses CapacitorHttp (native HTTP, no CORS) on-device; falls back to fetch in browser dev.
import { CapacitorHttp } from '@capacitor/core';
import { getProfileKey } from './profile-keys.js';

// ── Config ────────────────────────────────────────────────────────────────────
const KEYS = {
  get org()           { return getProfileKey('helm.android.org');           },
  get pat()           { return getProfileKey('helm.android.pat');           },
  get projects()      { return getProfileKey('helm.android.projects');      },
  get testProject()   { return getProfileKey('helm.android.testProject');   },
  get uatProject()    { return getProfileKey('helm.android.uatProject');    },
  get uatPipelineId() { return getProfileKey('helm.android.uatPipelineId'); },
  get uatBranch()     { return getProfileKey('helm.android.uatBranch');     },
  get refreshSecs()   { return getProfileKey('helm.android.refreshSecs');   },
};

function getAdoConfig() {
  let projects = [];
  try { projects = JSON.parse(localStorage.getItem(KEYS.projects) || '[]'); } catch (_) {}
  return {
    org:           localStorage.getItem(KEYS.org)           || '',
    pat:           localStorage.getItem(KEYS.pat)           || '',
    projects,
    testProject:   localStorage.getItem(KEYS.testProject)   || '',
    uatProject:    localStorage.getItem(KEYS.uatProject)    || '',
    uatPipelineId: parseInt(localStorage.getItem(KEYS.uatPipelineId) || '0', 10),
    uatBranch:     localStorage.getItem(KEYS.uatBranch)     || 'refs/heads/uat',
    refreshSecs:   parseInt(localStorage.getItem(KEYS.refreshSecs)   || '30', 10),
  };
}

function saveAdoConfig(values) {
  if (values.org          !== undefined) localStorage.setItem(KEYS.org,           values.org);
  if (values.pat          !== undefined) localStorage.setItem(KEYS.pat,           values.pat);
  if (values.projects     !== undefined) localStorage.setItem(KEYS.projects,      JSON.stringify(values.projects));
  if (values.testProject  !== undefined) localStorage.setItem(KEYS.testProject,   values.testProject);
  if (values.uatProject   !== undefined) localStorage.setItem(KEYS.uatProject,    values.uatProject);
  if (values.uatPipelineId!== undefined) localStorage.setItem(KEYS.uatPipelineId, String(values.uatPipelineId));
  if (values.uatBranch    !== undefined) localStorage.setItem(KEYS.uatBranch,     values.uatBranch);
  if (values.refreshSecs  !== undefined) localStorage.setItem(KEYS.refreshSecs,   String(values.refreshSecs));
}

function isAdoConfigured() {
  const c = getAdoConfig();
  return !!(c.org && c.pat && c.projects.length > 0);
}

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
Object.assign(window, { adoGet, adoPost, adoPatch, adoPut, getAdoConfig, saveAdoConfig, isAdoConfigured });

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
        return { ok: resp.status < 400, status: resp.status, json: async () => data }
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

export { adoGet, adoPost, adoPatch, adoPut, getAdoConfig, saveAdoConfig, isAdoConfigured };
