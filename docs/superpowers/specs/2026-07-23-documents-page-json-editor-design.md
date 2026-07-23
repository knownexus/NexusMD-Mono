# Documents Page Shell + JSON Editor

## Goals

Three standalone developer-tool HTML files were dropped in `docs/` (`json-editor.html`,
`regex-tester.html`, `linq-to-sql.html`) — each a fully self-contained page (own CSS/JS, no
build step) with no local asset dependencies beyond a couple of CDN font/icon links. The goal
is to integrate these into the app as first-class pages, as full React ports matching the app's
own theme (not iframe embeds), with logic centralized in `packages/ui` and shared across
`apps/desktop`, `apps/app`, `apps/web` rather than duplicated per app.

This is sub-project 1 of a larger effort. Scope here:

1. A shared "Documents" page shell with a tool tab bar, hosting the existing Markdown tool
   alongside new tools as they're ported.
2. A full React port of `docs/json-editor.html` as the first new tool.
3. Wiring into `apps/desktop` only (it already has a nav entry labeled "Documents").

Regex Tester and LINQ-to-SQL, and wiring into `apps/app`/`apps/web`, are separate follow-up
specs — each tool is independent and this keeps any one PR reviewable.

## Scope

**In scope:**
- `packages/ui/src/views/view-documents.jsx` — new `DocumentsView` component: a tab bar
  (currently just `Markdown` | `JSON Editor`) plus the active tool's content area. The Markdown
  tab renders the existing `MarkdownViewer` unchanged. Active tab persisted to localStorage
  (own key, e.g. `documents_active_tab`) so it survives reload, consistent with how other
  per-view UI state (cheat sheet open, learn mode) already persists in this codebase.
- `packages/ui/src/views/view-json-editor.jsx` — new `JsonEditorView` component: full React
  port of `docs/json-editor.html`. See "JSON Editor port" below.
- `packages/ui/src/icons.jsx` — add the handful of icons the port needs that don't already
  exist (undo, redo, expand, collapse/shrink, copy, download, upload, format/wand,
  sidebar-collapse-left, sidebar-collapse-right), following the existing `case 'name': return
  (<svg ...>)` pattern. No new external icon dependency.
- `packages/ui/src/index.js` — export `DocumentsView` and `JsonEditorView`.
- `apps/desktop/src/main.jsx` — `case 'markdown': return <MarkdownViewer />` becomes
  `case 'markdown': return <DocumentsView />`. Import `DocumentsView` instead of (or alongside)
  `MarkdownViewer` from `@nexusmd/ui`. No changes to `apps/desktop/src/nav-config.js` — the
  `markdown` nav id is already labeled "Documents".
- `packages/ui/tests/json-editor.test.jsx` — new test file, see "Testing" below.
- `docs/json-editor.html` is left in place as-is (reference/source-of-truth for the original
  tool's behavior); it is not deleted or wired into any build.

**Out of scope:**
- Regex Tester and LINQ-to-SQL tools (separate specs).
- Wiring `DocumentsView` into `apps/app` or `apps/web` (separate spec) — both currently render
  `MarkdownViewer` directly under a nav tab labeled "Markdown"; that's unchanged for now.
- Renaming the `apps/app`/`apps/web` "Markdown" nav label to "Documents" (would happen alongside
  their wiring spec, not before).
- Any change to `MarkdownViewer` itself.

## JSON Editor port

`JsonEditorView` reproduces `docs/json-editor.html`'s feature set as React state/components
instead of imperative DOM manipulation:

- **Layout**: split-pane — tree/visual editor (left) and raw JSON textarea (right) — with a
  draggable resizer (mouse-move drag, min widths preserved) and independent collapse/hide per
  panel, matching the original's `togglePanel`/resizer behavior.
- **Tree view**: recursive node rendering with expand/collapse per path (collapsed paths tracked
  in a `Set`), type-colored value pills (string/number/boolean/null), container summaries
  (`{ N fields }` / `[ N items ]`), double-click inline editing for primitive leaf values,
  an add/edit modal for any node covering all six JSON types, delete-with-confirm, and a path
  breadcrumb bar reflecting the currently selected node.
- **Raw editor**: a plain textarea kept in sync with the tree (edits in either pane propagate to
  the other), a valid/invalid JSON badge, and an inline error message on parse failure.
- **Toolbar**: undo/redo backed by a history stack (array of JSON-stringified snapshots + index,
  same approach as the original), expand-all/collapse-all, a search box that highlights matches
  in keys/values, open-from-file, copy-to-clipboard, download-as-file, and keyboard shortcuts
  (Ctrl/Cmd+Z undo, Ctrl/Cmd+Y or Shift+Z redo, Ctrl/Cmd+S download, Escape closes modal, Enter
  submits modal).
- **Theming**: styled with the app's existing CSS custom properties (`--bg`, `--surface`,
  `--border`, `--accent`, `--text`, etc. — same set `MarkdownViewer` and `ApiClientView` already
  use) instead of the tool's own hardcoded light palette, so it follows the app's light/dark
  theme automatically.
- **Icons**: uses the shared `Icon` component (`packages/ui/src/icons.jsx`) instead of the
  Tabler icon webfont CDN link the original pulls in.
- **Bug fix while porting**: the original's modal save path reads
  `document.getElementById('mVal')`, an element that doesn't exist in the modal's HTML (the real
  fields are `mValString`/`mValNumber`/etc.) — saving a string or number field via the modal
  throws a `TypeError` in the original tool. The React port drives the modal from component
  state directly (`{ type, value }`), so there's no DOM-id mismatch to reproduce; this is a
  straightforward-loss bug fix, not a behavior change worth flagging to the user at runtime.
- **Persistence**: current JSON content is persisted to localStorage (own key, e.g.
  `json_editor_content`) and restored on load, debounced the same way `MarkdownViewer`'s
  auto-save is (so typing doesn't thrash localStorage on every keystroke). Falls back to the
  original tool's `SAMPLE` JSON object when there's nothing stored yet. Undo/redo history itself
  is NOT persisted (resets each session) — only the current content is.

## Testing

New `packages/ui/tests/json-editor.test.jsx`, run from `packages/ui` (this repo's vitest suites
for `apps/*` and `packages/ui` must be run from their own package directory, not repo root, due
to a workspace/jsdom config gap). Covers:
- Initial render shows the sample JSON in both tree and raw panes.
- Editing a value inline (double-click a primitive) updates both panes and pushes history.
- Add/edit/delete via the modal for each of the six JSON types.
- Raw-editor edits with valid JSON sync to the tree; invalid JSON shows the error state and
  badge without touching the tree.
- Undo/redo restores prior states and correctly disables at history bounds.
- Search highlights matching keys/values in the tree.
- Content persists to localStorage and is restored on remount; a fresh instance with no stored
  content falls back to the sample JSON.

`view-documents.jsx` gets light coverage in the same file or a small
`packages/ui/tests/documents-view.test.jsx`: tab switching renders the right tool, and the
active tab persists across remount.

## Open questions / risks

- None blocking. The main risk is scope creep while porting ~1,150 lines of imperative JS to
  React — the port should preserve behavior exactly (modulo the `mVal` bug fix) rather than
  taking the opportunity to redesign the tool's UX.
