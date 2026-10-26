# Database grid: Structure tab, following foreign keys, menus, minimised columns — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Database page show a table's structure (columns, foreign keys, referencing keys, indexes), follow a foreign key value to its row and back, minimise grid columns, and offer right-click menus on headers and rows. Add row also gets a `datetimeoffset` editor and an honest notice when column types couldn't be read.

**Architecture:**
- The Electron main process gains a filtered `get-rows` (`where`, values always parameters) and a new `get-structure` IPC for both SQL Server and SQLite.
- Pure logic lives in core and is unit-tested: the `datetimeoffset` kind, SQL literals for "Copy as INSERT", and building follow and reverse targets from a structure and a row.
- The UI work in `ViewDbManager.jsx` is kept small by putting new pieces in their own files: the Structure panel, menu item builders, and the navigation history.

**Tech Stack:** React 18, Vitest + Testing Library, Electron IPC (CommonJS), `mssql`, `better-sqlite3` (mocked in tests).

**Spec:** `docs/superpowers/specs/2026-10-26-db-grid-structure-and-foreign-keys-design.md`

## Global Constraints

- Builds on branch `fix/db-columns-default-schema`, whose `get-columns` scopes by `OBJECT_ID(@object)`. New SQL Server lookups scope the same way.
- Every value the app sends in a filter goes in as a parameter, never as SQL text. Column names are checked with the existing `validateIdentifier` and bracketed (SQL Server) or double-quoted (SQLite).
- Other tables are named as the table list names them: bare for `dbo` (or no schema), `schema.Table` otherwise.
- Structure is read-only. Editing and deleting stay off for views and for tables with no primary key, with the existing reasons.
- Structure and foreign keys are fetched quietly alongside the rows, never before the rows show, and cached per table for the session.
- Minimised columns are stored in `localStorage` under `nx-db:min-cols:${connectionKey}:${table}`, as a JSON array of column names. Every read and write is wrapped in try/catch, like `readPref` / `writePref`.
- Filters (`where` and the empty / not-empty filter) apply to Browse only.
- The back history is per connection tab, capped at 50 entries.
- Copy text comes from the spec: chip `ActivityBookingID = 1182 ✕`, no-match message `No row in {table} has {column} = {value}`, the menu labels in spec §3, and the Add row notice `Couldn't read this table's column types; values go in as typed`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A foreign key value that comes back from `mssql` as a string (bigint, decimal, GUID) or a `Date` (datetime key) must still find its row when followed. The value is passed through unchanged as a parameter. Tested in Task 2 (`get-rows` with string and Date values) and Task 1 (`followTargets` keeps the raw value).
2. A key pointing into another schema (`maintenance.Booking`) opens that table under its schema name, including when Other schemas is hidden. Tested in Task 3 (naming) and Task 7 (follow into a schema-qualified table).
3. A self-referencing key (`ParentID → same table`) follows within the same table and Back returns to the previous filter. Tested in Task 1 (targets) and Task 7.
4. Back after the earlier table fails to load (dropped, or permission lost) shows the error and doesn't loop. Tested in Task 7.
5. A stored minimised-column list that names columns which no longer exist, or has bad JSON, is ignored. Tested in Task 5.

---

### Task 1: Core — `datetimeoffset`, SQL literals, and foreign-key targets

**Files:**
- Modify: `packages/core/src/modules/db-manager/cell-types.js`, `cell-types.test.js`
- Modify: `packages/core/src/modules/db-manager/query-builders.js`, `query-builders.test.js`
- Create: `packages/core/src/modules/db-manager/foreign-keys.js`, `foreign-keys.test.js`
- Modify: `packages/core/src/index.js`, `packages/core/tests/public-api.test.js` (export the new names)

