# Opened JSON files, syntax colours and Prettify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `.json` file opened with the Android app lands in the JSON editor (broken ones show their error there), the Android Editor shows syntax colours for more file types, and a Prettify button tidies a file only when tapped.

**Architecture:** Routing stays in `apps/app/src/opened-file.js`; JSON joins Markdown as a "document" target carrying a `tool` field, and the Documents pages (phone and tablet) pick the tool from it. Colours are a small stylesheet moved out of `devenv-git.css` and loaded by the Editor module. Prettify is a lazy-loaded formatter module in `packages/editor-kit` plus an undoable text replacement on `CodeEditor`, surfaced as a button in the Editor's status bar.

**Tech Stack:** React, Vite, Vitest, CodeMirror 6 (`@codemirror/*`, `@codemirror/legacy-modes`), Capacitor 8, new: `prettier`, `sql-formatter`, `xml-formatter`, `@codemirror/lang-php`.

**Spec:** `docs/superpowers/specs/2026-11-07-open-files-json-colours-prettify-design.md`

**Base:** work on a new branch `feat/open-files-json-colours-prettify` created from `fix/tablet-open-markdown` (it carries the tablet fix this plan builds on: `DocumentsView`'s `opened` prop and `MarkdownViewer`'s `openNewest`). Stage only the files each task names; the working tree also holds unrelated `ui_update/` changes that are not ours.

## Global Constraints

- Existing stack only; add libraries only where a task names them. Formatter libraries load on first use (dynamic `import()`), never at app start.
- `OpenedFilePlugin.java` limits stay: `content://` only, at most 2 MB, no NUL bytes, UTF-8 only.
- Tablet = viewport wider than 600 CSS px, phone = narrower. Both must work.
- **Storage formats differ:** Markdown documents are `{"docs":[...]}` under the bare `md_documents` key on phone and `getProfileKey('md_documents')` on tablet. JSON editor documents are a **plain array** under `getProfileKey('json_editor_documents')` on **both** layouts (it goes through `usePersisted`). A document is `{ id, name, autoName, content, createdAt, updatedAt }`.
- Colours always on; layout changes only when Prettify is tapped. No Prettify for C# or anything outside: JSON, JavaScript/JSX, TypeScript/TSX, HTML, CSS/SCSS/LESS, YAML, XML, SQL.
- Prettify must never change a file's meaning: refuse on syntax errors, leave the text untouched, say so in one line.
- The Editor module is shared with desktop; the Prettify button appears there too (accepted).
- Test commands: `npx vitest run <path>` from the package directory (`packages/ui`, `packages/editor-kit`, `modules/editor`, `apps/app`).
- Device: Galaxy Tab S7 over `adb` (use `export MSYS_NO_PATHCONV=1` in Git Bash, Windows paths for `adb install`). Never uninstall the app. Install only with `adb install -r` after the new APK's signing certificate matches the installed one.

## Review Focus

Most likely first. Each has a test in the task named.

1. A file just under the 2 MB open limit is tidied without freezing the app: Prettify refuses above 1,000,000 characters with a message (Task 6).
2. JSON numbers and key order survive Prettify exactly: `12345678901234567890` must not become `12345678901234567000` (Task 6).
3. The person keeps typing while Prettify is working: the tidied result must be dropped, not overwrite the new typing (Task 8).
4. Valid-but-unusual opened JSON works: a BOM at the start, a top-level array, a bare number, an empty file; none may throw or open as broken (Task 2).
5. Upper-case extensions (`.JSON`, `.CS`, `.TS`) route, colour and Prettify the same as lower-case (Tasks 2, 5, 6).

---

### Task 1: The tablet JSON editor opens the newest document

**Files:**
- Modify: `packages/ui/src/views/document-store.js` (`useDocumentAutosave`)
- Modify: `packages/ui/src/views/view-json-editor.jsx` (`JsonEditorView`)
- Test: `packages/ui/tests/document-store.test.jsx`, `packages/ui/tests/documents-view.test.jsx`

**Interfaces:**
- Produces: `useDocumentAutosave({ storageKey, initialContent, emptyContent, isEmpty, extractAutoName, openNewest = false })`. With `openNewest` and at least one saved document, the first render has `content` = the document with the largest `updatedAt` and `currentDocId` = its id. That first render must not be treated as an edit (no rewrite of the document, `updatedAt` unchanged).
- Produces: `JsonEditorView({ openNewest = false })` passes it through. When the opened document is not valid JSON, the tree area shows no keys from the built-in sample and the status shows "Invalid" with the parse message; without `openNewest` the sample seeding is unchanged.

