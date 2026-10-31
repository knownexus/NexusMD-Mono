// native-http.js — the CapacitorHttp.request contract, as one function. On a device it is native
// HTTP (no CORS). In `vite dev` in a desktop browser Atlassian and Azure DevOps refuse
// cross-origin calls, so the request goes through the dev server's /__dev-proxy (vite.config.js).
import { CapacitorHttp } from '@capacitor/core';

const onDevice = () => !!window.Capacitor?.isNativePlatform?.();

async function viaDevProxy(req) {
  const r = await fetch('/__dev-proxy', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!r.ok && r.status === 403) throw new Error('Dev proxy refused that host.');
  return r.json();
}

export const nativeHttp = (req) =>
  (import.meta.env?.DEV && !onDevice() ? viaDevProxy(req) : CapacitorHttp.request(req));