**Interfaces:**
- Produces:
  - `columnKind(col)` can return `'datetimeoffset'`.
  - `isPartialInput('datetimeoffset', text)` accepts `/^[\d\-T: .:+Z]*$/`.
  - `parseCellInput` for it returns `{ value: 'YYYY-MM-DDTHH:MM:SS[.fff]±HH:MM' }`. An input without an offset, or ending in `Z`, becomes `+00:00`.
  - `cellToInput` for a `Date` returns `${isoParts(d)}+00:00`.
  - `sqlLiteral(col, value, dialect) → string`, where `dialect` is `'sqlserver' | 'sqlite'`:
    - `null` / `undefined` → `NULL`;
    - boolean → `1` / `0`;
    - integer and decimal kinds → the bare number text;
    - a `Date` → the quoted `cellToInput` text;
    - everything else → quoted with `''` escaping, prefixed `N` when the dialect is `sqlserver` and the type starts with `n` (`nvarchar`, `nchar`, `ntext`).
  - `buildInsertStatements(table, columns, rows, columnInfo, dialect) → string`: one `INSERT INTO <quoteTable(table)> (<cols>) VALUES (...);` per row, joined by `\n`. It leaves out columns whose `columnKind` is `'readonly'`.
  - `followTargets(structure, columns, row) → [{ key, table, where: [{ column, value }], label }]`:
    - one entry per `structure.foreignKeys` key where every column's value in `row` is non-null;
    - `where` pairs `refColumns[i]` with the row's value of `columns[i]`;
    - `label` = `` `${fk.columns.join(', ')} → ${fk.refTable}` ``.
  - `referencingTargets(structure, columns, row) → [{ key, table, where, label }]`:
    - one entry per `structure.referencedBy` key where every one of its `refColumns` values is non-null;
    - `where` pairs the key's own `columns[i]` with the row's `refColumns[i]` value;
    - `label` = `` `${k.table} by ${k.columns.join(', ')}` ``.
  - `whereLabel(where) → string`: `` `${column} = ${value}` `` joined by `' · '`. A `null` shows as `IS NULL`, and a `Date` as its ISO text.

- [ ] **Step 1: Write failing tests**
  - `cell-types.test.js`:
    - `columnKind({dataType:'datetimeoffset'}) === 'datetimeoffset'`;
    - `parseCellInput({dataType:'datetimeoffset',nullable:false}, '2026-10-26T09:30:00+10:00')` → `{ value: '2026-10-26T09:30:00+10:00' }`;
    - `'2026-10-26 09:30'` → `'2026-10-26T09:30:00+00:00'`;
    - `'2026-02-30T00:00+01:00'` → an error;
    - `isPartialInput('datetimeoffset','2026-10-26T09:30+1')` is true, and with `'abc'` it is false.
  - `query-builders.test.js`:
    - `sqlLiteral({dataType:'nvarchar'}, "O'Neil", 'sqlserver') === "N'O''Neil'"`;
    - `sqlLiteral({dataType:'varchar'}, '007', 'sqlserver') === "'007'"`. A text column keeps leading zeros, unlike `formatSqlValue`.
    - `sqlLiteral({dataType:'int'}, 7, 'sqlite') === '7'`;
    - `sqlLiteral({dataType:'bit'}, true, 'sqlserver') === '1'`;
    - `null` → `'NULL'`;
    - `buildInsertStatements('maintenance.T', ['Id','Name'], [[1,'a'],[2,null]], [{name:'Id',isIdentity:true},{name:'Name',dataType:'nvarchar'}], 'sqlserver')` returns two lines, each `INSERT INTO [maintenance].[T] ([Name]) VALUES (N'a');` and `... VALUES (NULL);`.
  - `foreign-keys.test.js`:
    - a composite key `{columns:['A','B'], refTable:'P', refColumns:['X','Y']}` with row `[1, 2]` gives `where [{column:'X',value:1},{column:'Y',value:2}]`;
    - the same key with `B` null is left out;
    - a self-reference `{columns:['ParentID'], refTable:'Node', refColumns:['ID']}` targets `'Node'`;
    - a string value `'9007199254740993'` and a `Date` pass through unchanged (same reference);
    - `referencingTargets` with `referencedBy [{table:'Member', columns:['BookingID'], refColumns:['ID']}]` and `ID = 5` gives `{table:'Member', where:[{column:'BookingID', value:5}], label:'Member by BookingID'}`;
    - `whereLabel([{column:'A',value:1},{column:'B',value:null}]) === 'A = 1 · B IS NULL'`.
