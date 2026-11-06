// clicks.js — while a recording runs, a click on a control starts a new top level node ("Clicked Merge") and everything the
// page does in answer to it, in that one event dispatch, is shown under it.
//
// The listener is the first one (capture phase on the window), so it runs before the page's own handlers; it makes the
// click the running frame (packages/trace runtime `hold`), and lets go after the dispatch has finished: at the window's
// bubble listener, which runs last unless a handler stopped the event, and in any case on the next turn of the event loop.

const INTERACTIVE = 'button, a[href], [role="button"], [role="menuitem"], [role="tab"], [role="link"], [role="checkbox"], [role="switch"], [role="option"], input, select, textarea, summary, label[for]';
const NAME_MAX = 80;

const clip = (text) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > NAME_MAX ? `${t.slice(0, NAME_MAX)}…` : t;
};

// The text a person sees in an element: what is marked aria-hidden (a shortcut badge, an icon's title) is left out.
function visibleText(el) {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === 3) out += node.nodeValue;
    else if (node.nodeType === 1 && node.getAttribute('aria-hidden') !== 'true') out += visibleText(node);
  }
  return out;
}

/** What a person would call this control: its label, else its visible text, else its title, else its icon's description. */
export function accessibleName(el) {
  const label = clip(el.getAttribute?.('aria-label'));
  if (label) return label;
  const by = el.getAttribute?.('aria-labelledby');
  if (by) {
    const text = clip(by.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '').join(' '));
    if (text) return text;
  }
  const tag = el.tagName?.toLowerCase() ?? '';
  if (tag === 'input' && /^(?:submit|button|reset)$/i.test(el.getAttribute('type') ?? '')) {
    const value = clip(el.getAttribute('value'));
    if (value) return value;
  }
  const text = clip(visibleText(el));
  if (text) return text;
  return clip(el.getAttribute?.('title')) || clip(el.querySelector?.('img[alt]')?.getAttribute('alt')) || clip(el.getAttribute?.('placeholder')) || tag || 'control';
}

function formName(form, submitter) {
  return clip(form.getAttribute('aria-label')) || clip(form.getAttribute('name')) || (submitter ? accessibleName(submitter) : '') || 'form';
}

/**
 * @param {Document} [doc]
 * @param {() => string} [getPage]  the name of the screen the person is on; a failure here does not stop the click being recorded
 * @returns {() => void} uninstall
 */
export function installClickCapture(doc = document, getPage = () => '') {
  const win = doc.defaultView ?? window;
  let release = null;
  let timer = null;

  const let_go = () => {
    clearTimeout(timer);
    timer = null;
    if (release) { release(); release = null; }
  };

  const page = () => { try { return String(getPage() ?? ''); } catch { return ''; } }; // a page name is nice to have, not worth losing the click

  function begin(name, tag) {
    const runtime = globalThis.__nxt;
    if (!runtime?.on) return;
    let_go();
    const id = runtime.emit('click', { name, page: page(), tag }, null);
    if (!id) return;
    release = runtime.hold(id);
    timer = setTimeout(let_go, 0);
  }

  const onClick = (event) => {
    if (!globalThis.__nxt?.on) return;
    const el = event.target?.closest?.(INTERACTIVE);
    if (el) begin(accessibleName(el), el.tagName.toLowerCase());
  };
  const onSubmit = (event) => {
    if (!globalThis.__nxt?.on) return;
    const form = event.target;
    if (form?.tagName?.toLowerCase() === 'form') begin(formName(form, event.submitter ?? form.querySelector('[type="submit"]')), 'form');
  };

  win.addEventListener('click', onClick, true);
  win.addEventListener('submit', onSubmit, true);
  win.addEventListener('click', let_go);
  win.addEventListener('submit', let_go);
  return () => {
    win.removeEventListener('click', onClick, true);
    win.removeEventListener('submit', onSubmit, true);
    win.removeEventListener('click', let_go);
    win.removeEventListener('submit', let_go);
    let_go();
  };
}