- [ ] **Step 1: Write the failing tests.** In `document-store.test.jsx`: `opens the newest saved document when openNewest is set` (seed two docs with `updatedAt` 1 and 9; expect `content` and `currentDocId` of the second) and `does not rewrite the opened document` (advance fake timers 2000 ms; stored `updatedAt` still 9). In `documents-view.test.jsx`, a `describe('JsonEditorView when a file was opened')` seeding `json_editor_documents` as a plain array through the provider's storage: `shows the newest document, not the sample` (raw textarea value equals the document's content; `Alice Johnson` absent), `a broken document shows Invalid and no sample tree` (content `{ "a": `; `Invalid` present; `Alice Johnson` absent), `without openNewest it still starts on the sample`.
- [ ] **Step 2: Run** `npx vitest run tests/document-store.test.jsx tests/documents-view.test.jsx` in `packages/ui`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the option in `useDocumentAutosave` (compute the newest document once, seed `content`, `currentDocId`, and set `isLoadingDoc.current` true so the first autosave pass is skipped), then `JsonEditorView({ openNewest })`: seed `data` from the opened text, using an empty value instead of `SAMPLE` when it does not parse.
- [ ] **Step 4: Run** the same command plus the whole `packages/ui` suite. Expected: PASS.
- [ ] **Step 5: Commit** `git add packages/ui/src/views/document-store.js packages/ui/src/views/view-json-editor.jsx packages/ui/tests/document-store.test.jsx packages/ui/tests/documents-view.test.jsx` then `git commit -m "fix(ui): the tablet JSON editor can open on the newest saved document"`.

---

### Task 2: Route opened JSON files to the JSON editor's store

**Files:**
- Modify: `apps/app/src/open-text-file.js`, `apps/app/src/opened-file.js`
- Modify: `packages/core/src/` (the module that holds the JSON tree helpers `typeOf`, `setValueAtPath`; export `jsonAutoName` from the package index) , `packages/ui/src/views/view-json-editor.jsx`, `apps/app/src/views/json-phone.jsx` (replace their private copies with the shared one)
- Test: `apps/app/src/open-text-file.test.js`, `apps/app/src/opened-file.test.js`

**Interfaces:**
- Produces: `jsonAutoName(text: string): string` in `@nexusmd/core` (the existing behaviour: top-level `name`/`title` string, else a 60-char one-line snippet, else `'Untitled'`).
- Produces: `isJsonFile({ name, type }): boolean` in `open-text-file.js`: true for type `application/json`, or a name ending `.json`, case-insensitive. `.jsonc` and `.json5` are not JSON files.
- Produces: `addOpenedJsonDocument(storage, file, { now?, id?, key = 'json_editor_documents' }): { id: string, created: boolean }`. Reads the key as a plain array (absent or empty string = `[]`; anything not an array throws the same "could not be read… Nothing has been changed." error the Markdown path throws), strips a leading BOM, turns CRLF/CR into LF, throws the same "too large" error above 2 MB, de-duplicates by identical content and name (bumps `updatedAt`, `created: false`), writes a plain array. It stores the text whether or not it parses.
- Produces: `watchOpenedFiles({ …, storageKey, jsonStorageKey, … })`; `onOpen` receives `{ target: 'documents', tool: 'markdown' | 'json', id, created, name }`. Markdown results gain `tool: 'markdown'`; the `'editor'` result is unchanged. Share the read/normalise/de-duplicate code between the Markdown and JSON adders rather than copying it.

