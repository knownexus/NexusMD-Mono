'use strict';

// Main-process side of the API Client app: runs a request's pre/post scripts in a sandbox,
// either plain ones (api-client-script.cjs) or Bruno-style ones (bruno-runtime.cjs).
const apiClientScriptIpc = require('./api-client-script.cjs');
const brunoRuntimeIpc = require('./bruno-runtime.cjs');

function register(ctx) {
  apiClientScriptIpc.register(ctx.ipcMain);
  brunoRuntimeIpc.register(ctx.ipcMain);
  return {};
}

module.exports = { register };
