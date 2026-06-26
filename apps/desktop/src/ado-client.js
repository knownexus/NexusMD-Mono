import { getProfileKey } from './profile-keys.js';

export function getAdoConfig() {
  let projects = [];
  try { projects = JSON.parse(localStorage.getItem(getProfileKey('ado.projects')) || '[]'); } catch (_) {}
  return {
    org:         localStorage.getItem(getProfileKey('ado.org'))          || '',
    pat:         localStorage.getItem(getProfileKey('ado.pat'))          || '',
    projects,
    testProject: localStorage.getItem(getProfileKey('ado.testProject'))  || '',
    uatBranch:   localStorage.getItem(getProfileKey('ado.uatBranch'))    || 'refs/heads/uat',
    refreshSecs: parseInt(localStorage.getItem(getProfileKey('ado.refreshSecs')) || '30', 10),
  };
}

export function saveAdoConfig(values) {
  if (values.org         !== undefined) localStorage.setItem(getProfileKey('ado.org'),         values.org);
  if (values.pat         !== undefined) localStorage.setItem(getProfileKey('ado.pat'),         values.pat);
  if (values.projects    !== undefined) localStorage.setItem(getProfileKey('ado.projects'),    JSON.stringify(values.projects));
  if (values.testProject !== undefined) localStorage.setItem(getProfileKey('ado.testProject'), values.testProject);
  if (values.uatBranch   !== undefined) localStorage.setItem(getProfileKey('ado.uatBranch'),   values.uatBranch);
  if (values.refreshSecs !== undefined) localStorage.setItem(getProfileKey('ado.refreshSecs'), String(values.refreshSecs));
}

export function isAdoConfigured() {
  const c = getAdoConfig();
  return !!(c.org && c.pat && c.projects.length > 0);
}

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