- [ ] **Step 2: Run, and confirm the tests fail:** `cd packages/core && npx vitest run src/modules/db-manager`
- [ ] **Step 3: Implement** as described under Interfaces, then add the exports to `index.js` and `public-api.test.js`.
- [ ] **Step 4: Run, and confirm everything passes:** `cd packages/core && npx vitest run`
- [ ] **Step 5: Commit:** `feat(core): datetimeoffset cells, SQL literals for INSERT copies, foreign-key targets`

### Task 2: Electron — `get-rows` with `where`

**Files:**
- Modify: `apps/desktop/electron/ipc/db-manager.cjs` (`handleGetRows`, around line 215)
- Modify: `apps/desktop/electron/preload.cjs:139` (`getRows` passes `where`)
- Modify: `apps/desktop/src/adapters/db-manager.js` (`getRows(type, config, table, limit = 500, offset = 0, where = null)`)
- Test: `apps/desktop/electron/ipc/db-manager.test.js`

**Interfaces:**
- Produces: IPC `db-manager:get-rows` accepts `where?: [{ column: string, value: any }]`. An empty array or a missing value means no filter.
  - SQL Server: `WHERE [c0] = @w0 AND [c1] IS NULL`, with `request.input('w0', value)` for each non-null value. `ORDER BY (SELECT NULL) OFFSET … FETCH …` stays.
  - SQLite: `WHERE "c0" = ? AND "c1" IS NULL`, with the values bound in order before `limit` and `offset`.
  - Adapter: `getRows(type, config, table, limit, offset, where)`.

- [ ] **Step 1: Write failing tests** in the SQL Server statements describe:
  - `where [{column:'BookingID', value:'9007199254740993'}, {column:'Note', value:null}]` on `maintenance.Member` gives SQL containing `FROM [maintenance].[Member]` and `WHERE [BookingID] = @w0 AND [Note] IS NULL`, and `inputs` equal to `{ w0: '9007199254740993' }`;
  - a `Date` value is passed as the same `Date` instance;
  - a column `'a]; DROP'` rejects with `Invalid identifier`.

  In the SQLite describe: `where [{column:'id', value:2}]` prepares SQL matching `/WHERE "id" = \? LIMIT \? OFFSET \?/`, and `all` is called with `(2, 500, 0)`.
- [ ] **Step 2: Run, and confirm the tests fail:** `cd apps/desktop && npx vitest run electron/ipc/db-manager.test.js`
- [ ] **Step 3: Implement** in the handler, preload and adapter.
- [ ] **Step 4: Run, and confirm everything passes.**
- [ ] **Step 5: Commit:** `feat(db-manager): get-rows takes a parameterised where`

### Task 3: Electron — `get-structure`

**Files:**
- Modify: `apps/desktop/electron/ipc/db-manager.cjs`. Add `handleGetStructure` and register `db-manager:get-structure`. Extract the list naming in `handleConnect` (line ~174, `named`) into `listName(schema, name)` and use it in both places.
- Modify: `apps/desktop/electron/preload.cjs` (`getStructure: (type, config, table) => invoke('db-manager:get-structure', …)`)
- Modify: `apps/desktop/src/adapters/db-manager.js` (`getStructure(type, config, table)`)
- Test: `apps/desktop/electron/ipc/db-manager.test.js`

**Interfaces:**
- Produces: `getStructure → { ok: true, columns, foreignKeys, referencedBy, indexes }`, with the shapes in spec §4.
  - `columns` comes from the same code as `handleGetColumns`. Call it, don't copy it.
  - `onDelete` / `onUpdate` are `'NO ACTION' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT'`.
  - `indexes[].columns` is `[{ name, desc: boolean }]`, in key order. `filter` is `string | null`.
- **SQL Server:**
  - Outgoing keys: `sys.foreign_keys fk JOIN sys.foreign_key_columns fkc`, where `fk.parent_object_id = OBJECT_ID(@object)`, ordered by `fk.name, fkc.constraint_column_id`.
    - Column names come from `COL_NAME(object, column_id)`.
    - The target is `OBJECT_SCHEMA_NAME(fk.referenced_object_id)` with `OBJECT_NAME(...)`, named through `listName`.
    - Rules come from `delete_referential_action_desc` / `update_referential_action_desc`, with `_` replaced by a space.
  - Incoming keys: the same query with `fk.referenced_object_id = OBJECT_ID(@object)`.
  - Indexes: `sys.indexes i JOIN sys.index_columns ic`, where `i.object_id = OBJECT_ID(@object) AND i.type > 0 AND ic.key_ordinal > 0`, ordered by `i.name, ic.key_ordinal`. Use `is_unique`, `is_primary_key`, `filter_definition` and `is_descending_key`.
  - Each query is one request whose rows are grouped in JavaScript.
