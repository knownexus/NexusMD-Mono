// api-http.js — the API client's raw http adapter on Android. Unlike the ADO adapter this sends
// exactly the request it is given, to any host. CapacitorHttp is native HTTP, so there is no CORS.
import { CapacitorHttp } from '@capacitor/core';

const contentTypeOf = (headers = {}) =>
  String(Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] || '');

// CapacitorHttp re-serialises `data` by content type, so a JSON body goes in as an object.
function bodyData(body, headers) {
  if (body === undefined || body === null || body === '') return undefined;
  if (typeof body === 'string' && contentTypeOf(headers).includes('json')) {
    try { return JSON.parse(body); } catch (_) { /* send as text */ }
  }
  return body;
}

export function createApiHttpAdapter({ request = (req) => CapacitorHttp.request(req) } = {}) {
  return {
    async fetch(url, options = {}) {
      const data = bodyData(options.body, options.headers);
      const resp = await request({
        url,
        method: options.method || 'GET',
        headers: options.headers || {},
        responseType: 'text',
        ...(data !== undefined ? { data } : {}),
      });
      const text = typeof resp.data === 'string' ? resp.data : resp.data == null ? '' : JSON.stringify(resp.data);
      return { status: resp.status, statusText: '', headers: resp.headers || {}, text: async () => text };
    },
  };
}

export const apiHttpAdapter = createApiHttpAdapter();
