'use strict';
// The window's side of recording: start and stop it, list, read, delete, export and import recordings, take the events
// the windows push while one runs, and tell every window whether one is running (a window records only while told to).
//
// While a recording runs, a window also notes which of its own calls is about to make an IPC call (`trace:ctx`), just
// before it makes it; packages/main-kit/src/trace/link.cjs turns that into "this IPC call came from that window call".

const { moduleLogger, ignore } = require('@nexusmd/main-kit/logging');

const log = moduleLogger('core', 'recordings');

/**
 * @param ipcMain  the shell's (logged) ipcMain
 * @param {{ recorder: object, link: object, dialog: object, getWebContents: () => object[] }} deps
 * @returns {{ sendStateTo(wc: object): void }}  call it for a window that has just finished loading
 */
function register(ipcMain, { recorder, link, dialog, getWebContents }) {
  const stateFor = (wc) => ({ ...recorder.status(), win: wc.id });

  function sendStateTo(wc) {
    try {
      if (wc && !wc.isDestroyed?.()) wc.send('trace:state', stateFor(wc));
    } catch (err) { ignore(log, 'a window could not be told whether a recording is running', err, 'warn'); }
  }

  recorder.onState((status) => {
    if (!status.recording) link.clear();
    for (const wc of getWebContents()) sendStateTo(wc);
  });

  ipcMain.handle('recording:start', async (_e, label) => recorder.start(typeof label === 'string' ? label : ''));
  ipcMain.handle('recording:stop', () => recorder.stop());
  ipcMain.handle('recording:status', () => recorder.status());
  ipcMain.handle('recording:list', async () => recorder.store.list());
  ipcMain.handle('recording:read', (_e, id) => recorder.store.read(id));
  ipcMain.handle('recording:remove', (_e, id) => recorder.store.remove(id));

  ipcMain.handle('recording:export', async (_e, id) => {
    recorder.store.fileOf(id); // refuses an id that is not one before a dialog is shown
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export recording', defaultPath: `${id}.nxrec`, filters: [{ name: 'NexusMD recording', extensions: ['nxrec'] }],
    });
    if (canceled || !filePath) return { saved: false };
    await recorder.store.exportTo(id, filePath);
    return { saved: true, file: filePath };
  });

  ipcMain.handle('recording:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import recording', properties: ['openFile'], filters: [{ name: 'NexusMD recording', extensions: ['nxrec'] }],
    });
    if (canceled || !filePaths?.length) return null;
    return recorder.store.importFrom(filePaths[0]);
  });

  // From the windows. Fire and forget: a window never waits on these.
  ipcMain.on('trace:push', (event, events) => {
    if (recorder.status().recording) recorder.add(events, { win: event?.sender?.id });
  });
  ipcMain.on('trace:ctx', (event, note) => {
    if (!recorder.status().recording || !note || typeof note !== 'object') return;
    link.note(event?.sender?.id, note.channel, note.callId);
  });

  return { sendStateTo };
}

module.exports = { register };
