// electron/popout.cjs
//
// Git Workspace pop-out windows: a file's editor, a conflict's resolve screen, or a change's diff in
// a window of their own. A pop-out is the app's own page loaded with the request in the URL hash
// ("#popout=<json>"); the renderer shows just that one screen. One window per item: asking for the
// same one again focuses it. When a pop-out writes (a save, a resolve) it says so, and every other
// window is told to read that repository again.
//
// Electron is injected, so this stays unit-testable (see popout.test.js).

'use strict';

const KINDS = ['editor', 'conflict', 'diff'];
const AREAS = ['unstaged', 'staged', 'untracked', 'conflict'];
const TITLES = { editor: 'Edit', conflict: 'Resolve', diff: 'Diff' };
const MAX_PATHS = 500;

const str = v => typeof v === 'string' && v.length > 0 && v.length < 4096 && !v.includes('\0');

// The request as the renderer must send it; anything else is refused. Returns a clean copy.
function validateSpec(spec) {
  const bad = why => { throw new Error(`Can't open that window: ${why}.`); };
  if (!spec || typeof spec !== 'object') bad('no request');
  if (!KINDS.includes(spec.kind)) bad('unknown kind');
  if (!spec.repo || !str(spec.repo.path) || typeof spec.repo.name !== 'string') bad('no repository');
  if (!str(spec.worktree)) bad('no worktree');
  if (!str(spec.path)) bad('no file');
  if (!Array.isArray(spec.registered) || spec.registered.length > MAX_PATHS || !spec.registered.every(str)) bad('no repository list');
  // A change id is "<area>\0<path>", so unlike a path it legitimately holds a NUL.
  if (spec.kind === 'diff' && !(typeof spec.changeId === 'string' && spec.changeId.length > 0 && spec.changeId.length < 4096)) bad('no change');
  return {
    kind: spec.kind,
    repo: { name: spec.repo.name, path: spec.repo.path },
    worktree: spec.worktree,
    path: spec.path,
    registered: [...spec.registered],
    ...(spec.kind === 'diff' ? { changeId: spec.changeId, ...diffChange(spec, bad) } : null),
  };
}

// A diff may carry its change (the status entry) so its window can ask for the diff at once. It must be
// the change the id names; git:diff checks its paths against the worktree again.
function diffChange(spec, bad) {
  const c = spec.change;
  if (c == null) return null;
  const optional = k => c[k] === undefined || str(c[k]);
  if (typeof c !== 'object' || c.id !== spec.changeId || !AREAS.includes(c.area) || !str(c.path) || !['originalPath', 'xy', 'sub'].every(optional)) bad('bad change');
  const change = { id: c.id, area: c.area, path: c.path };
  for (const k of ['originalPath', 'xy', 'sub']) if (c[k] !== undefined) change[k] = c[k];
  return { change };
}

const keyOf = s => [s.kind, s.worktree, s.path, s.changeId ?? ''].join('\0');
const baseName = p => p.split(/[\\/]/).pop();

function createPopouts({ BrowserWindow, dialog, preload, icon, load }) {
  const open = new Map();

  function openWindow(rawSpec) {
    const spec = validateSpec(rawSpec);
    const key = keyOf(spec);
    const existing = open.get(key);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return { reused: true };
    }

    const win = new BrowserWindow({
      width: 1000,
      height: 760,
      minWidth: 480,
      minHeight: 320,
      show: false,
      autoHideMenuBar: true,
      title: `${TITLES[spec.kind]} ${baseName(spec.path)}`,
      icon,
      // A hidden window (the e2e harness) must not have its timers and rendering throttled.
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: process.env.NEXUSMD_HIDDEN !== '1' },
    });
    win.removeMenu();
    open.set(key, win);
    win.on('closed', () => { if (open.get(key) === win) open.delete(key); });
    win.once('ready-to-show', () => { if (process.env.NEXUSMD_HIDDEN !== '1') win.show(); });
    // The page is fixed: it can't navigate away or open windows of its own.
    win.webContents.on('will-navigate', e => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // The renderer blocks unload while it holds unsaved edits; Electron would then refuse to close silently.
    win.webContents.on('will-prevent-unload', e => {
      const choice = dialog.showMessageBoxSync(win, {
        type: 'question', buttons: ['Discard changes', 'Cancel'], defaultId: 1, cancelId: 1,
        title: 'Unsaved changes', message: 'You have unsaved changes.', detail: 'Discard them and close?',
      });
      if (choice === 0) e.preventDefault();
    });
    load(win, `popout=${encodeURIComponent(JSON.stringify(spec))}`);
    return { reused: false };
  }

  // Tells every window but the sender's that a repository changed on disk.
  function changed(sender, repoPath) {
    if (!str(repoPath)) return;
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win.webContents === sender) continue;
      win.webContents.send('popout:changed', repoPath);
    }
  }

  return { open: openWindow, changed, count: () => open.size };
}

module.exports = { createPopouts, validateSpec, keyOf };