- [ ] **Step 1: Write the failing tests.** `open-text-file.test.js`: `isJsonFile` table (`a.json`, `A.JSON`, `x` with `application/json` are true; `a.jsonc`, `a.json5`, `notes.md`, `a.txt` false); `addOpenedJsonDocument` cases: stores a plain array under `json_editor_documents`; same file twice makes one document with a newer `updatedAt`; a broken file (`{ "a": `) is stored, not rejected; BOM-prefixed `{"a":1}` is stored without the BOM; `[1,2]`, `42` and `''` are stored without throwing and `''` gets `autoName` `'Untitled'`; a stored value that is not an array throws and leaves storage unchanged; over 2 MB throws. `opened-file.test.js`: a `.json` file reaches `onOpen({ target: 'documents', tool: 'json', … })` and is written to `jsonStorageKey`; a `.md` file reaches `tool: 'markdown'`; a `.txt` still reaches the editor target; `.JSON` routes to JSON.
- [ ] **Step 2: Run** `npx vitest run src/open-text-file.test.js src/opened-file.test.js` in `apps/app`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above; in `watchOpenedFiles` test `isMarkdownFile` first, then `isJsonFile`, else the editor.
- [ ] **Step 4: Run** the same command, then `packages/core`, `packages/ui` and `apps/app` suites (the `jsonAutoName` move touches all three). Expected: PASS, apart from failures that already existed before this plan.
- [ ] **Step 5: Commit** the files named above: `git commit -m "feat(app): a JSON file opened with the app is added to the JSON editor's documents"`.

---

### Task 3: Show the right Documents tool, on phone and tablet

**Files:**
- Modify: `apps/app/src/app.jsx` (the `watchOpenedFiles` effect and the `case 'markdown'` render), `packages/ui/src/views/view-documents.jsx`, `apps/app/src/views/documents-phone.jsx`
- Test: `packages/ui/tests/documents-view.test.jsx`, `apps/app/src/views/documents-phone.test.jsx`

**Interfaces:**
- Consumes: Task 1 (`JsonEditorView({ openNewest })`), Task 2 (`onOpen` carries `tool`; `watchOpenedFiles` takes `jsonStorageKey`).
- Produces: `DocumentsView({ opened = 0, openedTool = 'markdown' })` and `DocumentsPhone({ onFlash, opened = 0, openedTool = 'markdown' })`. When `opened` is non-zero they show the tool named by `openedTool` whichever tool was last used; the tablet passes `openNewest={opened > 0}` to the matching tool; the phone's JSON tool already resumes the newest document.
- `app.jsx` keeps `openedTool` state set from `onOpen`, passes `jsonStorageKey: getProfileKey('json_editor_documents')` (both layouts, unlike Markdown), and passes `openedTool` to both pages.

- [ ] **Step 1: Write the failing tests.** Tablet (`documents-view.test.jsx`): `opened={1} openedTool="json"` with the last tab saved as markdown selects the `JSON Editor` tab and shows the seeded document's text; `opened={1}` alone still selects Markdown (the existing tests). Phone (`documents-phone.test.jsx`): after viewing Markdown, `rerender(<DocumentsPhone opened={1} openedTool="json" key={1}/>)` shows the JSON tool with the seeded document; the existing Markdown tests still pass unchanged.
- [ ] **Step 2: Run** `npx vitest run tests/documents-view.test.jsx` in `packages/ui` and `npx vitest run src/views/documents-phone.test.jsx` in `apps/app`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the two page props and the `app.jsx` wiring.
- [ ] **Step 4: Run** both suites in full. Expected: PASS.
- [ ] **Step 5: Device check.** Build (`npx vite build`, `npx cap sync android`, then `./gradlew assembleRelease --no-daemon -Psideload -PversionCode=12 -PversionName=1.4.5-opendev`), compare certificates with `apksigner verify --print-certs -v`, `adb install -r`. Push three files to `/sdcard/Download`, index each with the `MEDIA_SCANNER_SCAN_FILE` broadcast, find each id with `content query --uri content://media/external/file --projection _id:_display_name:mime_type`, open with `am start -a android.intent.action.VIEW -t <type> -d content://media/external/file/<id> --grant-read-uri-permission -n com.knownexus.nexus/.MainActivity`: a valid `.json`, a broken `.json` (`{ "a": `), and the earlier `.md`. Screenshot each. Expected: JSON tab with the text and "Valid JSON"; JSON tab with "Invalid", the text and no sample tree; Markdown unchanged. Remove the pushed files afterwards. Restore generated files (`git checkout -- apps/app/android/capacitor.settings.gradle package-lock.json`) before committing.
- [ ] **Step 6: Commit** `git commit -m "feat(ui): an opened JSON file shows in the JSON tool on the phone and tablet Documents pages"` (files named above only).

---

### Task 4: Syntax colours in the Android Editor

