'use strict';
const defaultLog = require('electron-log');

// Returns a handle(channel, fn) that registers fn on ipcMain and logs any
// rejection under logger.scope(channel) before rethrowing to the renderer.
// The logger is injectable (defaults to electron-log) so it can be verified
// in tests without relying on module mocking of the CJS require.
function withLogging(ipcMain, logger = defaultLog) {
  return function handle(channel, fn) {
    ipcMain.handle(channel, async (...args) => {
      try {
        return await fn(...args);
      } catch (err) {
        logger.scope(channel).error(err);
        throw err;
      }
    });
  };
}

module.exports = { withLogging };
