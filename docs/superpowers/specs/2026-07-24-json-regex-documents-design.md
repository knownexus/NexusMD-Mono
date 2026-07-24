# Save/Load Documents for JSON Editor and Regex Tester

## Goals

`MarkdownViewer` (`packages/ui/src/views/MarkdownViewer.jsx`) already has a full multi-document
save/load system: a "Documents (N)" button opens a modal grid of saved documents (new/open/
rename/delete), and typing autosaves into the currently-open document (or silently creates one
~1.5s after you start typing, if none is open) — no explicit "Save" step exists.

This design adds the same *user-facing behavior* to `JsonEditorView`
(`packages/ui/src/views/view-json-editor.jsx`) and `RegexTesterView`
(`packages/ui/src/views/view-regex-tester.jsx`), each with its own independent document list —
JSON documents and saved regexes are not mixed with each other or with Markdown's list.

`MarkdownViewer` itself is **not modified** — its document system keeps working exactly as it
does today. The new capability is built as shared, reusable pieces in `packages/ui` and wired
into the two new consumers, rather than duplicating ~230 lines of modal UI twice or retrofitting
already-shipped, tested code (regression risk not worth taking for this change).

## Scope

**In scope:**
- `packages/ui/src/views/document-store.js` (new) — storage-agnostic pure helpers shared by both
  new consumers:
  - `generateId()` — identical to `MarkdownViewer`'s (timestamp + random suffix).
  - `relativeTime(ts)` — identical to `MarkdownViewer`'s ("just now" / "Nm ago" / "Nh ago" /
    "Nd ago" / locale date beyond a week).
  - `displayName(doc)` — `doc.name ?? doc.autoName`, identical to `MarkdownViewer`'s.
  - `useDocumentAutosave({ content, isEmpty, extractAutoName })` — a hook reproducing
    `MarkdownViewer`'s exact two-timer autosave state machine (300ms debounce to update the
    currently-open doc; 1500ms debounce to silently create a new doc once typing starts with no
    doc open), generalized to work with *any* `content` shape (a string for JSON, a structured
    object for the regex state) rather than assuming a markdown string. Returns
    `{ docs, currentDocId, saveStatus, openDoc(id), newDoc(), deleteDoc(id), renameDoc(id, name) }`.
    Persists the doc list via the existing `usePersisted` hook (profile-scoped storage, matching
    how these two components already persist state) — not raw `localStorage` the way
    `MarkdownViewer` does. This is a deliberate divergence from `MarkdownViewer`'s specific
    storage call, in favor of this codebase's more current pattern; the observable behavior is
    unchanged.
- `packages/ui/src/views/documents-modal.jsx` (new) — a generic `DocumentsModal`, the same
  chrome/interaction model as `MarkdownViewer`'s inline `DocumentsModal` (card grid, rename
  in-place, delete-with-confirm, discard-unsaved-content confirmation when switching away from
  in-progress typing that hasn't autosaved yet), but taking two render props instead of hardcoding
  markdown-specific rendering:
  - `renderPreview(doc)` — the card's thumbnail content.
  - `metaText(doc)` — the small text line under the name (word count for Markdown; something
    else per tool here).
- `packages/ui/src/views/view-json-editor.jsx` (modified) — replace the current single-buffer
  `usePersisted('json_editor_content', ...)` persistence with `useDocumentAutosave`. Add a
  "Documents (N)" button and a "New" button to the toolbar (same placement style as Markdown's).
  `extractAutoName`: if the parsed JSON is an object with a top-level `name` or `title` field
  that's a non-empty string, use it; otherwise fall back to a truncated (~60 char), single-line,
  whitespace-collapsed snippet of the raw text. "New" resets to an empty object `{}`. Note this
  is a deliberate divergence from Markdown's true "always blank" start: `JsonEditorView` already
  ships a demo Alice Johnson sample as its zero-state (before this change, and unrelated to it),
  shown only when there are zero documents and nothing has been typed yet — that existing
  first-load sample is kept as-is; only the explicit "New" action resets to `{}` rather than the
  sample.
- `packages/ui/src/views/view-regex-tester.jsx` (modified) — replace the current single-blob
  `usePersisted('regex_tester_state', ...)` persistence with `useDocumentAutosave`, where a doc's
  `content` is the whole state object (`pattern`, `flags`, `mode`, `testCases`, `tcIndex`,
  `subReplacement`, `unitTests`). Add "Documents (N)" and "New" buttons to the toolbar.
  `extractAutoName`: `/pattern/flags` (e.g. `/(\w+)@([\w.-]+\.[a-z]{2,})/gi`), falling back to
  "Untitled" if the pattern is empty. "New" resets the pattern to empty while keeping the four
  canned example test cases (they're generic scaffolding, not part of a saved document's
  identity).
- Tests for `document-store.js` (pure logic — the autosave hook's state machine, timer behavior,
  and the pure helpers) and updated/new tests for both view components covering: documents button
  shows the right count, opening a doc loads its content, typing autosaves (create-then-update),
  rename/delete, and the "New" reset behavior per tool.

**Out of scope:**
- Any change to `MarkdownViewer` or its existing document system.
- Sharing/merging document lists across tools, or between JSON/Regex and Markdown.
- Wiring into `apps/app` or `apps/web` (not wired there yet regardless — see prior specs).
- An explicit "Save" action — matching the chosen design, everything autosaves the same way
  Markdown does; there is no unsaved state beyond the ~1.5s window before the first autosave.

## Behavior change from today

JSON Editor and Regex Tester currently restore your exact last-typed content verbatim on reload,
via a single continuously-persisted buffer. After this change, reload always starts blank/fresh
(matching Markdown's behavior) — your prior work is reachable via the Documents list once it has
autosaved into a doc (up to ~1.5s after you started typing). This was explicitly chosen over
keeping instant reload-restore, to match Markdown's model exactly.

## Testing

`packages/ui/tests/document-store.test.js` (or `.jsx` if the hook needs a React-rendering test
harness) — the autosave state machine: no doc open + typing creates a new doc after the debounce;
doc open + typing updates it after the shorter debounce; opening a different doc while unsaved
typing is pending; delete/rename correctness; `relativeTime`/`generateId`/`displayName` pure
behavior.

`packages/ui/tests/json-editor.test.jsx` (modified) and `packages/ui/tests/regex-tester.test.jsx`
(modified) — per-tool integration coverage: the Documents button appears and shows the right
count, clicking it opens the modal, opening a saved doc loads its content into the editor,
typing autosaves (verified by opening the Documents modal and seeing the new/updated card), "New"
resets to the tool's defined empty state, rename and delete work.

## Open questions / risks

- None blocking. The main risk is subtly breaking the debounce timing/edge cases from
  `MarkdownViewer`'s autosave state machine while generalizing it into a reusable hook — the
  implementation should port that state machine's logic directly (adapting only the
  string-specific bits: emptiness check and auto-name extraction, both taken as parameters)
  rather than redesigning the timer/ref bookkeeping.