**Files:**
- Create: `packages/editor-kit/src/syntax-colours.css`
- Modify: `packages/editor-kit/src/devenv-git.css` (remove the comment and `.tok-*` rules at the end of the syntax block; add `@import './syntax-colours.css';` as its first line), `modules/editor/src/renderer/editor-app.jsx` (add `import '@nexusmd/editor-kit/syntax-colours.css'` beside `import './editor.css'`)
- Test: `packages/editor-kit/src/syntax-colours.test.js`

**Interfaces:**
- Produces: `syntax-colours.css` holding exactly the existing `.tok-*` rules and their comment, moved unchanged, all colours from theme tokens (`var(--violet)`, `var(--success)`, …). Desktop stays identical because `devenv-git.css` imports it.

- [ ] **Step 1: Confirm the cause first.** With the build from Task 3 installed, open a `.cs` file (push, index, open as in Task 3 Step 5, `-t text/plain`) and screenshot it. Expected: no colours. Do not continue until this is seen; if colours are already there, stop and report.
- [ ] **Step 2: Write the failing test** `syntax-colours.test.js` (reads files as text): `defines the token classes from theme tokens` (for `tok-keyword`, `tok-string`, `tok-number`, `tok-comment`, `tok-typeName`, `tok-propertyName`, `tok-invalid` the file has a rule whose value uses `var(--`), `devenv-git.css imports it and no longer defines the rules itself`, `the Editor module imports it`.
- [ ] **Step 3: Run** `npx vitest run src/syntax-colours.test.js` in `packages/editor-kit`. Expected: FAIL.
- [ ] **Step 4: Implement** the move and the import.
- [ ] **Step 5: Run** the test, then the `packages/editor-kit` and `modules/editor` suites. Expected: PASS.
- [ ] **Step 6: Device check.** Rebuild and install as in Task 3 Step 5 (version code 13), open `.cs`, `.js`, `.html` files, screenshot each. Then, for **every theme** the app offers (`paletteFor` in `app.jsx` lists them; switch in Settings > Appearance), screenshot one file. Expected: keywords, strings, numbers and comments visibly different and readable on each theme's background; if any theme is unreadable, fix the offending token colour in the stylesheet before committing.
- [ ] **Step 7: Commit** the three source files and the test: `git commit -m "fix(editor): the Editor loads its syntax colours, so the Android app colours code"`.

---

### Task 5: More colour languages, and the system offering the app for them

**Files:**
- Modify: `packages/editor-kit/src/languages.js`, `packages/editor-kit/package.json` (add `@codemirror/lang-php`), `apps/app/android/app/src/main/AndroidManifest.xml`
- Test: Create `packages/editor-kit/src/languages.test.js`; modify `apps/app/src/native-contract.test.js`

**Interfaces:**
- Produces additions to `languages.js` (same four exports, behaviour unchanged for existing languages): language names and extensions: `xml` (xml, xsd, xsl, xslt, svg, csproj, props, plist), `shell` (sh, bash, zsh), `python` (py, pyw), `java` (java), `c` (c, h), `cpp` (cpp, cc, cxx, hpp, hh), `go` (go), `rust` (rs), `ruby` (rb), `php` (php), `toml` (toml), `ini` (ini, conf, cfg, properties). Labels: `XML`, `Shell`, `Python`, `Java`, `C`, `C++`, `Go`, `Rust`, `Ruby`, `PHP`, `TOML`, `INI`. Use `@codemirror/legacy-modes` (`xml`, `shell`, `python`, `java`/`c`/`cpp` from `clike`, `go`, `rust`, `ruby`, `toml`, `properties` for INI) via `StreamLanguage.define`, and `php()` from `@codemirror/lang-php`.
- Manifest: add `<data android:pathPattern=".*\\.EXT" />` entries to the existing generic-file (`application/octet-stream`) filter for: `cs csx js mjs jsx ts tsx html htm css scss less py java c h cpp hpp go rs php rb sh sql ps1 cfg properties` (keep existing ones).

