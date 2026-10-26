# Database page: typed Add row, minimised columns, right-click menus, Structure tab, following foreign keys

Date: 2026-10-26 · `packages/ui/src/views/ViewDbManager.jsx`, `apps/desktop/electron/ipc/db-manager.cjs`, `packages/core/src/modules/db-manager/`

## Why

The Browse grid shows a table's rows, but it can't tell you how the table fits into the database. You can't see a column's foreign key or where it points, and you can't follow one from a value to the row it names. To find the booking behind `tbl_ActivityMembers.ActivityBookingID = 1182`, you have to open another table and hunt for it, and Browse only loads the first 500 rows anyway. The grid also has no right-click menus, and wide tables can't be narrowed.

Success means: from any row you can click a foreign key value and land on the row it refers to, get back again, and see a table's columns, keys and indexes in one place.

## Goals

1. **Add row holds each field to its column's type.** This already works where column details load. A bug stopped them loading for `dbo` tables when the login's default schema isn't `dbo`. It is fixed on branch `fix/db-columns-default-schema` (c5a5b2b), which this work builds on. The one change still needed: a column type the app doesn't recognise must be visible as such, not silently treated as text (see 1 below).
2. **Minimise columns** in the Browse grid.
3. **Right-click menus** on column headers and on rows.
4. **A Structure tab:** columns, foreign keys (with where each one points), keys that point at this table, and indexes.
5. **Following foreign keys to the matching row**, and back again. Also the reverse: from a row, the rows elsewhere that reference it.

## Non-goals

- Editing a table's structure (adding columns, keys or indexes). Structure is read-only.
- Paging through more than the first 500 rows in normal Browse. Following a key gets round the limit by fetching just the matching rows; general paging is separate work.
- A diagram of the relationships between tables.
- Foreign keys in the demo database. The demo has none, so Structure shows its columns and says it has no keys.

## Anti-goals (a failure even if it works)

- Following a key "works" by searching only the 500 loaded rows, so it shows nothing for a row further in.
- Any value is pasted into SQL text. Filter values go in as parameters, like every other value the app writes today.
- Structure or the foreign-key lookup slows down opening a table. Those details are fetched when needed, or alongside the rows, never before the rows show.
- Edit or delete becomes possible where it's off today (views, and tables with no primary key).

## Existing pieces to build on

- `getColumns` (IPC `db-manager:get-columns`) returns name, type, nullable, length, precision and scale, default, identity, computed and primary key per column. SQL Server reads `INFORMATION_SCHEMA`, and SQLite reads `PRAGMA table_info`.
- `getRows(type, config, table, limit = 500, offset = 0)` reads a page of rows. It has no filter today.
- `tableName(type, table)` in `db-manager.cjs` turns `schema.Table` or `Table` into a safe bracketed name. `quoteTable` in core does the same for SQL the UI builds.
- `columnKind`, `isPartialInput` and `parseCellInput` (`packages/core/src/modules/db-manager/cell-types.js`) decide each column's editor and check values. `CellInput` uses them in the grid and in Add row.
- `showMenu(items, label, point)` in `DbSession` already shows right-click menus for the table list. Items carry `label`, `icon`, `hint`, `onSelect`, `separator`, and a disabled `reason`.
- `readPref` / `writePref` and `readTablePrefs` keep per-connection settings in `localStorage`.
- Browse / Query tabs live at `activeTab` in `DbSession`, with the keys `b` and `q`.

## Design

### 1. Add row and unknown types

After the schema fix, Add row and the grid editor are typed for every type `columnKind` knows. Two remaining gaps:

- **Types that fall back to text without saying so.** `datetimeoffset` gets a datetime editor that keeps the offset (`YYYY-MM-DDTHH:MM:SS+HH:MM`). Its check accepts an optional offset, and the value is written as text for the database to convert. `char`, `nchar`, `varchar`, `nvarchar`, `text`, `ntext` and `xml` stay text, as today. Any other type the app doesn't recognise still gets a text box, but its type label is shown as written, so it isn't mistaken for text.
- **Column details that didn't load.** If `getColumns` fails or returns no columns for a table that has rows, Add row says so at the top ("Couldn't read this table's column types; values go in as typed") instead of quietly labelling every field `text`. The Browse grid's read-only notice tells this apart from "no primary key" in the same way.

