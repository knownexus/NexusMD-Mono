import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev only: forwards the app's Atlassian / Azure DevOps calls from Node, because those hosts send no
// CORS headers to a browser. Only those hosts are allowed. See src/native-http.js.
const hostAllowed = (h) => h === 'dev.azure.com'
  || (h.endsWith('.atlassian.net') && h.length > '.atlassian.net'.length)
  || (h.endsWith('.visualstudio.com') && h.length > '.visualstudio.com'.length);
const MAX_BODY = 1024 * 1024;

function devProxy() {
  return {
    name: 'dev-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev-proxy', (req, res) => {
        const send = (status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
        // Only the app's own page may call this: a POST of JSON (which a foreign page cannot send
        // without a preflight this server never answers), from this server's own origin.
        const host = String(req.headers.host || '');
        const hostName = host.replace(/:\d+$/, '');
        const sameOrigin = req.headers.origin === `http://${host}`;
        if (req.method !== 'POST' || !String(req.headers['content-type'] || '').startsWith('application/json')
          || !sameOrigin || !['localhost', '127.0.0.1', '[::1]'].includes(hostName)) {
          return send(403, { error: 'forbidden' });
        }
        let raw = '';
        req.on('data', c => { raw += c; if (raw.length > MAX_BODY) req.destroy(); });
        req.on('end', async () => {
          try {
            const { method = 'GET', url, headers = {}, data } = JSON.parse(raw);
            const u = new URL(url);
            if (u.protocol !== 'https:' || !hostAllowed(u.hostname.toLowerCase())) return send(403, { error: 'host not allowed' });
            // Redirects are handed back, not followed, so the allowlist can't be sidestepped.
            const upstream = await fetch(u, {
              method, headers, redirect: 'manual',
              ...(data !== undefined ? { body: typeof data === 'string' ? data : JSON.stringify(data) } : {}),
            });
            const text = await upstream.text();
            let parsed = text; try { parsed = JSON.parse(text); } catch {}
            send(200, { status: upstream.status, headers: Object.fromEntries(upstream.headers), data: parsed });
          } catch (e) { send(502, { error: String(e?.message || e) }); }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devProxy()],
  build: { outDir: 'www' },
  server: {
    proxy: {
      '/api': 'http://localhost:5100',
      '/templates': 'http://localhost:5100',
    },
  },
})
