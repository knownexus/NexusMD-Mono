'use strict';

// Build a context-menu template for a right-clicked link. Returns an ordered
// list of action descriptors ({ label, action }) for http(s) links, or null
// when the right-click was not on an allowed link (so no menu is shown).
//
// Pure and dependency-free (no electron import) so it can be unit-tested; the
// isAllowedUrl implementation is injected from manager.cjs, and main.cjs maps
// each descriptor's `action` to the real Electron call.
function buildLinkMenuTemplate({ linkURL, isAllowedUrl } = {}) {
  if (!linkURL || !isAllowedUrl(linkURL)) return null;
  return [
    { label: 'Open link', action: 'open' },
    { label: 'Open in browser', action: 'openExternal' },
    { label: 'Copy link address', action: 'copy' },
  ];
}

module.exports = { buildLinkMenuTemplate };