- **SQLite:**
  - `PRAGMA foreign_key_list("t")` gives the keys, grouped by `id` and ordered by `seq`. A `to` of `null` means the target's primary key columns, taken from `PRAGMA table_info` of the target.
  - Incoming keys: `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`, then `foreign_key_list` for each table whose `table` equals this one (case-insensitive).
  - Indexes: `PRAGMA index_list`, then `PRAGMA index_xinfo` rows with `key = 1`. `primaryKey` is `origin === 'pk'`, and `filter` is `null`.

- [ ] **Step 1: Write failing tests.**
  - SQL Server: feed `nextResult` per request (make `nextResult` a queue for this test).
    - A composite outgoing key `FK_M_B (BookingID, Site) → maintenance.Booking (ID, Site)` comes back as one entry with `refTable: 'maintenance.Booking'`, `onDelete: 'CASCADE'`.
    - A `dbo` target comes back bare.
    - The incoming query's SQL matches `/referenced_object_id = OBJECT_ID\(@object\)/`.
    - An index row set gives `{ name:'IX_A', columns:[{name:'A',desc:true}], unique:true, primaryKey:false, filter:'([A]>(0))' }`.
    - `inputs.object` equals `'[Member]'` for a bare name.
  - SQLite: route `prepare(sql).all()` by SQL text.
    - `foreign_key_list` rows `[{id:0,seq:0,table:'P',from:'pid',to:null,on_delete:'CASCADE',on_update:'NO ACTION'}]`, with `table_info(P)` reporting `id` as pk, give `refColumns:['id']`.
    - A self-reference appears in both `foreignKeys` and `referencedBy`.
    - An index `{name:'sqlite_autoindex_t_1', unique:1, origin:'pk'}` gives `primaryKey:true`.
- [ ] **Step 2: Run, and confirm the tests fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, and confirm the whole file passes:** `npx vitest run electron/ipc/db-manager.test.js`
- [ ] **Step 5: Commit:** `feat(db-manager): get-structure reads foreign keys, referencing keys and indexes`

### Task 4: UI — Add row notice and `datetimeoffset` editor

**Files:**
- Modify: `packages/ui/src/views/ViewDbManager.jsx`:
  - `ensureColumnsLoaded` (~line 621);
  - `columnsKnown` (~line 728);
  - the read-only notice in `BrowsePanel` (~line 2172);
  - `AddRowDialog` (~line 2513);
  - `CellInput` (~line 2100).
- Test: `packages/ui/src/views/ViewDbManager.test.jsx`

**Interfaces:**
- Produces: `columnsFailed` state (`{ [table]: true }`), set when a quiet `getColumns` throws or returns `columns: []` for a table that has columns in `tableData`. Add row is enabled when the columns are known or have failed.
  - In `AddRowDialog`, when every `columnInfo` entry is null, show `<div className="nx-db-alert" role="note">Couldn't read this table's column types; values go in as typed</div>` above the fields. Field labels show no type then (not `text`).
  - The grid's read-only notice, in that case: `Couldn't read this table's column types, so editing and deleting are off. You can still add rows, or change rows from the Query tab.`
  - `CellInput` for `'datetimeoffset'`: `type="text"`, `placeholder="YYYY-MM-DDTHH:MM:SS+HH:MM"`, `spellCheck={false}`.

- [ ] **Step 1: Write failing tests.**
  - With `getColumns` resolving `{ ok:true, columns: [] }`, open `patients` and click Add row. The dialog shows the notice, and no `text` type label appears.
  - The grid shows the "Couldn't read" notice, not the primary key one.
  - With a `datetimeoffset` column, the Add row field has that placeholder, and typing `x` is refused (the value stays empty).
- [ ] **Step 2: Run, and confirm the tests fail:** `cd packages/ui && npx vitest run src/views/ViewDbManager.test.jsx`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, and confirm everything passes.**
- [ ] **Step 5: Commit:** `fix(db-manager): say when a table's column types couldn't be read; datetimeoffset editor`

