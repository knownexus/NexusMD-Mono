# Log Viewer Filtering — Design

**Date:** 2026-07-01
**Scope:** Add level filtering, area filtering, and text search to the desktop app's log viewer (`LogsCard`).

## Problem

The desktop log viewer (`apps/desktop/src/logs-card.jsx`) dumps the raw log file into a read-only
`<textarea>`. There is no way to focus on a severity, an area, or find a specific message — you
scroll the whole file. The user wants to filter by log level, filter by area, and search.

## Log format (confirmed against real logs)

electron-log's file transport writes:

```
[YYYY-MM-DD HH:MM:SS.mmm] [level]  [area] message text
```

- The `[level]` token is one of: `error`, `warn`, `info`, `verbose`, `debug`, `silly`.
- The `[area]` tag (e.g. `[updater]`, `[notifications]`) is **optional** — some lines have none.
- **Entries can span multiple lines.** Example: a `[error]` whose message is a 404 error followed
  by a multi-line `Headers: { … }` JSON block. Continuation lines do **not** start with a
  `[timestamp]`.

`logs:read` (IPC) returns the raw file contents as a string. No main-process change is needed.

## Goals

- Filter displayed entries by level (multi-select).
- Filter by area (single-select including a "(no area)" bucket).
- Case-insensitive substring search across message text, continuation lines, and area.
- Keep multi-line entries grouped and readable.

## Non-goals

- Live tailing / auto-refresh of the open log.
- Regex or field-scoped search syntax.
- Changing the on-disk log format or the configured log levels.
- Any main-process / IPC changes.

## Architecture

Two pure, dependency-free renderer modules (matching the existing `zoom.cjs` / `layout.js`
pattern) plus a rewrite of the card body. All parsing/filtering is renderer-side.

### `apps/desktop/src/log-parse.js` (new, pure, unit-tested)

```
parseLog(text: string) -> Entry[]

Entry = {
  id: number,          // stable index within the file (for React keys + expand state)
  ts: string,          // timestamp text as written, e.g. "2026-07-01 13:18:08.111" ("" if none)
  level: string,       // one of the known levels, lowercased; "" if unparsed
  area: string | null, // e.g. "updater"; null when no [area] tag
  message: string,     // first line's message text (after level/area)
  extraLines: string[] // continuation lines belonging to this entry (may be empty)
}

filterEntries(entries: Entry[], opts: { levels: Set<string>|string[], area: string|null, search: string }) -> Entry[]
```

Parsing rules:
- A line matching `^\[<timestamp>\] \[<level>\]` starts a new entry. `<level>` must be one of the
  known levels; the optional `[area]` immediately after the level is captured, the remainder is
  `message`.
- Any line that does not start with `[<timestamp>] [<level>]` is a continuation → pushed to the
  current entry's `extraLines`.
- Text appearing before the first valid header (rare) is collected into a single leading entry with
  `level: ""`, `area: null`, so nothing is silently dropped.

Filtering rules:
- `levels`: entry kept if its `level` is in the set. An entry with `level === ""` (unparsed) is
  kept whenever the set is non-empty (never hidden by level filtering).
- `area`: `null`/"" means all areas; otherwise keep entries whose `area` matches, with the sentinel
  `"(no area)"` matching entries where `area === null`.
- `search`: empty means no search filter; otherwise case-insensitive substring tested against
  `message`, each of `extraLines`, and `area`.
- All three combine with AND.

### `apps/desktop/src/logs-card.jsx` (modified)

- Memoize `parseLog(content)` into `entries` when content changes.
- Derive `availableLevels` (levels present, ordered error→silly) and `availableAreas` (distinct,
  sorted, with "(no area)" if any null) from `entries`.
- Filter state: `activeLevels` (Set, initialized to all available), `areaFilter` (string|null,
  default null = all), `search` (string, default "").
- Reset filter state when the selected date changes (new file → new available levels/areas).
- Render, below the existing date selector:
  - **Level chips** — one per available level, all on initially, click toggles membership.
  - **Area dropdown** — "All areas" + each available area.
  - **Search input** — live, case-insensitive.
  - **Entry list** — replaces the `<textarea>`. Each row: `time · LEVEL · [area] · message`,
    color-coded (error → `--danger`, warn → `--warning`, info/"" → default text, verbose/debug/silly
    → `--text-muted`). Rows with `extraLines` render a ▸ toggle that expands the continuation lines
    (collapsed by default). Monospace font for the body.
  - A count header: "Showing X of Y entries". Empty filtered result shows a friendly message.
- Keep the existing Refresh and Delete controls and the "no logs" empty state.

## Data flow

`logs:read(date)` → raw string → `parseLog` (memoized) → `entries` → `filterEntries(entries, {activeLevels, areaFilter, search})` (memoized) → rendered list.

## Error handling

- `parseLog("")` and `parseLog(null/undefined)` return `[]`.
- Read failures keep the existing behavior (empty content, logged error).
- Malformed/leading text is preserved as an unparsed entry rather than dropped.

## Testing

`apps/desktop/src/log-parse.test.js` (Vitest + jsdom), covering:
- **parseLog:** single-line entry (ts/level/area/message extracted); entry with no area
  (`area === null`); multi-line entry (continuation lines grouped into `extraLines`); leading
  garbage before first header (single unparsed entry); multiple entries in sequence; empty/nullish
  input → `[]`.
- **filterEntries:** level filter keeps only selected levels (and never hides unparsed); area filter
  incl. the "(no area)" sentinel; search matches message, matches a continuation line, matches area,
  is case-insensitive; combined filters AND together; empty search / all-levels / null-area act as
  pass-through.

The card stays thin (rendering + state wiring); all logic under test lives in `log-parse.js`.

## Files touched

- Create: `apps/desktop/src/log-parse.js`
- Create: `apps/desktop/src/log-parse.test.js`
- Modify: `apps/desktop/src/logs-card.jsx`
