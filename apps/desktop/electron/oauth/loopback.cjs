'use strict';
const http = require('http');

const DONE_PAGE =
  '<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding-top:3rem">' +
  '<h2>Sign-in complete</h2><p>You can close this tab and return to the app.</p></body></html>';

function startLoopback() {
  return new Promise((resolve) => {
    const server = http.createServer();
    let settle = null;

    server.on('request', (req, res) => {
      const url = new URL(req.url, `http://127.0.0.1`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      // Ignore stray requests (browser preconnect, /favicon.ico, etc.) that
      // carry neither a code nor an error — otherwise one could consume the
      // single-shot settle before the real OAuth redirect arrives.
      if (!code && !error) {
        res.writeHead(204).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(DONE_PAGE);
      if (settle) settle({ code, state: url.searchParams.get('state'), error });
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        port,
        waitForCode({ state, timeoutMs = 300000 }) {
          return new Promise((res, rej) => {
            const timer = setTimeout(() => { settle = null; rej(new Error('OAuth timed out waiting for redirect')); }, timeoutMs);
            settle = ({ code, state: got, error }) => {
              clearTimeout(timer);
              settle = null;
              if (error) return rej(new Error(`OAuth denied: ${error}`));
              if (got !== state) return rej(new Error('OAuth state mismatch'));
              if (!code) return rej(new Error('OAuth redirect missing code'));
              res(code);
            };
          });
        },
        close() { try { server.close(); } catch { /* already closed */ } },
      });
    });
  });
}

module.exports = { startLoopback };