### Task 5: UI — minimised columns

**Files:**
- Create: `packages/ui/src/views/db-min-cols.js`, containing `readMinCols(connKey, table) → string[]` and `writeMinCols(connKey, table, names)`.
- Modify: `ViewDbManager.jsx`. `DbSession` holds `minCols` for the selected table and passes `minimised: Set<string>`, `onMinimise(name)`, `onRestore(name)` and `onRestoreAll()` to `BrowsePanel`.
- Modify: the stylesheet that holds `.nx-db-table` rules (find it with `grep -rl "nx-db-table" packages/ui/src`).
- Test: `packages/ui/src/views/db-min-cols.test.js`, `ViewDbManager.test.jsx`

**Interfaces:**
- Produces:
  - A minimised header is `<th className="min">` holding a button with `aria-label="Show {col}"` and `title="Show {col}"`. Its text is the column name, written sideways with `writing-mode: vertical-rl`. The width is about 24px.
  - A minimised body cell is `<td className="min" />` with no content.
  - A header hover button has `aria-label="Minimise {col}"`.
  - A toolbar control reads `{n} minimised · Show all`, as a button with the accessible name `Show all minimised columns`. It shows only when n > 0.
  - Tab editing skips minimised columns in `neighbour`.

- [ ] **Step 1: Write failing tests.**
  - `db-min-cols.test.js`: a round trip; bad JSON gives `[]`; `localStorage` throwing gives `[]`.
  - UI test 1: click `Minimise name`. The `name` header becomes a `Show name` button. The search still finds `Bob`. Copy row (the existing button) still copies `2\tBob`.
  - UI test 2: reopen the same table (close and open) and it is still minimised.
  - UI test 3: seed `nx-db:min-cols:<key>:patients` with `["gone","name"]`, and only `name` is minimised.
  - UI test 4: `Show all minimised columns` restores every column.
- [ ] **Step 2: Run, and confirm the tests fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, and confirm everything passes.**
- [ ] **Step 5: Commit:** `feat(db-manager): minimise grid columns, remembered per table`

### Task 6: UI — Structure tab and foreign key header markers

**Files:**
- Create: `packages/ui/src/views/db-structure-panel.jsx`, containing `StructurePanel({ structure, isView, loading, error, onOpenTable, onRefresh, focusKey })`.
- Modify: `ViewDbManager.jsx`:
  - `ensureStructureLoaded(table, { quiet })` beside `ensureColumnsLoaded`, called quietly from `openTable`;
  - the `structures` cache state;
  - a third tab `['structure', 'Structure', null]` at ~line 1300, with the shortcut `s` in `useDbShortcuts` and the header comment;
  - `BrowsePanel` header markers.
- Modify: the stylesheet, for `.nx-db-structure*`.
- Test: `packages/ui/src/views/db-structure-panel.test.jsx`, `ViewDbManager.test.jsx`

**Interfaces:**
- Consumes: `db.getStructure` (Task 3), which may be missing on an adapter, so call it as `db.getStructure?.(...)`. With no adapter method, or in the demo, the structure is `{ columns: <getColumns result>, foreignKeys: [], referencedBy: [], indexes: [] }`.
- Produces:
  - `structures[table]` holds the structure, read by Tasks 7 and 8.
  - `StructurePanel` has sections headed `Columns`, `Foreign keys`, `Referenced by` and `Indexes`. Each empty section shows a one-line "None". In Columns, a foreign key column links to its target the same way.
  - For a view, it shows only Columns plus `Views have no keys or indexes of their own.`
  - Target table links are buttons with the accessible name `Open {table}`, calling `onOpenTable(table)`.
  - `focusKey` (a key name) scrolls that key's row into view and highlights it (`data-focus`).
  - The Browse header for a foreign key column gets `<span className="fk" title="→ {refTable}.{refColumn}">` with the text `fk`.

