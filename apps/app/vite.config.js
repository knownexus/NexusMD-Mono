import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev only: forwards the app's Atlassian / Azure DevOps calls from Node, because those hosts send no
// CORS headers to a browser. Only those hosts are allowed. See src/native-http.js.
const ALLOWED = [/.atlassian.net$/, /^dev.azure.com$/, /.visualstudio.com$/];
function devProxy() {
  return {
    name: 'dev-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev-proxy', (req, res) => {
        let raw = '';
        req.on('data', c => { raw += c; });
        req.on('end', async () => {
          const send = (status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
          try {
            const { method = 'GET', url, headers = {}, data } = JSON.parse(raw);
            const u = new URL(url);
            if (u.protocol !== 'https:' || !ALLOWED.some(re => re.test(u.hostname))) return send(403, { error: 'host not allowed' });
            const upstream = await fetch(u, {
              method, headers,
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