- [ ] **Step 1: Write the failing tests.** `languages.test.js`: `maps every extension to its language` (table incl. the existing ones and `A.CS`/`FILE.TS` upper-case), `labels every language`, `gives every language a parser` (`parserFor(name)` non-null), `unknown or missing extensions are plain text` (`readme`, `x.unknownext` → null). `native-contract.test.js`: extend the generic-file extension list the existing test loops over with the new ones.
- [ ] **Step 2: Run** `npx vitest run src/languages.test.js` in `packages/editor-kit` and `npx vitest run src/native-contract.test.js` in `apps/app`. Expected: FAIL.
- [ ] **Step 3: Implement** the language additions (run `npm install` at the repo root for the new dependency) and the manifest patterns.
- [ ] **Step 4: Run** both suites in full. Expected: PASS.
- [ ] **Step 5: Device check.** Rebuild/install (version code 14), open a `.py`, `.go` and `.xml` file, screenshot. Expected: coloured.
- [ ] **Step 6: Commit** `git commit -m "feat(editor): colour XML, shell, Python, Java, C, C++, Go, Rust, Ruby, PHP, TOML and INI, and offer the app for them"` (files above; include `package-lock.json` only for the new dependency).

---

### Task 6: The Prettify engine

**Files:**
- Create: `packages/editor-kit/src/prettify.js`
- Modify: `packages/editor-kit/package.json` (add `prettier`, `sql-formatter`, `xml-formatter`)
- Test: Create `packages/editor-kit/src/prettify.test.js`

**Interfaces:**
- Produces: `canPrettify(path: string): boolean`, true only for: json; js mjs cjs jsx; ts tsx mts cts; html htm; css scss less; yml yaml; xml xsd xsl xslt svg csproj props plist; sql. Extension match is case-insensitive.
- Produces: `prettify(path: string, text: string): Promise<{ ok: true, text: string } | { ok: false, message: string }>`. Prettier (`json`, `babel`, `typescript`, `html`, `css`/`scss`/`less`, `yaml` parsers; standalone build with the matching plugins) with 2-space indent and LF line endings; `sql-formatter` for SQL; `xml-formatter` (2-space indent) for XML. Every formatter is loaded with a dynamic `import()` inside the function. Text over 1,000,000 characters returns `{ ok: false, message: 'This file is too large to tidy here (the limit is 1 MB).' }` without loading anything. A formatter error returns `{ ok: false, message }` where the message is `'Could not tidy: '` plus the first line of the error, cut to 160 characters. A path with no formatter returns `{ ok: false, message: 'This file type cannot be tidied.' }`. An empty file returns `{ ok: true, text: '' }`.

- [ ] **Step 1: Write the failing tests.** Per type, `tidies <type>` (before → exact after) for json (`{"a":1,"b":[1,2]}` → two-space indent), js, ts, html, css, yaml, xml, sql; `keeps JSON numbers exactly` (`{"n":12345678901234567890,"z":1,"a":2}` output contains `12345678901234567890` and key order `n, z, a`); `is idempotent` (tidying the output again returns the same text); `refuses broken input and says why` (`{ "a": ` → `ok: false`, message starts `Could not tidy:`, no `text` field); `refuses C#` (`canPrettify('a.cs')` false; `prettify('a.cs','x')` ok false); `refuses a file over 1,000,000 characters`; `treats upper-case extensions the same` (`A.JSON`, `B.TS`); `does not load formatters at import` (read `prettify.js` as text: no top-level `import … from 'prettier'`, `'sql-formatter'` or `'xml-formatter'`).
- [ ] **Step 2: Run** `npx vitest run src/prettify.test.js` in `packages/editor-kit`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `canPrettify` and `prettify` as specified (`npm install` at the root for the three dependencies).
- [ ] **Step 4: Run** the test, then the `packages/editor-kit` suite. Expected: PASS.
- [ ] **Step 5: Bundle check.** `npx vite build` in `apps/app`. Expected: the main `app-*.js` chunk grows by under 50 KB compared with the last build; the formatters appear as separate chunks.
- [ ] **Step 6: Commit** `git commit -m "feat(editor-kit): a Prettify engine for JSON, JS, TS, HTML, CSS, YAML, XML and SQL, loaded when first used"` (include `package-lock.json`).

---

### Task 7: An undoable text replacement on CodeEditor

**Files:**
- Modify: `packages/editor-kit/src/code-editor.jsx`
- Test: `packages/editor-kit/src/code-editor.test.jsx`

**Interfaces:**
- Produces: `CodeEditor` takes an optional `apiRef` (a React ref). When given, `apiRef.current` is `{ replaceText(text: string): void }`, set while mounted and cleared on unmount. `replaceText` replaces the whole document with a **normal** transaction: it is added to undo history and is reported through `onChange` (it is not the `External` annotation that props-driven replacement uses). The selection is kept, clamped to the new length.

