'use strict';

// Build a webContents window-open handler that routes http(s) links (e.g.
// dashboard quick links, which render as <a target="_blank">) into the tabbed
// link window instead of letting Electron open a raw popup. Any window.open is
// always denied; allowed URLs are additionally forwarded to openLink.
//
// Pure and dependency-free (no electron import) so it can be unit-tested; the
// isAllowedUrl/openLink implementations are injected from manager.cjs.
function createWindowOpenHandler({ isAllowedUrl, openLink }) {
  return (details) => {
    const url = details && details.url;
    if (url && isAllowedUrl(url)) openLink(url);
    return { action: 'deny' };
  };
}

module.exports = { createWindowOpenHandler };
