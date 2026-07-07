# Design: Right-click "Open in browser" for links

**Date:** 2026-07-07
**Status:** Approved

## Problem

Links in the desktop app (dashboard quick links, ADO/PR/work-item links, etc.)
all open in the in-app tabbed link window. Users sometimes want a link in their
regular system browser instead — to use extensions, a signed-in profile, or
bookmarks. There is currently no way to do this.

## Goal

Add a right-click context menu on links offering the choice to open in the
system browser, alongside the existing in-app behavior and a copy action.

## Key insight

Every link in the UI is a plain `<a target="_blank">` element. The main process
already funnels them centrally: `main.cjs` registers a
`setWindowOpenHandler` (built by `link-window/window-open.cjs`) that denies the
raw popup and routes allowed http(s) URLs into the in-app link window via
`linkWindow.openLink`.

Because of this central funnel, right-click handling can also live in **one
place** — a `context-menu` listener on the main window's `webContents`. Electron
fires this event with a `params` object whose `params.linkURL` holds the href of
the link under the cursor (empty string when the right-click was not on a link).
This covers every `<a>` in every view with **zero changes to the `packages/ui`
package**.

## Behavior

- **Right-click on an http(s) link** → native context menu with three items, in
  this order:
  - **Open link** — opens in the in-app tabbed window (identical to left-click;
    calls `linkWindow.openLink`).
  - **Open in browser** — opens in the system default browser via
    `shell.openExternal`.
  - **Copy link address** — copies the URL via `clipboard.writeText`.
- **Right-click that is not on a valid http(s) link** → no menu is shown
  (unchanged behavior).
- **Left-click** behavior is untouched — links still open in-app.

## Structure

Mirrors the existing `window-open.cjs` pattern: pure logic isolated from
Electron so it can be unit-tested.

### New file: `apps/desktop/electron/link-window/link-context-menu.cjs`

A pure, dependency-free function:

```js
function buildLinkMenuTemplate({ linkURL, isAllowedUrl }) { /* ... */ }
```

- Returns `null` when `linkURL` is falsy or not an allowed http(s) URL
  (`isAllowedUrl(linkURL)` is false).
- Otherwise returns an ordered array of action descriptors:

  ```js
  [
    { label: 'Open link',        action: 'open' },
    { label: 'Open in browser',  action: 'openExternal' },
    { label: 'Copy link address', action: 'copy' },
  ]
  ```

No Electron imports — `isAllowedUrl` is injected by the caller (the same
`linkWindow.isAllowedUrl` used by `window-open.cjs`).

### Wiring in `main.cjs`

Inside `createMainWindow`, after the existing `setWindowOpenHandler` block, add
a `context-menu` listener on `win.webContents`:

- Call `buildLinkMenuTemplate({ linkURL: params.linkURL, isAllowedUrl: linkWindow.isAllowedUrl })`.
- If it returns `null`, do nothing (return).
- Otherwise map each descriptor's `action` to the real Electron call:
  - `'open'` → `linkWindow.openLink(params.linkURL)`
  - `'openExternal'` → `shell.openExternal(params.linkURL)`
  - `'copy'` → `clipboard.writeText(params.linkURL)`
- Build the menu with `Menu.buildFromTemplate(template)` and call
  `menu.popup({ window: win })`.

Reuses the already-imported `Menu` and `shell`; adds `clipboard` to the existing
`require('electron')` destructure.

## Testing

New unit test `apps/desktop/electron/link-window/link-context-menu.test.js`
(mirrors `window-open.test.js`):

- Valid `http:` link → three descriptors, correct labels and actions in order.
- Valid `https:` link → three descriptors.
- Empty `linkURL` → `null`.
- Non-http(s) URL (e.g. `mailto:`, `file:`) with a stub `isAllowedUrl` → `null`.

Run vitest from `apps/desktop` (not repo root), per project convention.

## Out of scope (YAGNI)

- A general text/editable context menu (cut/copy/paste on inputs and text
  selections). Only link right-clicks are handled. Can be added later by
  extending the same `context-menu` listener.
