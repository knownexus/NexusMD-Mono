'use strict';

// Main-process side of the Database app: the connections to SQL Server / SQLite and the queries
// run on them. The shell calls register(ctx) once at startup.
const dbManagerIpc = require('./db-manager.cjs');

function register(ctx) {
  dbManagerIpc.register(ctx.ipcMain);
  return {
    // Closes every open database connection when the app quits.
    dispose: () => dbManagerIpc.closeAll(),
  };
}

module.exports = { register };
