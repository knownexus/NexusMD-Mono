'use strict';

// Which screen the main window is on, for the renderer (the Dashboard keeps a layout per screen).
//
//   display:get       → the current display (below)
//   display:changed   ← sent when the window moves to another screen, or that screen's resolution or
//                       scaling changes; only when something the renderer sees has changed
//
// A display is { id, width, height, scaleFactor, physicalWidth, physicalHeight }: width/height are what
// the page lays out in (Windows scaling applied), physical* the screen's real resolution, so a 4K screen
// at 150% is 2560x1440 with physical 3840x2160.
//
// NEXUSMD_E2E_DISPLAY="3840x1600@1" stands in for the real screen (tests can't add a monitor), and then
// globalThis.__nexusmdSetDisplay("1920x1080@1") switches it, as moving to another monitor would.

function describe(d) {
  const scaleFactor = d.scaleFactor || 1;
  const { width, height } = d.size || { width: 0, height: 0 };
  return {
    id: d.id,
    width, height, scaleFactor,
    physicalWidth: Math.round(width * scaleFactor),
    physicalHeight: Math.round(height * scaleFactor),
  };
}

// "3840x1600@1.5" → a display as the screen would report it.
function parseFake(spec) {
  const m = /^(\d+)x(\d+)(?:@([\d.]+))?$/.exec(String(spec || '').trim());
  if (!m) return null;
  const scaleFactor = Number(m[3] || 1) || 1;
  return describe({ id: `e2e:${m[1]}x${m[2]}@${scaleFactor}`, scaleFactor, size: { width: Math.round(m[1] / scaleFactor), height: Math.round(m[2] / scaleFactor) } });
}

const same = (a, b) => !!a && !!b && ['id', 'width', 'height', 'scaleFactor'].every(k => a[k] === b[k]);

function register(ipcMain, { screen, getWindow, env = process.env }) {
  let fake = env.NEXUSMD_E2E_DISPLAY ? parseFake(env.NEXUSMD_E2E_DISPLAY) : null;
  let last = null;

  const current = () => {
    if (fake) return fake;
    const win = getWindow();
    const d = win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
    return describe(d);
  };

  // Sends only a real change; a resize within one screen leaves `last` the same.
  const check = () => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const now = current();
    if (same(now, last)) return;
    last = now;
    win.webContents.send('display:changed', now);
  };

  ipcMain.handle('display:get', () => { last = current(); return last; });

  for (const ev of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(ev, check);

  if (fake) globalThis.__nexusmdSetDisplay = spec => { fake = parseFake(spec) || fake; check(); };

  // Called for each main window the app makes.
  return {
    watch(win) {
      for (const ev of ['moved', 'resize', 'maximize', 'unmaximize']) win.on(ev, check);
    },
  };
}

module.exports = { register, describe, parseFake, same };
