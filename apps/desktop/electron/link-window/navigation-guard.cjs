'use strict';

// A will-navigate handler for the main window: the app moves within itself (a #hash, a query, the dev server's
// own pages) but never to another site, another file or a script, whatever a page, a rendered README or a stray
// link asks for. Other addresses are opened through the tabbed link window (see window-open.cjs), never here.
//
// Pure and dependency-free (no electron import) so it can be unit-tested.
function createNavigationGuard(getCurrentUrl) {
  return (event, url) => {
    const from = getCurrentUrl();
    // An address that can't be read is one the window is not going to.
    if (!URL.canParse(url) || !URL.canParse(from)) {
      event.preventDefault();
      return;
    }
    const target = new URL(url);
    const current = new URL(from);
    const same = target.protocol === current.protocol
      && (target.protocol === 'file:' ? target.pathname === current.pathname : target.origin === current.origin);
    if (!same) event.preventDefault();
  };
}

module.exports = { createNavigationGuard };