- [ ] **Step 1: Write the failing tests.** `replaceText reports the new text through onChange` (render, `act(() => apiRef.current.replaceText('b'))`, `onChange` called with `'b'`); `replaceText can be undone` (then `undo(EditorView.findFromDOM(container.querySelector('.cm-editor')))` from `@codemirror/commands`; document text is the original and `onChange` is called with it); `apiRef is cleared on unmount`; the existing props-driven replacement tests still pass (it stays out of undo history).
- [ ] **Step 2: Run** `npx vitest run src/code-editor.test.jsx` in `packages/editor-kit`. Expected: FAIL.
- [ ] **Step 3: Implement** `apiRef` in the existing mount effect.
- [ ] **Step 4: Run** the `packages/editor-kit` suite. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(editor-kit): CodeEditor can replace its text as one undoable edit"`.

---

### Task 8: The Prettify button in the Editor

**Files:**
- Modify: `modules/editor/src/renderer/editor-app.jsx` (the editing branch with the `nx-ed-status` bar), `modules/editor/src/renderer/editor.css` if the message needs a rule
- Test: `modules/editor/src/renderer/editor-app.test.jsx`

**Interfaces:**
- Consumes: Task 6 (`canPrettify`, `prettify` from `@nexusmd/editor-kit/prettify.js`), Task 7 (`apiRef` on `CodeEditor`).
- Produces: a `Prettify` button (`btn sm`, label exactly `Prettify`) in the `nx-ed-status` bar before Save, rendered only when `canPrettify(doc.path)` and disabled while the document is loading or saving. On tap: format `doc.text`; if the result equals the text, show `Already tidy` (`role="status"`); if ok, call `apiRef.current.replaceText(result.text)` (which reaches the store through the existing `onChange`, making the file "Unsaved changes" and undoable); if not ok, show the message in a `role="alert"` banner with the existing `nx-ed-banner nx-ed-bad` classes and leave the text alone. A result is dropped (no change, no message) if the document's text changed while it was being formatted. A message clears when the text changes or another tab is activated. Read-only previews have no button.

- [ ] **Step 1: Write the failing tests** (follow the existing patterns in `editor-app.test.jsx`): `shows Prettify for JSON and TypeScript files but not C# or plain text`; `tidying a JSON file replaces its text and marks it unsaved` (`{"a":1}` becomes the indented form; status shows `Unsaved changes`); `a broken file shows the reason and keeps its text` (alert present, store text unchanged); `an already tidy file says so`; `a result is dropped when the text changed meanwhile` (change the store text before the formatter resolves; text keeps the newer typing, no alert); `undo after Prettify restores the previous text`; `upper-case .JSON shows the button`.
- [ ] **Step 2: Run** `npx vitest run src/renderer/editor-app.test.jsx` in `modules/editor`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the button, handler and message in the editing branch.
- [ ] **Step 4: Run** the `modules/editor` suite and the `packages/editor-kit` suite. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(editor): a Prettify button tidies JSON, JS, TS, HTML, CSS, YAML, XML and SQL files when asked"`.

---

### Task 9: Whole-feature check on the tablet, then ship

**Files:** none new.

- [ ] **Step 1: Full tests.** Run `npx vitest run` in `packages/core`, `packages/ui`, `packages/editor-kit`, `modules/editor`, `apps/app`. Expected: every failure also existed before this plan (record the count from a clean checkout of the base branch to compare).
- [ ] **Step 2: Build and install** (version code 15; certificate compare; `adb install -r`).
- [ ] **Step 3: Device matrix.** For each, open the file the way Task 3 Step 5 does and screenshot: `.md` (Documents/Markdown), valid `.json` and broken `.json` (JSON tab), `.js`, `.cs`, `.html`, `.py` (Editor, coloured). In the Editor: tap Prettify on a minified `.json`, a messy `.js` and a messy `.html` (text becomes tidy, status "Unsaved changes", Save writes it), tap it on a broken `.json` (message, text unchanged), confirm there is no Prettify on the `.cs` file, and undo after a Prettify. Expected: all as in the spec.
- [ ] **Step 4: Clean up** the pushed test files and the test documents in the app; restore generated files (`git checkout -- apps/app/android/capacitor.settings.gradle`; keep `package-lock.json` changes only if the new dependencies need them).
- [ ] **Step 5: Push the branch and open a PR** (only if the person asks).