### 2. Minimised columns

- A minimised column shrinks to a narrow strip, about 24px wide, with its name written sideways. The strip has a tooltip ("Show {column}"), and clicking it restores the column.
- You minimise a column from its header's right-click menu, or with a small button that shows when you hover the header.
- A "N minimised · Show all" control sits beside the row count when any are minimised.
- Remembered per connection and table in `localStorage` (key `nx-db:min-cols:${connectionKey}:${table}`), by column name. Names that no longer exist are ignored.
- Minimised columns stay in the data: search still matches them, Copy row and CSV still include them, and Tab moves past them while editing.

### 3. Right-click menus

**Column header:**

| Item | Notes |
|---|---|
| Sort ascending / Sort descending / Clear sort | Clear only when this column is sorted |
| Minimise column | "Show all minimised columns" when any are |
| Copy column name | |
| Copy values | The values of the rows shown (after search and sort), one per line |
| Show only empty (NULL) / Show only not empty | A filter chip like the foreign-key one (section 5), applied to the loaded rows |
| Go to foreign key target… | Only on a foreign key column: opens the Structure tab at that key |

**Row** (right-click on any cell):

| Item | Notes |
|---|---|
| Edit cell | The clicked cell. Off where editing is off, with the existing reason |
| Set to NULL | Only for a nullable, editable column |
| Copy cell / Copy row / Copy as INSERT | Copy row is tab-separated, as the copy button does now. INSERT uses the core query builders |
| Duplicate row… | Opens Add row filled with this row's values, leaving out identity and computed columns |
| Follow {column} → {table} | One per foreign key whose value in this row isn't NULL (section 5) |
| Show rows that reference this ▸ | A submenu with one entry per incoming key: "{table} by {column}" (section 5) |
| Delete row | Off where delete is off, with the existing reason |

With several rows ticked and the click on a ticked row, the copy, INSERT and delete items act on all ticked rows ("Copy 3 rows", "Delete 3 rows"). Edit, Set to NULL, Duplicate and Follow act on the clicked row only.

### 4. Structure tab

A third tab after Browse and Query, with the key `s`. It is read-only and fetched the first time it's opened for a table, then cached for the session. Refresh fetches it again. Sections:

