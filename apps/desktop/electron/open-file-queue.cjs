'use strict';

// macOS tells the app about a file opened with it (double-click, "Open with", dropped on the Dock icon) through Electron's
// 'open-file' event, not on the command line. Windows and Linux put the file in the command line, which the apps already read
// (the Editor's `argv` and `onSecondInstance`). This turns the Mac events into the same two things:
//   take()            the files that arrived before the apps were ready: add them to the command line the app started with
//   listen(fn, exe)   from then on, fn([exe, file]) for each file, as if the app had been launched again with it
function createOpenFileQueue() {
  const early = [];
  let listener = null;
  let exe = '';
  return {
    add(file) {
      if (typeof file !== 'string' || !file) return;
      if (listener) listener([exe, file]);
      else early.push(file);
    },
    take() { return early.splice(0); },
    listen(fn, execPath) { listener = fn; exe = execPath; },
  };
}

module.exports = { createOpenFileQueue };
