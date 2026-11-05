'use strict';
// Forwards every window's console.* calls into the log, as renderer messages (the shell's console patch only
// covers the main process, and the windows run in their own sandboxed context).
//
// electron-log can do this itself (`log.initialize({ spyRendererConsole: true })`), but it listens to
// 'console-message' with the old (event, level, message, line, sourceId) arguments, which Electron has deprecated:
// it prints a warning on startup and will stop calling them. This listens with the one event object instead.

const LEVELS = { debug: 'debug', info: 'info', warning: 'warn', error: 'error' };

/** Electron's console level name -> the log level (anything unknown is info). */
const levelOf = (level) => LEVELS[level] ?? 'info';

/**
 * @param {{ app: import('node:events').EventEmitter, log: { processMessage: (m: object) => void }, getAllWebContents?: () => object[] }} o
 */
function spyRendererConsole({ app, log, getAllWebContents = () => [] }) {
  const attached = new WeakSet();
  const attach = (wc) => {
    if (!wc || attached.has(wc)) return;
    attached.add(wc);
    wc.on('console-message', (event) => {
      log.processMessage({ data: [event.message], level: levelOf(event.level), variables: { processType: 'renderer' } });
    });
  };
  getAllWebContents().forEach(attach);
  app.on('web-contents-created', (_e, wc) => attach(wc));
}

module.exports = { spyRendererConsole, levelOf };
