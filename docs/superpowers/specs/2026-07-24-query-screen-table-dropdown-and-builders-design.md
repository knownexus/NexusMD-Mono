# Query Screen: Table Dropdown & Guided Query Builders

## Summary

The Database Manager screen (`ViewDbManager.jsx`) currently lists tables as a
column of buttons in the sidebar, and its Query tab shows only a plain
read-only text hint of table names above a free-text SQL textarea. This
change replaces the table list (both in the sidebar and the Query tab) with
a dropdown, has selecting a table in the Query tab auto-populate a starting
`SELECT * FROM <table>` query, and adds a row of command buttons (Search,
Insert, Update, Delete, Join, Aggregate) that open small inline forms to
build the corresponding SQL and insert it into the query textarea.

## Background / Current State

- Tables render as `<button className="db-table-btn">` elements in a
  sidebar nav (`ViewDbManager.jsx` ~lines 332–346), sourced from
  `session.tables` (a `string[]` set on connect).
- The Query tab (`QueryPanel`, ~line 785) has a `<textarea>` bound to
  `sqlQuery`, with a static `Tables: {tables.join(', ')}` text hint — not
  interactive.
- No column/schema metadata is available anywhere in the app today. The
  Electron IPC layer (`apps/desktop/electron/ipc/db-manager.cjs`) can list
  table names (`INFORMATION_SCHEMA.TABLES` / `sqlite_master`) but has no
  handler to fetch column names/types for a table. Columns are currently
  only ever discovered as a side effect of running a query against a table
  (`recordsetToRows`), which returns nothing for empty tables.
- `handleRunQuery` restricts free-text SQL to `ALLOWED = ['SELECT', 'WITH',
  'DELETE']`. Writes (`INSERT`/`UPDATE`) currently only happen through
  separate structured handlers (`handleUpdateCell`, table-driven, not raw
  SQL) — raw INSERT/UPDATE text is rejected.

## Goals

1. Replace the sidebar table-button list and the Query tab's static table
   hint with a single reusable dropdown component, sourced from the
   existing `session.tables`.
2. Selecting a table in the Query tab dropdown sets/replaces the textarea
   content with `SELECT * FROM <table>`.
3. Add command buttons — Search, Insert, Update, Delete, Join, Aggregate —
   to the Query tab that open a small guided form to build the
   corresponding SQL statement and insert it into the textarea.
4. Guided forms need real column metadata, so add a `getColumns` IPC
   handler and wire it through the existing adapter-injection path.
5. Widen the `ALLOWED` statement list in `handleRunQuery` to permit
   `INSERT` and `UPDATE` so Insert/Update-builder-generated SQL is
   actually runnable, without weakening identifier validation.

## Non-Goals

- No changes to the Browse tab's row-level edit/delete UI (`handleUpdateCell`
  / `handleDeleteRows` structured paths are untouched).
- No general-purpose visual SQL/ER diagram builder — the guided forms cover
  only the six listed statement shapes.
- No support for compound queries (nested joins with 3+ tables, subqueries,
  window functions) in the builders. Users can still hand-edit the
  generated SQL in the textarea for anything more advanced.
- No changes to authentication/connection handling.

## Architecture & Data Flow

**New IPC handler** — `getColumns(type, config, table)` in
`db-manager.cjs`, following the existing pattern of `handleConnect` /
`handleGetRows`:
- SQL Server: `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = @table ORDER BY ORDINAL_POSITION`, plus a lookup
  against `INFORMATION_SCHEMA.KEY_COLUMN_USAGE` (joined to
  `TABLE_CONSTRAINTS` where `CONSTRAINT_TYPE = 'PRIMARY KEY'`) to flag
  `isPrimaryKey`.
- SQLite: `PRAGMA table_info("table")`, mapping `name`/`type`/`pk` columns
  directly.
- Returns `{ ok: true, columns: [{ name, dataType, isPrimaryKey }] }`.
- `table` goes through the same `validateIdentifier` guard already used by
  `handleGetRows` before being interpolated.
- Exposed through `apps/desktop/electron/preload.cjs` →
  `apps/desktop/src/adapters/db-manager.js` → `packages/core` module, same
  chain as the existing `connect`/`getRows` calls.

**Widened write guardrail** — `ALLOWED` in `handleRunQuery` becomes
`['SELECT', 'WITH', 'DELETE', 'INSERT', 'UPDATE']`. This does not change
how SQL text reaches the DB driver (still a single parameterless
`pool.request().query(sql)` / `db.prepare(sql)`, matching today's
behavior for SELECT/DELETE) — it only changes which statement *keywords*
are allowed through the prefix check. Builder-generated INSERT/UPDATE
statements only ever reference table/column names drawn from
`getColumns`/`session.tables` (never arbitrary user text), keeping the
injection surface unchanged from today's DELETE/SELECT path. Hand-typed
INSERT/UPDATE through the textarea becomes possible too, same as
hand-typed DELETE is possible today — this is an accepted, explicit
widening of what the free-text query box can execute.

