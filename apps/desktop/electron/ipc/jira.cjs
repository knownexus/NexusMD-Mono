'use strict';

// Jira Cloud's REST API sends no CORS headers, so the sandboxed renderer can't
// call it directly (ADO works because dev.azure.com allows CORS). This forwards
// renderer requests, restricted to https://*.atlassian.net/rest/… so it can't be
// used as an open proxy. Credentials come from the renderer, like the ADO PAT.

function isAllowedJiraUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.hostname.endsWith('.atlassian.net') && u.pathname.startsWith('/rest/');
  } catch {
    return false;
  }
}

function register(ipcMain, { fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  ipcMain.handle('jira:request', async (_e, req = {}) => {
    if (!isAllowedJiraUrl(req.url)) {
      return { ok: false, status: 0, headers: {}, body: '', error: 'Blocked: not a Jira Cloud REST URL' };
    }
    const headers = { ...(req.headers || {}) };
    let body = req.body;
    if (req.attachment) {
      const form = new FormData();
      const blob = new Blob([req.attachment.data], { type: req.attachment.type || 'application/octet-stream' });
      form.append('file', blob, req.attachment.name || 'file');
      body = form;
      delete headers['Content-Type'];
    }
    try {
      const res = await fetchImpl(req.url, {
        method: req.method || 'GET',
        headers,
        redirect: 'error',
        ...(body !== undefined ? { body } : {}),
      });
      return {
        ok: res.ok,
        status: res.status,
        headers: { 'retry-after': res.headers.get('retry-after') },
        body: await res.text(),
      };
    } catch (err) {
      return { ok: false, status: 0, headers: {}, body: '', error: err?.message || String(err) };
    }
  });
}

module.exports = { register, isAllowedJiraUrl };
