'use strict';
const electron = require('electron');
const defaultLog = require('electron-log');
const defaultConfig = require('../oauth/config.cjs');
const pkce = require('../oauth/pkce.cjs');
const loopback = require('../oauth/loopback.cjs');
const google = require('../oauth/google.cjs');
const { withLogging } = require('./withLogging.cjs');

function register(ipcMain, deps = {}) {
  const {
    config = defaultConfig,
    makePkce = pkce.makePkce,
    startLoopback = loopback.startLoopback,
    buildAuthUrl = google.buildAuthUrl,
    exchangeCode = google.exchangeCode,
    refreshAccessToken = google.refreshAccessToken,
    shell = electron.shell,
    logger = defaultLog,
  } = deps;

  const handle = withLogging(ipcMain, logger);   // inject logger so error logging is testable/pristine
  const olog = logger.scope('oauth');

  handle('oauth:start', async (_e, { provider = 'google' } = {}) => {
    const cfg = config[provider];
    if (!cfg) throw new Error(`unknown oauth provider: ${provider}`);
    const { verifier, challenge, state } = makePkce();
    const loop = await startLoopback();
    const redirectUri = `http://127.0.0.1:${loop.port}`;
    try {
      const authUrl = buildAuthUrl(cfg, { redirectUri, challenge, state });
      olog.info(`starting ${provider} OAuth on ${redirectUri}`);
      await shell.openExternal(authUrl);
      const code = await loop.waitForCode({ state });
      olog.info(`received ${provider} auth code; exchanging for tokens`);
      const tokens = await exchangeCode(cfg, { code, verifier, redirectUri });
      olog.info(`${provider} OAuth complete`);
      return tokens;
    } finally {
      loop.close();
    }
  });

  handle('oauth:refresh', async (_e, { provider = 'google', refreshToken } = {}) => {
    const cfg = config[provider];
    if (!cfg) throw new Error(`unknown oauth provider: ${provider}`);
    if (!refreshToken) return null;
    olog.info(`refreshing ${provider} access token`);
    return refreshAccessToken(cfg, refreshToken);
  });
}

module.exports = { register };