- **Columns:** one row each, with name, type (as `typeLabelOf` shows it), nullable, default (the expression), identity / computed, and primary key position. Foreign key columns get a link to their target.
- **Foreign keys:** one row per key, with name, columns, and target (`tbl_ActivityBookings.ActivityBookingID`, a link that opens that table in Browse), plus on delete / on update. A key of several columns is one row, with its columns paired in order.
- **Referenced by:** keys in other tables that point at this one, with name, `{table}.{columns}`, and the on delete rule. The table is a link.
- **Indexes:** name, columns in order (descending marked), unique, primary key, and filtered (SQL Server's filter definition, if any).

Browse headers of foreign key columns get a small link marker, whose tooltip reads "→ tbl_ActivityBookings.ActivityBookingID".

**Data.** A new IPC `db-manager:get-structure` takes `{type, config, table}` and returns:

```
{ columns: <as getColumns>,
  foreignKeys: [{ name, columns: [..], refTable, refColumns: [..], onDelete, onUpdate }],
  referencedBy: [{ name, table, columns: [..], refColumns: [..], onDelete, onUpdate }],
  indexes: [{ name, columns: [{ name, desc }], unique, primaryKey, filter }] }
```

`refTable` / `table` use the same naming as the table list (bare for `dbo`, `schema.Table` otherwise), so they can be opened directly.

- SQL Server: `sys.foreign_keys` and `sys.foreign_key_columns` (ordered by `constraint_column_id`), plus `sys.indexes` and `sys.index_columns`. Scope by `OBJECT_ID(@object)`, the same way the `get-columns` fix does.
- SQLite: `PRAGMA foreign_key_list`, plus `PRAGMA index_list` and `PRAGMA index_xinfo`. Incoming keys come from running `foreign_key_list` over every table. That's fine for SQLite file sizes.

The foreign keys (outgoing and incoming) are needed by Browse too, for links and menus. They come from the same call, fetched quietly alongside the rows the way `ensureColumnsLoaded` is today, and cached per table.

### 5. Following foreign keys

**Fetching filtered rows.** `getRows` gains an optional `where`: a list of `{ column, value }`. The entries are ANDed, and a `null` value means `IS NULL`. Column names are checked and bracketed; values are parameters. The limit stays at 500. The adapter, preload and IPC carry it through. Demo tables filter in memory.

**In Browse:**

- A foreign key column's non-NULL values show as links. They're still double-click to edit; a single click on the link follows it.
- Following `ActivityBookingID = 1182` opens `tbl_ActivityBookings` in Browse with `where [ActivityBookingID] = 1182`. For a composite key, every column pair is matched.
- Above the grid, a filter chip reads `ActivityBookingID = 1182 ✕`. Clearing it reloads the normal first 500 rows. Search and sort work on the filtered rows.
- If nothing matches (an orphaned value), the grid says "No row in {table} has {column} = {value}".

**Back.** A ← button by the table name, plus Alt+←, steps back through the tables and filters you came from in this session: table, filter, search, sort, and the row scrolled to. The history is per connection tab and capped at 50.

**Reverse.** "Show rows that reference this" opens the referencing table filtered on its key columns = this row's referenced values.

**Structure links** open the target table unfiltered.

**Edits on a filtered view** behave as in normal Browse: after a save the filtered rows reload, so a row that no longer matches drops out.

### 6. Edge cases (my calls, settled after review)

- **Table names.** `get-structure` names other tables exactly as the table list does: bare for `dbo`, `schema.Table` otherwise. Opening one then goes through the same path as clicking it in the list. If the login's default schema has a table with the same name as a `dbo` one, the bare name is already ambiguous in the list today. This work doesn't change that.
- **Hidden schemas.** Following a key, a Structure link or "Referenced by" into a schema hidden by the Other schemas toggle opens the table anyway. The toggle only filters the table list, and the list stays as it is.
- **Parameter types.** A `where` value is the cell's value as the driver returned it (number, string, Date, boolean), sent through unchanged. The `mssql` driver infers the parameter type from the JavaScript value, the same way the existing update and delete calls bind key values. A GUID arrives as a string and SQL Server converts it. No extra type information crosses IPC.
- **Leaving with work in progress.** A cell being edited saves on leaving, as clicking away does today. Ticked rows are cleared, as opening any table already does. Add row is a modal, so you can't navigate while it's open. The back history doesn't carry selections.
- **Composite keys with a NULL part.** If any column of the key is NULL in this row, Follow for that key is left out, and so is the matching "Show rows that reference this" entry.
- **Views.** For a view, Structure shows Columns only, with a line saying views have no keys or indexes of their own. Views get no foreign-key links or menu entries.
- **Add row on a filtered view** isn't prefilled. It opens blank, as it does now.
- **Filters apply to Browse only.** The Query tab is unaffected.

## Tests

- **Core:** the `datetimeoffset` kind and its check; Copy as INSERT for one and several rows, including NULLs and other schemas; any builder for `where` SQL, if it lives in core.
- **Electron:** `get-rows` with `where` (parameters, `IS NULL`, composite, bad column name refused) for both drivers; `get-structure` against a real SQLite file with composite and self-referencing keys, incoming keys and indexes; the SQL Server queries' shape and inputs, in the style of the existing mocked-pool tests.
- **UI:**
  - minimise / restore, the "Show all" control, and that it's remembered;
  - each menu's items, which ones are disabled and why, and multi-row behaviour;
  - the Structure tab's sections;
  - following a key (the chip, clearing it, no match, composite keys), back with Alt+←, and the reverse from a row;
  - the Add row notice when column details didn't load.
- **Runtime:** in the app against SQLite, follow a key, go back, and open Structure.

## Left to the builder

- Exact styling of the strip, chips, link marker and Structure tables, within the existing `nx-db-*` CSS.
- Whether the `where` SQL is built in core or in `db-manager.cjs`, as long as values are parameters.
- How the row under the cursor is identified for the row menu.
