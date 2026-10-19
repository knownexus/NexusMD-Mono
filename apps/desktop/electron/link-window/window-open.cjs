'use strict';

// Build a webContents window-open handler that routes http(s) links (e.g.
// dashboard quick links, which render as <a target="_blank">) into the tabbed
// link window instead of letting Electron open a raw popup. Any window.open is
// denied, with one exception: a blank window named POPOUT_FRAME, which the
// renderer fills itself (the run drawer's "Pop out"). It loads nothing, so it
// can't show a page from anywhere else; allowed URLs are forwarded to openLink.
//
// Pure and dependency-free (no electron import) so it can be unit-tested; the
// isAllowedUrl/openLink implementations are injected from manager.cjs.
// Each drawer names its own window (nexusmd-popout-1, -2, …) so two screens never share one.
const POPOUT_FRAME = 'nexusmd-popout';
const POPOUT_NAME = /^nexusmd-popout(-\d+)?$/;

function createWindowOpenHandler({ isAllowedUrl, openLink, popoutOptions = {} }) {
  return (details) => {
    const url = details && details.url;
    if (details && POPOUT_NAME.test(details.frameName || '') && (url === 'about:blank' || url === '')) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 820, height: 600, minWidth: 420, minHeight: 280, autoHideMenuBar: true, ...popoutOptions } };
    }
    if (url && isAllowedUrl(url)) openLink(url);
    return { action: 'deny' };
  };
}

module.exports = { createWindowOpenHandler, POPOUT_FRAME };
