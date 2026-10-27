'use strict';

// Main-process side of the Work app: the Jira proxy. Jira Cloud sends no CORS headers, so the
// renderer's requests go through the main process (see jira.cjs for what it will and won't forward).
const jiraIpc = require('./jira.cjs');

function register(ctx) {
  jiraIpc.register(ctx.ipcMain);
  return {};
}

module.exports = { register };
