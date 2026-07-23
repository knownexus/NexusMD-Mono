# Documents Page: Regex Tester

## Goals

This is sub-project 2 of integrating `docs/{json-editor,regex-tester,linq-to-sql}.html` into
the app (sub-project 1, the "Documents" page shell plus a full React port of the JSON Editor,
is already merged — see `docs/superpowers/specs/2026-07-23-documents-page-json-editor-design.md`
and `docs/superpowers/plans/2026-07-23-documents-page-json-editor.md`).

This design covers a full React port of `docs/regex-tester.html` as a third tab in the
existing `DocumentsView` shell (`packages/ui/src/views/view-documents.jsx`), themed to the
app rather than the original tool's own fixed dark palette, following the same
centralize-in-`packages/ui` approach as the JSON Editor.

Because `DocumentsView` is already wired into `apps/desktop`'s "Documents" nav entry, **this
sub-project requires no changes to `apps/desktop/src/main.jsx`** — adding a tab to
`DocumentsView`'s `TABS` array is sufficient. `apps/app` and `apps/web` wiring remains out of
scope, same as it was for the JSON Editor.

## Scope

**In scope — ported faithfully from `docs/regex-tester.html`:**
- Match / Substitution mode toggle.
- Flags as toggle chips: `g` (global), `i` (case-insensitive), `m` (multiline), `s` (dotall),
  `u` (unicode).
- A pattern input and a test-string textarea, with a highlight overlay on the test string
  showing each match (and, within the selected match, each capture group in a distinct color),
  plus prev/next match navigation and click-to-select on a match.
- Match info panel: per-match index/length and capture groups (including named groups).
- Test-case presets bar: canned Email/URL/Phone/Dates example strings, switchable, plus
  "add a new named test case."
- Substitution mode: a replacement-pattern input (`$1`, `$&`, `$<name>`, etc.) and a live
  preview of `str.replace(regex, replacement)`.
- Code generation tab: templates for JS, Python, PHP, Go, Java, C#, Ruby, reflecting the
  current pattern/flags, with a copy-to-clipboard button.
- Unit tests tab: add a test string with an expected "should match" / "no match" outcome
  against the current pattern; pass/fail/pending status per test, with a running summary.
- Reference tab: a filterable regex syntax cheat sheet (anchors, character classes,
  quantifiers, groups, lookarounds, special characters, flags, substitution tokens),
  click-to-insert into the pattern input.

**Explicitly dropped from the original (decided during brainstorming):**
- The "Explain this pattern" AI tab. The original calls `https://api.anthropic.com/v1/messages`
  directly from client-side JS with no API key header — it doesn't actually work as shipped,
  and making it work would require a new authenticated backend proxy (a meaningfully bigger,
  security-sensitive piece of scope). Not built. The bottom tab bar has three tabs (Code gen /
  Unit tests / Reference), not four.
- The contentEditable pattern input with live syntax-highlighting-as-you-type (colored
  parens/quantifiers/anchors) and its manual caret-position preservation logic. Replaced with a
  plain monospace `<input>`. This was the highest-implementation-risk piece of the original
  (contentEditable fights React's controlled rendering) for a cosmetic feature; the
  higher-value highlighting — matches and capture groups on the *test string* — is kept.

**Out of scope (separate future work):**
- LINQ-to-SQL tool (separate spec).
- Wiring `DocumentsView` into `apps/app` or `apps/web`.
- Any change to `MarkdownViewer` or `JsonEditorView`.

## File structure

- `packages/ui/src/views/regex-tester-helpers.js` (new) — pure, DOM-free logic, mirroring the
  `json-editor-helpers.js` precedent so it's independently unit-testable without jsdom:
  - `findMatches(pattern, flagsStr, str)` — returns `[{ index, value, groups, indices, named }]`
    or `null` on an invalid pattern; global vs. first-match-only based on whether `flagsStr`
    includes `g`. Mirrors the original's `findMatches`/`bldM`, but as a pure function (no DOM
    writes).
  - `groupHighlightSpans(match)` — given one match's `indices` (from the `d` regex flag),
    returns the sorted, non-overlapping `{ start, end, colorIndex }` spans used to render
    per-group highlight marks within that match's text. Mirrors `renderGroups`'s span logic.
  - `genCode(lang, pattern, flagsStr)` — one of the 7 language template generators (JS, Python,
    PHP, Go, Java, C#, Ruby), each returning a code string. Direct port of `genCode` in the
    original — these are template literals with flag-driven conditionals, no DOM coupling
    already.
  - `runUnitTests(tests, pattern, flagsStr)` — given `[{ str, expectMatch }]` and the current
    pattern/flags, returns the same array with a `result: 'pass' | 'fail' | 'pending'` field
    per test (pending when the pattern is empty/invalid).
  - `REFERENCE_DATA` — the static cheat-sheet data (anchors/character classes/etc.), exported
    as-is from the original's `REF` constant.
- `packages/ui/src/views/view-regex-tester.jsx` (new) — `RegexTesterView`, the React component.
  Imports `Icon`, `usePersisted`, and the helpers above. Styled with the app's CSS variables
  (`--bg`, `--surface`, `--surface-2`, `--border`, `--accent`, `--success`, `--danger`,
  `--warning`, `--mono`, etc. — the same set used by `JsonEditorView`), not the original's own
  `--bg:#0f1117` / `--acc:#818cf8` fixed dark palette. The six group-highlight colors
  (`--g1`..`--g6` in the original) become a small fixed palette of distinct hues layered under
  `--accent-soft`-style translucent backgrounds so they read consistently in both light and
  dark app themes.
- `packages/ui/src/views/view-documents.jsx` (modified) — add
  `{ id: 'regex', label: 'Regex Tester' }` to the `TABS` array and render `<RegexTesterView/>`
  when that tab is active.
- `packages/ui/src/index.js` (modified) — export `RegexTesterView`.

## Persistence

Following the JSON Editor precedent: the current pattern, flags, mode (match/substitution),
active test-case content, substitution replacement string, and unit-test list persist via
`usePersisted` (debounced ~400ms, one storage key e.g. `regex_tester_state` holding a single
JSON blob of all of the above — simpler than one key per field, and matches how a single
`json_editor_content` key was used for the JSON Editor). Falls back to the original's demo
pattern (`(\w+)@([\w.-]+\.[a-z]{2,})`) and the four canned test cases when nothing is stored
yet.

## Testing

`packages/ui/tests/regex-tester-helpers.test.js` — pure logic tests for `findMatches` (global
vs. non-global, capturing/named groups, invalid pattern returns `null`), `groupHighlightSpans`
(overlapping/adjacent group ranges), each `genCode` language variant (spot-check the flag
conditionals, e.g. case-insensitive/multiline mapping to the right language-specific flag
syntax), and `runUnitTests` (pass/fail/pending transitions as the pattern changes).

`packages/ui/tests/regex-tester.test.jsx` — component tests mirroring the JSON Editor's
suite structure: renders the demo pattern and its matches, flag toggling changes match count,
mode switch reveals the substitution panel and preview, test-case switching swaps the test
string, the three bottom tabs render their respective panels, unit test add/pass-fail, and
persistence (edit → debounced write → remount restores state).

`packages/ui/tests/documents-view.test.jsx` (modified) — extend the existing tab-switching
test to cover the third "Regex Tester" tab alongside Markdown and JSON Editor.

## Open questions / risks

- None blocking. As with the JSON Editor, the main risk is scope creep while porting — preserve
  the original's behavior (minus the two explicitly dropped pieces) rather than redesigning it.