**Renderer state** (`ViewDbManager.jsx`):
- `tableColumns: { [tableName]: Column[] }` — lazily populated cache, one
  fetch per table the first time any builder needs it (not prefetched for
  all tables).
- `activeBuilder: 'search' | 'insert' | 'update' | 'delete' | 'join' |
  'aggregate' | null` — which inline panel is open; only one at a time.

**Flow:** connect → `session.tables` populates the dropdown → user selects
a table in the Query tab → textarea set to `SELECT * FROM <table>` → user
clicks a command button → panel opens, columns fetched (cached after
first fetch, small inline spinner while loading) → user fills the form →
"Build" generates a SQL string, replaces textarea content, closes the
panel → user may hand-edit before clicking "Run query" (existing button/
Ctrl+Enter flow, unchanged).

## Components

- **`TableSelect`** (new) — a native `<select>` styled to match the
  existing `db-table-btn` visuals (sidebar) and query toolbar styling
  (Query tab). One component, two call sites:
  - Sidebar: replaces the `db-sidebar__tables` button column; `onChange`
    behaves like today's click-to-browse.
  - Query tab: replaces the static `Tables: ...` hint; `onChange` sets the
    textarea per the auto-populate rule above.
- **`QueryCommandToolbar`** (new) — row of six buttons (Search, Insert,
  Update, Delete, Join, Aggregate) above the textarea in `QueryPanel`.
  Disabled with a tooltip ("Select a table first") until a table is
  chosen. Clicking toggles `activeBuilder`; clicking the currently-active
  button again closes the panel.
- **`QueryBuilderPanel`** (new) — dispatches on `activeBuilder` to render
  one of six builder subcomponents, each ending in a shared "Build" /
  "Cancel" footer:
  - **`SearchBuilder`** — repeatable `ConditionRow`s (column, operator,
    value) joined by AND/OR → `SELECT * FROM t WHERE ...`
  - **`InsertBuilder`** — checkbox + value input per column (PK/identity
    columns unchecked by default) → `INSERT INTO t (...) VALUES (...)`
  - **`UpdateBuilder`** — column/value pairs to SET + `ConditionRow`(s) for
    WHERE → `UPDATE t SET ... WHERE ...`
  - **`DeleteBuilder`** — `ConditionRow`(s) only → `DELETE FROM t WHERE ...`
  - **`JoinBuilder`** — second-table `TableSelect`, join type
    (INNER/LEFT/RIGHT), left/right column pickers for the ON clause →
    `SELECT * FROM t1 [JOIN-TYPE] JOIN t2 ON t1.a = t2.b`
  - **`AggregateBuilder`** — repeatable function+column rows
    (COUNT/SUM/AVG/MIN/MAX) + optional GROUP BY column(s) →
    `SELECT COUNT(x), col FROM t GROUP BY col`
- **`ConditionRow`** (new, shared) — column dropdown (from
  `tableColumns[table]`), operator dropdown (`=`, `!=`, `>`, `<`, `LIKE`,
  `IS NULL`), value input (hidden for `IS NULL`). Reused by Search,
  Update, and Delete builders to avoid duplicating WHERE-clause UI three
  times.

SQL string generation for each builder is implemented as a pure function
in `packages/core` (e.g. `buildSearchQuery(table, conditions)`), separate
from the React form components, so it can be unit tested without
rendering.

## Error Handling

- `getColumns` failures (dropped connection, permission denied) show an
  inline error message inside the open builder panel; they do not block
  the rest of the screen. The user can cancel the builder and hand-write
  SQL in the textarea as a fallback.
- Builders disable "Build" until minimally valid (e.g., Insert needs ≥1
  checked column with a value; Search/Update/Delete need each
  `ConditionRow` to have a value unless the operator is `IS NULL`).
- Values are quoted/escaped by the SQL-generation functions (single quotes
  doubled for string literals, numeric values unquoted) — client-side
  generation only, since the resulting SQL still passes through the same
  server-side identifier validation and `ALLOWED` prefix check as any
  hand-typed query before execution.
- Widening `ALLOWED` does not add new identifier-interpolation paths;
  `handleRunQuery`'s existing SQL Server / SQLite branches are unchanged
  aside from the allow-list itself.

## Testing

- **Unit tests** (`packages/core`) for each `build*Query` function:
  correct SQL string for typical inputs, edge cases (no conditions,
  values needing quote-escaping, `IS NULL` operator, multiple aggregate
  columns, GROUP BY with no aggregates).
- **Unit test** for the widened `ALLOWED` list in
  `apps/desktop/electron/ipc/db-manager.cjs` (INSERT/UPDATE now pass,
  other prefixes still rejected).
- **Component tests** (if RTL/vitest coverage exists for
  `ViewDbManager.jsx`) for: dropdown selection updating textarea and
  sidebar browse target; command button toggling the correct panel;
  "Build" inserting generated SQL and closing the panel; "Cancel" leaving
  the textarea untouched.
- **Manual verification** via the `master/apps/desktop:verify` skill
  against both a SQL Server and a SQLite demo connection once
  implemented, covering: table dropdown population, auto-populated
  SELECT, and one successful run of each of the six builder-generated
  statement types.
