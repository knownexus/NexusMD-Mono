# Opened files: JSON to the JSON editor, syntax colours, and Prettify

Date: 2026-11-07. Status: approved in conversation by the product owner; this document is the written form.

## Intent and why

On Android the app can be chosen from "Open with" / Share for text files. Today:

- Markdown goes to Documents (Markdown tool). On the tablet layout this showed an **empty page** (fixed separately, see
  "Already done" below).
- Every other text file, including `.json`, goes to the **Editor**.
- The Editor already knows how to colour several languages, but on Android **nothing is coloured**.

The owner wants: JSON files to open in the JSON editor, opened code files to be coloured, and an optional way to tidy a file's
layout. Colours are always on. Layout changes only ever happen when the person asks.

## Already done (do not redo)

The tablet Markdown fix is in the working tree, uncommitted: `DocumentsView` takes an `opened` count, `MarkdownViewer` takes
`openNewest`, and `app.jsx` passes the count. It is tested on a Galaxy Tab S7 (SM-T870). The JSON work below should follow the
same pattern and must not regress it.

## Goals

1. **JSON to the JSON editor.** A `.json` file opened with the app is added as a saved document in the JSON editor
   (Documents > JSON) and shown, on both the phone and tablet layouts. It is detected the way Markdown is (file name, and the
   type the sender gave: `application/json`).
2. **Broken JSON still goes there.** A `.json` file that does not parse opens in the JSON editor showing its error ("Invalid"
   plus the message) and the raw text, so the person can fix it. It does not fall back to the Editor. (The owner changed their
   mind on this during the conversation; this is the final answer.)
3. **Colours in the Android Editor.** The Editor already maps file extensions to CodeMirror languages
   (`packages/editor-kit/src/languages.js`: C#, JS/JSX, TS/TSX, HTML, CSS/SCSS/LESS, JSON, YAML, SQL, Markdown, PowerShell) and
   applies `classHighlighter`, which only emits `tok-*` class names. Those classes are styled in
   `packages/editor-kit/src/devenv-git.css`, which the Android app never loads, so nothing is coloured. Load the styles in the
   Android app's Editor and check they read well in every theme the app has (light, dark, dim, any custom palette).
   The cause above is from reading the code and one tablet screenshot; confirm it on the device first.
4. **More file types.** Add colouring for XML, shell scripts, Python, Java, C/C++, Go, Rust, PHP, Ruby, TOML and INI (the
   owner's reply was "other types"; this list is the builder's starting point, see Left to the builder).
5. **Prettify.** A button in the Editor that re-indents/tidies the open file, shown only for: JSON, JavaScript (incl. JSX),
   TypeScript (incl. TSX), HTML, CSS (incl. SCSS/LESS), YAML, XML, SQL. No button for C# or anything else.

## Non-goals and anti-goals

- No formatting when a file is opened, saved or shared. A change to the text happens only on a tap of Prettify.
- No C# formatting. There is no trustworthy in-browser C# formatter, and a bad result would mangle someone's code.
- Not a failure-mode: Prettify silently changing meaning (it must refuse on a file with syntax errors and leave the text
  untouched, saying so).
- Not a failure-mode: slowing app start. The formatter code is loaded on first use of Prettify, not at start.
- No changes to how Markdown or other (non-JSON) text files are routed.
- No new file-type registrations in the Android manifest beyond what is needed (see below).

## Constraints

- Existing stack: React, Vite, Capacitor 8, CodeMirror 6. Build on it (`@codemirror/*`, `@codemirror/legacy-modes` are present;
  there is no formatter library today).
- Bundle is already ~2.3 MB; keep additions lazy where large.
- `OpenedFilePlugin.java` reads at most 2 MB, rejects NUL bytes and non-UTF-8, and only accepts `content://` addresses. Keep that.
- The Android manifest filters decide which files the system offers the app for. JSON (`application/json`) and the generic
  `application/octet-stream` + name patterns (`.json`, `.xml`, `.yml`, `.toml`, `.ini`, `.csv`, `.conf`, `.log`) are covered.
  Source code files (`.js`, `.cs`, `.py`, ...) mostly arrive as `text/*` or `application/octet-stream`; adding name patterns for
  the new types is allowed where the system would otherwise not offer the app.
- The Editor module is shared with the desktop app, so the Prettify button will also appear on desktop. That is accepted.
- Tablet = a viewport wider than 600 CSS px; phone = narrower. Both layouts must work. They keep documents under different
  storage keys (phone: the bare key; tablet: a per-profile key via `getProfileKey`), as the Markdown path already handles in
  `app.jsx` / `opened-file.js`.

## How it fits together (existing facts the builder needs)

- Routing is in `apps/app/src/opened-file.js` (`watchOpenedFiles`): Markdown goes to `addOpenedDocument`, everything else to
  `importIntoWorkspace` + `editorStore.openPath`. `app.jsx` receives `onOpen({ target, ... })`, navigates and shows a toast.
- The JSON editor stores documents under the key `json_editor_documents` (tablet: `JsonEditorView` in
  `packages/ui/src/views/view-json-editor.jsx`, through `useDocumentAutosave` in `document-store.js`; phone: `JsonPhone` in
  `apps/app/src/views/json-phone.jsx`, which already resumes the newest document).
- **Known gap to close:** `useDocumentAutosave` starts with no document open and the JSON editor's built-in **sample data**
  as content, and `JsonEditorView` seeds its tree with `parseOr(rawText, SAMPLE)`. Without a change, an opened JSON file would
  not show on the tablet, and a broken one would show the sample tree under an "Invalid" label. Add the same
  "open the newest document" option the Markdown viewer now has, and make a broken opened file show an empty tree plus its
  error, never the sample.
- The JSON editor already shows validity ("Valid JSON" / "Invalid" with the message) and keeps the last valid tree while the
  text is invalid.
- `languageForPath` / `languageExtension` in `languages.js` is the single place that maps names to languages; extend it.
- Prettify output replaces the document text as a normal edit, so the Editor's existing undo works and the file is not written
  until the person saves.

## Left to the builder

- Which formatter libraries to use (Prettier standalone with its plugins is the obvious candidate for JS/TS/HTML/CSS/YAML;
  something small for XML and SQL), and how to lazy-load them.
- Exact extra-language list and which CodeMirror/legacy-mode packages provide them, within the list in Goal 4.
- Where the Prettify button sits on the phone and tablet Editor layouts, and its label.
- Whether the JSON editor's own raw pane also gets colours (not asked; do only if it is nearly free).
- Manifest name patterns for the new types.
- Test approach: unit tests for routing and formatters, and device checks (the tablet is available over adb; files can be opened
  with `am start -a android.intent.action.VIEW -t <type> -d content://media/external/file/<id> --grant-read-uri-permission`).

## Calls made by the author (not stated by the owner)

- Broken-JSON tree shows empty plus the error, not the sample.
- The extra-language list in Goal 4.
- Prettify refuses on files with syntax errors and leaves the text unchanged, with a message.
- Formatters load on first use.
- Prettify appears on desktop too.
- Undo behaviour: Prettify is an ordinary edit.
- JSON with comments or trailing commas (JSONC) counts as invalid JSON: it opens in the JSON editor with the parse error.
  No JSONC support is added.
- Opening the same JSON file twice, unchanged, brings the existing document forward instead of making a copy, as the Markdown
  path already does (`addOpenedDocument`).
- "Syntax error" for Prettify means whatever the chosen formatter reports as a parse failure; the message shown is the
  formatter's, shortened to one line.
- The colour palette per theme is the builder's design; it should reuse the app's existing theme tokens and be readable on
  every theme.
