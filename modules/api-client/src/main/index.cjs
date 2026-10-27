'use strict';

// Main-process side of the API Client app: runs a request's pre/post scripts in a sandbox.
const apiClientScriptIpc = require('./api-client-script.cjs');

function register(ctx) {
  apiClientScriptIpc.register(ctx.ipcMain);
  return {};
}

module.exports = { register };