- [ ] **Step 1: Write failing tests.**
  - The panel renders a composite key as one row with `BookingID, Site → maintenance.Booking (ID, Site)`, plus `ON DELETE CASCADE`.
  - `Open maintenance.Booking` calls `onOpenTable('maintenance.Booking')`.
  - The view variant shows the note.
  - The index row shows `A desc`, `unique` and the filter.
  - In `ViewDbManager.test.jsx`, the adapter has `getStructure` returning one key on `name`. Opening `patients` shows an `fk` marker in the `name` header, and its title is `→ staff.id`. Pressing `s` shows the Structure tab.
- [ ] **Step 2: Run, and confirm the tests fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, and confirm everything passes.**
- [ ] **Step 5: Commit:** `feat(db-manager): Structure tab with foreign keys, referencing keys and indexes`

### Task 7: UI — following keys, the filter chip, and Back

**Files:**
- Create: `packages/ui/src/views/db-nav.js`, containing `pushNav(stack, entry) → stack` (capped at 50, drops the oldest) and `popNav(stack) → [entry | null, stack]`.
- Modify: `ViewDbManager.jsx`:
  - `fetchRows(name, where)` (the demo filters in memory with `===`, and `null` matches null or undefined);
  - `openTable(name, tab, { where, search, sort, scrollTop })`;
  - `refreshTable` keeps the current `where`;
  - `rowWhere` state and the chip;
  - `navStack` state, with `follow(target)` and `goBack()`;
  - an Alt+← handler in `useDbShortcuts`;
  - the ← button by the table name;
  - the follow buttons in foreign key cells.
- Test: `packages/ui/src/views/db-nav.test.js`, `ViewDbManager.test.jsx`

**Interfaces:**
- Consumes: `followTargets`, `referencingTargets` and `whereLabel` (Task 1), `getRows(..., where)` (Task 2), and `structures` (Task 6).
- Produces:
  - `follow({ table, where })` pushes `{ table, where, search, sort, scrollTop }` for the current view, then opens `table` in Browse with `where`.
  - `goBack()` pops and reopens with the saved state. If that load fails, the error shows, the entry stays popped, and the stack isn't pushed again.
  - The chip is `<span className="nx-db-chip">{whereLabel(where)}<button aria-label="Clear filter">✕</button></span>`. Clearing it reloads without `where` and doesn't push history.
  - With a filter and no rows, the grid shows `No row in {table} has {whereLabel(where)}`.
  - Follow buttons: a non-null value in a foreign key column's cell gets a trailing `<button className="nx-db-follow" aria-label="Follow {col} {value} to {refTable}">→</button>`. This is my call (see the note below). A single click on the button follows. Double-click on the cell still edits.
  - The ← button has `aria-label="Back"` and `title="Back (Alt+←)"`, and is disabled when the stack is empty.

> Note (ruling): the spec says values "show as links" and a single click follows, while double-click still edits. A single click on the value itself would fire before every double-click, so the click target is a small → button at the end of the cell, and the value keeps its normal styling. This decides the same behaviour without breaking editing.

