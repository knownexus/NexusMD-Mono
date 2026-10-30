// fatal-error.js — the last resort for a failure before React is on screen, for example the app
// module failing to load or throwing as it evaluates. Plain DOM, no React and no stylesheet, so it
// still works when everything else is what broke.
export function showFatalError(error, root = document.getElementById('root') || document.body) {
  const err = error instanceof Error ? error : new Error(String(error ?? 'Unknown error'));
  console.error('[fatal]', err);

  const box = document.createElement('div');
  box.setAttribute('role', 'alert');
  box.style.cssText = 'box-sizing:border-box;min-height:100vh;padding:20px;font-family:system-ui,sans-serif;background:#fff;color:#111';

  const title = document.createElement('h1');
  title.textContent = 'The app could not start';
  title.style.cssText = 'margin:0 0 12px;font-size:20px';

  const details = document.createElement('pre');
  details.dataset.testid = 'fatal-details';
  details.textContent = `${err.name || 'Error'}: ${err.message || '(no message)'}\n\n${String(err.stack || '').split('\n').slice(0, 12).join('\n')}\n\n${navigator.userAgent}`;
  details.style.cssText = 'margin:0 0 12px;padding:12px;border-radius:8px;background:#eee;font-size:12px;white-space:pre-wrap;overflow:auto;user-select:text';

  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'Reload';
  reload.style.cssText = 'padding:10px 16px;border-radius:8px;border:1px solid #bbb;background:#f4f4f4;font:inherit';
  reload.addEventListener('click', () => window.location.reload());

  box.append(title, details, reload);
  root.replaceChildren(box);
}