- [ ] **Step 1: Write failing tests.**
  - `db-nav.test.js`: the cap at 50 drops the oldest; pop on an empty stack gives `[null, []]`.
  - UI:
    1. Follow `name` → `staff`. `getRows` is called with `where [{column:'id', value:'Alice'}]`, the chip reads `id = Alice`, and the Back button is enabled.
    2. Back reopens `patients` with no `where`, and the search typed before following comes back.
    3. Follow into `maintenance.Booking` (the adapter's structure points there, and Other schemas is toggled off) calls `getRows` with the table `maintenance.Booking`.
    4. A self-reference: follow twice within `patients`, then Back twice, and each step's `where` is restored.
    5. `getRows` resolving no rows under a filter shows `No row in staff has id = Alice`.
    6. Clearing the chip calls `getRows` without `where`.
    7. Back when the earlier table's `getRows` rejects shows the error, and pressing Back again (with an empty stack) does nothing.
    8. Alt+ArrowLeft acts like Back.
- [ ] **Step 2: Run, and confirm the tests fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, and confirm everything passes.**
- [ ] **Step 5: Commit:** `feat(db-manager): follow a foreign key to its row, with a filter chip and Back`

### Task 8: UI — header and row right-click menus

**Files:**
- Create: `packages/ui/src/views/db-grid-menus.js`, containing `headerMenuItems(ctx) → items` and `rowMenuItems(ctx) → items` (pure, in the `DbMenu` item format).
- Modify: `ViewDbManager.jsx`:
  - `BrowsePanel` gains `onHeaderMenu(ci, point)` and `onRowMenu(ri, ci, point)` from `onContextMenu` on `th` and `td` (with `preventDefault`);
  - `DbSession` builds the items and calls `showMenu`;
  - `nullFilter` state `{ col, empty }` filters `visible` and shows a chip `{col} is empty ✕` or `{col} is not empty ✕`;
  - `AddRowDialog` gains `initial: { [name]: value }` for Duplicate. It uses `cellToInput` per column and leaves out `readonly` kinds.
- Test: `packages/ui/src/views/db-grid-menus.test.js`, `ViewDbManager.test.jsx`

**Interfaces:**
- Consumes:
  - `buildInsertStatements`, `followTargets` and `referencingTargets` (Task 1);
  - `structures` (Task 6);
  - `follow` (Task 7);
  - `onMinimise` / `onRestoreAll` (Task 5);
  - the existing `onStartEdit`, `commitCell`, `copyText`, `onDeleteRow`, `onDeleteSelected` and sort setters.
- Produces, with the labels exactly as in spec §3:
  - Header: `Sort ascending`, `Sort descending`, `Clear sort` (only when sorted), separator, `Minimise column` / `Show all minimised columns` (when any), separator, `Copy column name`, `Copy values`, separator, `Show only empty (NULL)`, `Show only not empty`, and `Go to foreign key target…` (foreign key columns only; it opens Structure with `focusKey`).
  - Row:
    - `Edit cell` and `Set to NULL`. `Set to NULL` is shown only when the column is nullable and editable. Both are disabled, with `title` set to the existing reason, when editing is off.
    - separator, then `Copy cell`, `Copy row` and `Copy as INSERT`;
    - `Duplicate row…`;
    - separator, then one `Follow {label}` per `followTargets` entry;
    - `Show rows that reference this` as a `submenu` of `referencingTargets` labels, shown only when there are any;
    - separator, then `Delete row` (danger, disabled with the existing reason when delete is off).
  - Multi-row: when the clicked row is ticked and more than one row is ticked, the labels become `Copy {n} rows`, `Copy {n} rows as INSERT` and `Delete {n} rows`, acting on all ticked rows.
  - In views, edit, delete and duplicate are left out, and so are follow and reverse.

- [ ] **Step 1: Write failing tests.**
  - `db-grid-menus.test.js` (pure):
    - the header items for a sorted foreign key column, in the exact label order;
    - `Clear sort` is absent when unsorted;
    - the row items with `canWrite:false` have `Edit cell` disabled and its `title` equal to the passed reason;
    - multi-row labels with 3 ticked;
    - the reverse submenu is absent with no `referencedBy`;
    - for a view there is no `Delete row`.
  - UI:
    1. Right-click the `name` header, choose `Sort descending`, and the first row is Bob.
    2. `Show only empty (NULL)` with no NULLs shows the empty message, and clearing its chip restores both rows.
    3. Right-click a cell, choose `Copy as INSERT`, and the clipboard mock receives `INSERT INTO "patients"` … (match the dialect quoting `quoteTable` gives).
    4. `Duplicate row…` opens Add row with `name` prefilled `Alice`.
    5. `Follow name → staff` calls `getRows` with `where`, exactly as in Task 7.
- [ ] **Step 2: Run, and confirm the tests fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all three suites:** `npx vitest run` in `packages/core`, `packages/ui` and `apps/desktop`. Everything should pass.
- [ ] **Step 5: Commit:** `feat(db-manager): right-click menus on grid headers and rows`

### Task 9: Runtime check

- [ ] `cd apps/desktop && npx vite build`, then a Playwright script via `e2e/launch.js` (`launchApp`) on the demo connection. Minimise a column, right-click a header and a row, and open the Structure tab (the demo shows "None" for keys). Take screenshots into the scratchpad and look at them.
- [ ] `better-sqlite3` isn't installed in this checkout, and the user's SQL Server isn't reachable from here, so following keys can't be exercised at runtime by the builder. Report that plainly, and ask the user to try following `ActivityBookingID` on `tbl_ActivityMembers`.
