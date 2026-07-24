# Query Screen: Table Dropdown & Guided Query Builders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Database Manager's table list (sidebar + Query tab) with a dropdown, auto-populate a starting `SELECT * FROM <table>` on selection, and add six guided-form command buttons (Search, Insert, Update, Delete, Join, Aggregate) that build SQL into the query textarea.

**Architecture:** A new `getColumns` Electron IPC handler (mirroring the existing `handleConnect`/`handleGetRows` pattern in `db-manager.cjs`) exposes per-table column metadata through the existing preload → adapter chain. Six pure SQL-generation functions live in `packages/core` and are unit tested in isolation from React. `ViewDbManager.jsx` gains a shared `TableSelect` component (used in both the sidebar and the Query tab), a `QueryCommandToolbar`, a `QueryBuilderPanel` dispatcher, and six builder subcomponents that share one `ConditionRow` control for WHERE-clause fields.

**Tech Stack:** React (function components/hooks) in `packages/ui`, pure JS module logic in `packages/core`, Electron main-process IPC in `apps/desktop/electron`, Vitest + `@testing-library/react` for tests.

## Global Constraints

- Table/column names used to build SQL come only from `session.tables` and `getColumns` responses (schema-derived) — never freeform user text — so the injection surface does not grow when `INSERT`/`UPDATE` are added to `handleRunQuery`'s `ALLOWED` list.
- Every table/column identifier reaching `db-manager.cjs` still passes through the existing `validateIdentifier` (`SAFE_ID = /^[a-zA-Z_][a-zA-Z0-9_ ]*$/`) guard before being interpolated into SQL.
- Follow the existing in-file component convention in `ViewDbManager.jsx` — new UI pieces are additional function components in that same file, not new files (matches `WelcomePane`, `ConnectDialog`, `BrowsePanel`, `QueryPanel`, `ConfirmDialog` already there).
- Existing test coverage for `db-manager.cjs` only exercises the SQLite branch (no `mssql` mock exists in the test file) — new backend tests follow that same SQLite-only convention.
- Each package tests independently: `npm run test -w apps/desktop -- <path>`, `npm run test -w packages/core -- <path>`, `npm run test -w packages/ui -- <path>`.

---

### Task 1: `getColumns` IPC handler

**Files:**
- Modify: `apps/desktop/electron/ipc/db-manager.cjs`
- Test: `apps/desktop/electron/ipc/db-manager.test.js`

**Interfaces:**
- Produces: `handleGetColumns(_e, { type, config, table })` → `Promise<{ ok: true, columns: { name: string, dataType: string, isPrimaryKey: boolean }[] }>`, registered on IPC channel `'db-manager:get-columns'`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/desktop/electron/ipc/db-manager.test.js`, inside the existing `describe('db-manager IPC — SQLite', ...)` block (after the `run-query allows DELETE` test, before its closing `})`):

```js
  it('get-columns returns column metadata', async () => {
    mockSqliteStmt.all.mockReturnValueOnce([
      { cid: 0, name: 'id',   type: 'INTEGER', notnull: 1, dflt_value: null, pk: 1 },
      { cid: 1, name: 'name', type: 'TEXT',    notnull: 0, dflt_value: null, pk: 0 },
    ])
    const result = await ipc._invoke('db-manager:get-columns', { ...cfg, table: 'users' })
    expect(result.ok).toBe(true)
    expect(result.columns).toEqual([
      { name: 'id',   dataType: 'INTEGER', isPrimaryKey: true },
      { name: 'name', dataType: 'TEXT',    isPrimaryKey: false },
    ])
    const sql = mockSqliteDb.prepare.mock.calls.at(-1)?.[0] ?? ''
    expect(sql).toMatch(/PRAGMA table_info\("users"\)/)
  })

  it('get-columns rejects invalid table identifier', async () => {
    await expect(
      ipc._invoke('db-manager:get-columns', { ...cfg, table: 'users; DROP TABLE users--' }),
    ).rejects.toThrow('Invalid identifier')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w apps/desktop -- electron/ipc/db-manager.test.js`
Expected: FAIL with `No handler for db-manager:get-columns`

- [ ] **Step 3: Implement `handleGetColumns` and register it**

In `apps/desktop/electron/ipc/db-manager.cjs`, add a new handler function inside `makeHandlers(drivers)`, placed after `handleUpdateCell` and before `handleRunQuery` (i.e. after line 192's closing `}`):

```js
  async function handleGetColumns(_e, { type, config, table }) {
    validateIdentifier(table)

    if (type === 'sqlserver') {
      const pool = await getSqlPool(config, drivers)
      const result = await pool.request()
        .input('table', table)
        .query(`
          SELECT c.COLUMN_NAME AS name, c.DATA_TYPE AS dataType,
                 CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS isPrimaryKey
          FROM INFORMATION_SCHEMA.COLUMNS c
          LEFT JOIN (
            SELECT ku.COLUMN_NAME, ku.TABLE_NAME
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
            JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
              ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
             AND tc.TABLE_NAME = ku.TABLE_NAME
            WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
          ) pk ON pk.COLUMN_NAME = c.COLUMN_NAME AND pk.TABLE_NAME = c.TABLE_NAME
          WHERE c.TABLE_NAME = @table
          ORDER BY c.ORDINAL_POSITION
        `)
      return {
        ok: true,
        columns: result.recordset.map(r => ({
          name: r.name, dataType: r.dataType, isPrimaryKey: !!r.isPrimaryKey,
        })),
      }
    }

    if (type === 'sqlite') {
      const db = getSqliteDb(config.filePath, drivers)
      const rows = db.prepare(`PRAGMA table_info("${table}")`).all()
      return {
        ok: true,
        columns: rows.map(r => ({ name: r.name, dataType: r.type, isPrimaryKey: r.pk > 0 })),
      }
    }

    throw new Error(`Unknown database type: ${type}`)
  }
```

Update the `makeHandlers` return statement (line 224) to include it:

```js
  return { handleConnect, handleGetRows, handleDeleteRows, handleUpdateCell, handleGetColumns, handleRunQuery }
```

Register the channel in `register()` (after line 257's `handle('db-manager:update-cell', ...)`):

```js
  handle('db-manager:get-columns', handlers.handleGetColumns)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w apps/desktop -- electron/ipc/db-manager.test.js`
Expected: PASS, all tests in the file green

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/ipc/db-manager.cjs apps/desktop/electron/ipc/db-manager.test.js
git commit -m "feat(db-manager): add getColumns IPC handler for table schema lookup"
```

---

### Task 2: Expose `getColumns` through preload and the renderer adapter

**Files:**
- Modify: `apps/desktop/electron/preload.cjs:122-134`
- Modify: `apps/desktop/src/adapters/db-manager.js`

**Interfaces:**
- Consumes: IPC channel `'db-manager:get-columns'` from Task 1.
- Produces: `window.electronAPI.dbManager.getColumns(type, config, table)` and `dbManagerAdapter.getColumns(type, config, table)` → `Promise<{ ok: boolean, columns: {name, dataType, isPrimaryKey}[] }>`.

There is no dedicated test file for either of these two thin wrapper files today (`db-manager.js` has no `.test.js` — it's only exercised indirectly through `ViewDbManager.test.jsx`'s fake adapter). This task has no new automated test of its own; Task 5 onward exercise it through the UI's fake-adapter tests.

- [ ] **Step 1: Add the preload method**

In `apps/desktop/electron/preload.cjs`, inside the `dbManager: { ... }` block (after line 133's `runQuery` entry):

```js
    getColumns: (type, config, table) =>
      ipcRenderer.invoke('db-manager:get-columns', { type, config, table }),
```

- [ ] **Step 2: Add the adapter method**

In `apps/desktop/src/adapters/db-manager.js`, after the `runQuery` method (after line 85's closing `},`):

```js
  /**
   * Fetch column metadata for a table.
   * @param {'sqlserver'|'sqlite'} type
   * @param {object} config
   * @param {string} table
   * @returns {Promise<{ ok: boolean, columns: { name: string, dataType: string, isPrimaryKey: boolean }[] }>}
   */
  getColumns(type, config, table) {
    return api().getColumns(type, config, table)
  },
```

- [ ] **Step 3: Verify no existing test broke**

Run: `npm run test -w apps/desktop`
Expected: PASS (no test exercises these two files directly; this just confirms nothing else references the object shape in a way that breaks)

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/electron/preload.cjs apps/desktop/src/adapters/db-manager.js
git commit -m "feat(db-manager): wire getColumns through preload and renderer adapter"
```

---

### Task 3: Widen the query textarea's write guardrail to allow INSERT/UPDATE

**Files:**
- Modify: `apps/desktop/electron/ipc/db-manager.cjs:194-199`
- Modify: `apps/desktop/electron/ipc/db-manager.test.js:121-125`

**Interfaces:**
- Produces: `handleRunQuery` now accepts `SELECT`, `WITH`, `DELETE`, `INSERT`, `UPDATE` prefixes (previously only the first three).

- [ ] **Step 1: Update the existing test that asserts INSERT is blocked, and add new passing-case tests**

In `apps/desktop/electron/ipc/db-manager.test.js`, replace the `'run-query blocks INSERT'` test (lines 121–125) with:

```js
  it('run-query allows INSERT', async () => {
    const result = await ipc._invoke('db-manager:run-query', {
      ...cfg, sql: "INSERT INTO users (id, name) VALUES (99, 'x')",
    })
    expect(result.affected).toBe(2)
  })

  it('run-query allows UPDATE', async () => {
    const result = await ipc._invoke('db-manager:run-query', {
      ...cfg, sql: "UPDATE users SET name = 'y' WHERE id = 1",
    })
    expect(result.affected).toBe(2)
  })

  it('run-query blocks unrelated statements', async () => {
    await expect(
      ipc._invoke('db-manager:run-query', { ...cfg, sql: 'DROP TABLE users' }),
    ).rejects.toThrow('Only SELECT')
  })
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm run test -w apps/desktop -- electron/ipc/db-manager.test.js`
Expected: FAIL — `run-query allows INSERT` and `run-query allows UPDATE` reject with "Only SELECT..." since `ALLOWED` doesn't include them yet

- [ ] **Step 3: Widen `ALLOWED`**

In `apps/desktop/electron/ipc/db-manager.cjs`, change line 196:

```js
    const ALLOWED = ['SELECT', 'WITH', 'DELETE']
```

to:

```js
    const ALLOWED = ['SELECT', 'WITH', 'DELETE', 'INSERT', 'UPDATE']
```

and update the error message on line 198 to match:

```js
      throw new Error('Only SELECT, WITH (CTE), DELETE, INSERT, and UPDATE statements are permitted.')
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w apps/desktop -- electron/ipc/db-manager.test.js`
Expected: PASS, all tests in the file green

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/ipc/db-manager.cjs apps/desktop/electron/ipc/db-manager.test.js
git commit -m "feat(db-manager): allow INSERT and UPDATE through the query textarea"
```

---

### Task 4: SQL builder pure functions

**Files:**
- Create: `packages/core/src/modules/db-manager/query-builders.js`
- Create: `packages/core/src/modules/db-manager/query-builders.test.js`
- Modify: `packages/core/src/index.js:66-71`

**Interfaces:**
- Produces:
  - `formatSqlValue(raw: string|number|null|undefined): string`
  - `formatCondition({ column: string, operator: string, value?: string }): string`
  - `buildSearchQuery(table: string, conditions?: {column,operator,value}[], combinator?: 'AND'|'OR'): string`
  - `buildInsertQuery(table: string, columns: {name: string, value: string}[]): string`
  - `buildUpdateQuery(table: string, setColumns: {name: string, value: string}[], conditions?: {column,operator,value}[], combinator?: 'AND'|'OR'): string`
  - `buildDeleteQuery(table: string, conditions?: {column,operator,value}[], combinator?: 'AND'|'OR'): string`
  - `buildJoinQuery(leftTable: string, rightTable: string, joinType: 'INNER'|'LEFT'|'RIGHT', leftColumn: string, rightColumn: string): string`
  - `buildAggregateQuery(table: string, aggregates: {fn: 'COUNT'|'SUM'|'AVG'|'MIN'|'MAX', column: string}[], groupByColumns?: string[]): string`
- Consumed by: Tasks 7–11 (UI builder subcomponents).

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/modules/db-manager/query-builders.test.js`:

```js
import { describe, it, expect } from 'vitest'
import {
  formatSqlValue, formatCondition,
  buildSearchQuery, buildInsertQuery, buildUpdateQuery, buildDeleteQuery,
  buildJoinQuery, buildAggregateQuery,
} from './query-builders.js'

describe('formatSqlValue', () => {
  it('returns NULL for null, undefined, or empty string', () => {
    expect(formatSqlValue(null)).toBe('NULL')
    expect(formatSqlValue(undefined)).toBe('NULL')
    expect(formatSqlValue('')).toBe('NULL')
  })

  it('leaves integer and decimal strings unquoted', () => {
    expect(formatSqlValue('42')).toBe('42')
    expect(formatSqlValue('-3.5')).toBe('-3.5')
  })

  it('quotes non-numeric strings', () => {
    expect(formatSqlValue('active')).toBe("'active'")
  })

  it('doubles embedded single quotes', () => {
    expect(formatSqlValue("O'Brien")).toBe("'O''Brien'")
  })
})

describe('formatCondition', () => {
  it('formats a comparison condition', () => {
    expect(formatCondition({ column: 'status', operator: '=', value: 'active' }))
      .toBe("status = 'active'")
  })

  it('formats IS NULL without a value', () => {
    expect(formatCondition({ column: 'deleted_at', operator: 'IS NULL' }))
      .toBe('deleted_at IS NULL')
  })
})

describe('buildSearchQuery', () => {
  it('builds a plain SELECT * with no conditions', () => {
    expect(buildSearchQuery('patients', [])).toBe('SELECT * FROM patients')
  })

  it('builds a WHERE clause with one condition', () => {
    expect(buildSearchQuery('patients', [{ column: 'status', operator: '=', value: 'active' }]))
      .toBe("SELECT * FROM patients\nWHERE status = 'active'")
  })

  it('joins multiple conditions with the given combinator', () => {
    const sql = buildSearchQuery('patients', [
      { column: 'status', operator: '=', value: 'active' },
      { column: 'age', operator: '>', value: '18' },
    ], 'OR')
    expect(sql).toBe("SELECT * FROM patients\nWHERE status = 'active' OR age > 18")
  })
})

describe('buildInsertQuery', () => {
  it('builds an INSERT with the given columns and values', () => {
    const sql = buildInsertQuery('patients', [
      { name: 'name', value: 'Alice' },
      { name: 'age', value: '30' },
    ])
    expect(sql).toBe("INSERT INTO patients (name, age) VALUES ('Alice', 30)")
  })
})

describe('buildUpdateQuery', () => {
  it('builds an UPDATE with SET and WHERE clauses', () => {
    const sql = buildUpdateQuery(
      'patients',
      [{ name: 'status', value: 'inactive' }],
      [{ column: 'id', operator: '=', value: '1' }],
    )
    expect(sql).toBe("UPDATE patients SET status = 'inactive'\nWHERE id = 1")
  })

  it('omits WHERE when there are no conditions', () => {
    const sql = buildUpdateQuery('patients', [{ name: 'status', value: 'inactive' }], [])
    expect(sql).toBe("UPDATE patients SET status = 'inactive'")
  })
})

describe('buildDeleteQuery', () => {
  it('builds a DELETE with a WHERE clause', () => {
    expect(buildDeleteQuery('patients', [{ column: 'id', operator: '=', value: '1' }]))
      .toBe('DELETE FROM patients\nWHERE id = 1')
  })

  it('omits WHERE when there are no conditions', () => {
    expect(buildDeleteQuery('patients', [])).toBe('DELETE FROM patients')
  })
})

describe('buildJoinQuery', () => {
  it('builds an INNER JOIN on the given columns', () => {
    const sql = buildJoinQuery('patients', 'appointments', 'INNER', 'id', 'patient_id')
    expect(sql).toBe('SELECT * FROM patients\nINNER JOIN appointments ON patients.id = appointments.patient_id')
  })

  it('builds a LEFT JOIN', () => {
    const sql = buildJoinQuery('patients', 'appointments', 'LEFT', 'id', 'patient_id')
    expect(sql).toContain('LEFT JOIN appointments')
  })
})

describe('buildAggregateQuery', () => {
  it('builds a SELECT with one aggregate and no GROUP BY', () => {
    expect(buildAggregateQuery('patients', [{ fn: 'COUNT', column: 'id' }], []))
      .toBe('SELECT COUNT(id) FROM patients')
  })

  it('builds a SELECT with multiple aggregates and a GROUP BY', () => {
    const sql = buildAggregateQuery(
      'appointments',
      [{ fn: 'COUNT', column: 'appt_id' }],
      ['status'],
    )
    expect(sql).toBe('SELECT COUNT(appt_id), status FROM appointments\nGROUP BY status')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w packages/core -- query-builders.test.js`
Expected: FAIL with "Failed to resolve import ./query-builders.js"

- [ ] **Step 3: Implement the builder functions**

Create `packages/core/src/modules/db-manager/query-builders.js`:

```js
// packages/core/src/modules/db-manager/query-builders.js
//
// Pure SQL-string generators for the Query tab's guided command builders
// (Search, Insert, Update, Delete, Join, Aggregate). No DOM, no I/O — table
// and column names passed in are expected to come from session.tables /
// getColumns() (schema-derived), never freeform user text.

/**
 * Format a raw form value as a SQL literal. Blank/nullish input becomes
 * NULL (a guided form field left empty means "no value", not the string
 * "undefined"); integer/decimal-looking strings are left unquoted so
 * numeric columns don't get quoted numbers.
 */
export function formatSqlValue(raw) {
  if (raw === null || raw === undefined || raw === '') return 'NULL'
  const trimmed = String(raw).trim()
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed
  return `'${trimmed.replace(/'/g, "''")}'`
}

/** Format one WHERE-clause condition row. */
export function formatCondition({ column, operator, value }) {
  if (operator === 'IS NULL') return `${column} IS NULL`
  return `${column} ${operator} ${formatSqlValue(value)}`
}

function whereClause(conditions, combinator) {
  if (!conditions.length) return ''
  return `\nWHERE ${conditions.map(formatCondition).join(` ${combinator} `)}`
}

export function buildSearchQuery(table, conditions = [], combinator = 'AND') {
  return `SELECT * FROM ${table}${whereClause(conditions, combinator)}`
}

export function buildInsertQuery(table, columns) {
  const names  = columns.map(c => c.name).join(', ')
  const values = columns.map(c => formatSqlValue(c.value)).join(', ')
  return `INSERT INTO ${table} (${names}) VALUES (${values})`
}

export function buildUpdateQuery(table, setColumns, conditions = [], combinator = 'AND') {
  const setClause = setColumns.map(c => `${c.name} = ${formatSqlValue(c.value)}`).join(', ')
  return `UPDATE ${table} SET ${setClause}${whereClause(conditions, combinator)}`
}

export function buildDeleteQuery(table, conditions = [], combinator = 'AND') {
  return `DELETE FROM ${table}${whereClause(conditions, combinator)}`
}

export function buildJoinQuery(leftTable, rightTable, joinType, leftColumn, rightColumn) {
  return `SELECT * FROM ${leftTable}\n${joinType} JOIN ${rightTable} ON `
    + `${leftTable}.${leftColumn} = ${rightTable}.${rightColumn}`
}

export function buildAggregateQuery(table, aggregates, groupByColumns = []) {
  const selectCols = [
    ...aggregates.map(a => `${a.fn}(${a.column})`),
    ...groupByColumns,
  ].join(', ')
  const base = `SELECT ${selectCols} FROM ${table}`
  return groupByColumns.length ? `${base}\nGROUP BY ${groupByColumns.join(', ')}` : base
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w packages/core -- query-builders.test.js`
Expected: PASS, all tests green

- [ ] **Step 5: Export the new functions from the core package**

In `packages/core/src/index.js`, after line 71's `} from './modules/db-manager/index.js'`, add:

```js
export {
  formatSqlValue, formatCondition,
  buildSearchQuery, buildInsertQuery, buildUpdateQuery, buildDeleteQuery,
  buildJoinQuery, buildAggregateQuery,
} from './modules/db-manager/query-builders.js'
```

- [ ] **Step 6: Run the full core test suite**

Run: `npm run test -w packages/core`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/modules/db-manager/query-builders.js packages/core/src/modules/db-manager/query-builders.test.js packages/core/src/index.js
git commit -m "feat(db-manager): add pure SQL builder functions for guided query commands"
```

---

### Task 5: `TableSelect` component — replace the sidebar table list

**Files:**
- Modify: `packages/ui/src/views/ViewDbManager.jsx`
- Modify: `packages/ui/src/styles/ViewDbManager.css`
- Modify: `packages/ui/src/views/ViewDbManager.test.jsx`

**Interfaces:**
- Produces: `TableSelect({ id, tables, value, onChange, placeholder? })` — a function component rendering a native `<select>`. Reused by Task 6 in the Query tab.
- Consumes: nothing new from earlier tasks (uses existing `session.tables`, `dbState.selectedTable`, `loadTable`).

This task removes the collapsible "Tables" nav-of-buttons behavior (tested today by `'the Tables section is expanded by default and can be collapsed'` in `ViewDbManager.test.jsx:262-272`) — a dropdown has nothing to expand or collapse, so that test is replaced rather than kept. The "Databases" section's own collapsible behavior is untouched.

- [ ] **Step 1: Write the failing test**

In `packages/ui/src/views/ViewDbManager.test.jsx`, inside `describe('ViewDbManager — collapsible sidebar sections', ...)`, replace the `'the Tables section is expanded by default and can be collapsed'` test (lines 262–272) with:

```js
  it('lists tables in a dropdown and selects one on change', async () => {
    render(<ViewDbManager adapters={adapters} />)
    await connectDemo()

    const select = screen.getByLabelText('Tables')
    expect(select.tagName).toBe('SELECT')
    expect(screen.getByText('patients').tagName).toBe('OPTION')

    fireEvent.change(select, { target: { value: 'staff' } })
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy())
    expect(select.value).toBe('staff')
  })
```

Then, everywhere else in the file that does `fireEvent.click(screen.getByText('patients'))` to select a table (the `describe('ViewDbManager', ...)` block's `'shows table rows when a table is selected'`, `'filters rows by search term'`, `'shows delete button when rows are selected'`, `'shows confirmation dialog before deleting'`, `'switches to query tab and runs a query'` tests, and the `connectDemo` helper's callers in the collapsible-sections `describe` block), replace:

```js
fireEvent.click(screen.getByText('patients'))
```

with:

```js
fireEvent.change(screen.getByLabelText('Tables'), { target: { value: 'patients' } })
```

(There is no `connectDemo`-internal table click to change — `connectDemo` only loads the demo and waits for `'patients'` to appear; leave it as-is. Only the *subsequent* `fireEvent.click(screen.getByText('patients'))` calls in each test body need the substitution above.)

Also update `'switches to a different saved database directly from the sidebar'` (line 293) — it clicks `'UAT'` (a *database*, not a table) via `screen.getByText('UAT')`; that stays a `fireEvent.click` since the Databases section is untouched.

- [ ] **Step 2: Run tests to verify the new/changed ones fail**

Run: `npm run test -w packages/ui -- ViewDbManager.test.jsx`
Expected: FAIL — `getByLabelText('Tables')` finds nothing yet (sidebar still renders buttons, not a labeled select)

- [ ] **Step 3: Implement `TableSelect` and wire it into the sidebar**

In `packages/ui/src/views/ViewDbManager.jsx`, remove the `tablesExpanded` state (line 86: `const [tablesExpanded, setTablesExpanded] = useState(true)`) — it's no longer needed.

Replace the Tables section block (lines 323–347):

```jsx
            <div className="db-sidebar__section db-sidebar__section--fill">
              <button
                className="db-sidebar__section-toggle"
                onClick={() => setTablesExpanded(v => !v)}
                aria-expanded={tablesExpanded}
              >
                <span className={`db-icon db-icon--chevron-${tablesExpanded ? 'down' : 'right'}`} aria-hidden="true" />
                <span className="db-sidebar__section-label">Tables</span>
              </button>
              {tablesExpanded && (
                <nav className="db-sidebar__tables" aria-label="Tables">
                  {session.tables.map(t => (
                    <button
                      key={t}
                      className={`db-table-btn${dbState.selectedTable === t ? ' db-table-btn--active' : ''}`}
                      onClick={() => loadTable(t)}
                      aria-current={dbState.selectedTable === t ? 'page' : undefined}
                    >
                      <span className="db-icon db-icon--table" aria-hidden="true" />
                      <span className="db-table-btn__label">{t}</span>
                    </button>
                  ))}
                </nav>
              )}
            </div>
```

with:

```jsx
            <div className="db-sidebar__section db-sidebar__section--fill">
              <label className="db-sidebar__section-label" htmlFor="db-sidebar-table-select">Tables</label>
              <TableSelect
                id="db-sidebar-table-select"
                tables={session.tables}
                value={dbState.selectedTable ?? ''}
                onChange={loadTable}
              />
            </div>
```

Add the `TableSelect` component near the other shared primitives at the bottom of the file (after `CellValue`, before `ConfirmDialog`, i.e. after line 855's closing `}`):

```jsx
// ─── Table select (shared: sidebar + Query tab) ───────────────────────────────

function TableSelect({ id, tables, value, onChange, placeholder = 'Select a table…' }) {
  return (
    <select
      id={id}
      aria-label="Tables"
      className="db-input db-table-select"
      value={value}
      onChange={e => onChange(e.target.value)}
    >
      <option value="" disabled>{placeholder}</option>
      {tables.map(t => (
        <option key={t} value={t}>{t}</option>
      ))}
    </select>
  )
}
```

- [ ] **Step 4: Add minimal CSS for the dropdown**

In `packages/ui/src/styles/ViewDbManager.css`, after the `.db-sidebar__tables` rule (around line 74), add:

```css
.db-table-select {
  width: 100%;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w packages/ui -- ViewDbManager.test.jsx`
Expected: PASS, all tests in the file green

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/views/ViewDbManager.jsx packages/ui/src/styles/ViewDbManager.css packages/ui/src/views/ViewDbManager.test.jsx
git commit -m "feat(db-manager): replace sidebar table list with a dropdown"
```

---

### Task 6: Wire `TableSelect` into the Query tab with auto-populate

**Files:**
- Modify: `packages/ui/src/views/ViewDbManager.jsx`
- Modify: `packages/ui/src/views/ViewDbManager.test.jsx`

**Interfaces:**
- Consumes: `TableSelect` from Task 5.
- Produces: new `queryTable` state and `handleQueryTableSelect(name)` callback in `ViewDbManager`; `QueryPanel` gains `queryTable`/`onSelectTable` props. `queryTable` is the table Task 7+'s command builders will target.

- [ ] **Step 1: Write the failing test**

In `packages/ui/src/views/ViewDbManager.test.jsx`, replace the `'switches to query tab and runs a query'` test (lines 155–168) with:

```js
  it('auto-populates SELECT * FROM <table> when a table is chosen in the Query tab', async () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('Load demo'))
    await waitFor(() => screen.getByText('patients'))
    fireEvent.change(screen.getByLabelText('Tables'), { target: { value: 'patients' } })
    await waitFor(() => screen.getByRole('table'))

    fireEvent.click(screen.getByRole('tab', { name: 'Query' }))
    const tableSelects = screen.getAllByLabelText('Tables')
    const queryTableSelect = tableSelects[tableSelects.length - 1]
    fireEvent.change(queryTableSelect, { target: { value: 'staff' } })

    expect(screen.getByLabelText('SQL query').value).toBe('SELECT * FROM staff')
  })

  it('switches to query tab and runs a query', async () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('Load demo'))
    await waitFor(() => screen.getByText('patients'))
    fireEvent.change(screen.getByLabelText('Tables'), { target: { value: 'patients' } })
    await waitFor(() => screen.getByRole('table'))

    fireEvent.click(screen.getByRole('tab', { name: 'Query' }))
    fireEvent.change(screen.getByLabelText('SQL query'), { target: { value: 'SELECT * FROM patients' } })
    fireEvent.click(screen.getByText('Run query'))

    await waitFor(() => expect(screen.getByText(/rows returned/i)).toBeTruthy())
  })
```

- [ ] **Step 2: Run tests to verify the new one fails**

Run: `npm run test -w packages/ui -- ViewDbManager.test.jsx`
Expected: FAIL — the Query tab still shows a text hint, not a second `TableSelect`, so `getAllByLabelText('Tables')` returns only one element

- [ ] **Step 3: Add `queryTable` state and wire it through**

In `packages/ui/src/views/ViewDbManager.jsx`, add new state near `sqlQuery` (after line 80: `const [sqlQuery, setSqlQuery] = useState('')`):

```jsx
  const [queryTable, setQueryTable] = useState(null)
```

Add a handler near `runQuery` (before the `// ── Query ──` block at line 236, or directly above `runQuery`):

```jsx
  const handleQueryTableSelect = useCallback((name) => {
    setQueryTable(name)
    setSqlQuery(`SELECT * FROM ${name}`)
  }, [])
```

Update the `QueryPanel` invocation (lines 422–430):

```jsx
                {activeTab === 'query' && (
                  <QueryPanel
                    tables={session.tables}
                    queryTable={queryTable ?? dbState.selectedTable}
                    onSelectTable={handleQueryTableSelect}
                    sqlQuery={sqlQuery}
                    onSqlChange={setSqlQuery}
                    queryResult={queryResult}
                    onRun={runQuery}
                  />
                )}
```

Update the `QueryPanel` function signature and its table hint (lines 785–799):

```jsx
function QueryPanel({ tables, queryTable, onSelectTable, sqlQuery, onSqlChange, queryResult, onRun }) {
  return (
    <div className="db-query">
      <div className="db-query__editor">
        <div className="db-field">
          <label className="db-label" htmlFor="db-query-table-select">Table</label>
          <TableSelect
            id="db-query-table-select"
            tables={tables}
            value={queryTable ?? ''}
            onChange={onSelectTable}
          />
        </div>
        <textarea
          className="db-textarea db-textarea--mono db-textarea--query"
          value={sqlQuery}
          onChange={e => onSqlChange(e.target.value)}
          placeholder={'SELECT * FROM patients\nWHERE status = \'active\''}
          rows={6}
          onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') onRun() }}
          aria-label="SQL query"
          spellCheck={false}
        />
        <div className="db-query__toolbar">
          <span className="db-hint">Ctrl+Enter to run</span>
          <button className="db-btn db-btn--primary" onClick={onRun}>
            <span className="db-icon db-icon--play" aria-hidden="true" />
            Run query
          </button>
        </div>
      </div>
```

(This drops the now-inaccurate `· SELECT and DELETE only` hint text, since Task 3 widened what the textarea can run.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w packages/ui -- ViewDbManager.test.jsx`
Expected: PASS, all tests in the file green

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/ViewDbManager.jsx packages/ui/src/views/ViewDbManager.test.jsx
git commit -m "feat(db-manager): auto-populate SELECT * FROM <table> from the Query tab dropdown"
```

---

### Task 7: `QueryCommandToolbar`, `ConditionRow`, and the Search/Delete builders

**Files:**
- Modify: `packages/ui/src/views/ViewDbManager.jsx`
- Modify: `packages/ui/src/styles/ViewDbManager.css`
- Modify: `packages/ui/src/views/ViewDbManager.test.jsx`

**Interfaces:**
- Consumes: `dbManagerAdapter.getColumns` (Task 2, via `adapters.dbManager.getColumns` — must be added to the test file's `makeAdapter()`), `buildSearchQuery`/`buildDeleteQuery` (Task 4), `queryTable` (Task 6).
- Produces: `tableColumns` cache state + `fetchColumnsFor(table)` helper, `activeBuilder` state, `QueryCommandToolbar`, `ConditionRow`, `QueryBuilderPanel`, `SearchBuilder`, `DeleteBuilder` — all reused/extended by Tasks 8–11.

- [ ] **Step 1: Write the failing tests**

In `packages/ui/src/views/ViewDbManager.test.jsx`, add `getColumns` to `makeAdapter()` (after line 18's `runQuery` entry):

```js
    getColumns: vi.fn().mockResolvedValue({
      ok: true,
      columns: [
        { name: 'id', dataType: 'INTEGER', isPrimaryKey: true },
        { name: 'name', dataType: 'TEXT', isPrimaryKey: false },
        { name: 'status', dataType: 'TEXT', isPrimaryKey: false },
      ],
    }),
```

Add a new `describe` block at the end of the file (after the collapsible-sidebar-sections block's closing `})`):

```js
describe('ViewDbManager — query command builders', () => {
  let adapters

  beforeEach(() => {
    adapters = { dbManager: makeAdapter() }
  })

  afterEach(() => { cleanup() })

  const openQueryTabForPatients = async () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('Load demo'))
    await waitFor(() => screen.getByText('patients'))
    fireEvent.change(screen.getByLabelText('Tables'), { target: { value: 'patients' } })
    await waitFor(() => screen.getByRole('table'))
    fireEvent.click(screen.getByRole('tab', { name: 'Query' }))
    const tableSelects = screen.getAllByLabelText('Tables')
    fireEvent.change(tableSelects[tableSelects.length - 1], { target: { value: 'patients' } })
  }

  it('builds a SEARCH query from a condition row', async () => {
    await openQueryTabForPatients()

    fireEvent.click(screen.getByText('Search'))
    await waitFor(() => screen.getByLabelText('Column'))

    fireEvent.change(screen.getByLabelText('Column'), { target: { value: 'status' } })
    fireEvent.change(screen.getByLabelText('Operator'), { target: { value: '=' } })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'active' } })
    fireEvent.click(screen.getByText('Build'))

    expect(screen.getByLabelText('SQL query').value).toBe("SELECT * FROM patients\nWHERE status = 'active'")
  })

  it('fetches column metadata through the adapter for a real (non-demo) connection', async () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('SQLite'))
    fireEvent.click(screen.getByRole('tab', { name: 'Connection string' }))
    fireEvent.change(screen.getByLabelText(/connection string/i), {
      target: { value: 'sqlite:///test/data.db' },
    })
    fireEvent.click(screen.getByText('Connect'))
    await waitFor(() => screen.getByText('patients'))
    fireEvent.change(screen.getByLabelText('Tables'), { target: { value: 'patients' } })
    await waitFor(() => screen.getByRole('table'))

    fireEvent.click(screen.getByRole('tab', { name: 'Query' }))
    const tableSelects = screen.getAllByLabelText('Tables')
    fireEvent.change(tableSelects[tableSelects.length - 1], { target: { value: 'patients' } })
    fireEvent.click(screen.getByText('Search'))

    await waitFor(() => expect(adapters.dbManager.getColumns).toHaveBeenCalledWith(
      'sqlite', expect.objectContaining({ filePath: 'test/data.db' }), 'patients',
    ))
    expect(screen.getByLabelText('Column')).toBeTruthy()
  })

  it('builds a DELETE query from a condition row', async () => {
    await openQueryTabForPatients()

    fireEvent.click(screen.getByText('Delete'))
    await waitFor(() => screen.getByLabelText('Column'))

    fireEvent.change(screen.getByLabelText('Column'), { target: { value: 'id' } })
    fireEvent.change(screen.getByLabelText('Operator'), { target: { value: '=' } })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '1' } })
    fireEvent.click(screen.getByText('Build'))

    expect(screen.getByLabelText('SQL query').value).toBe('DELETE FROM patients\nWHERE id = 1')
  })

  it('closes the builder panel when its command button is clicked again', async () => {
    await openQueryTabForPatients()

    fireEvent.click(screen.getByText('Search'))
    await waitFor(() => screen.getByLabelText('Column'))
    fireEvent.click(screen.getByText('Search'))
    expect(screen.queryByLabelText('Column')).not.toBeTruthy()
  })

  it('cancel closes the panel without changing the textarea', async () => {
    await openQueryTabForPatients()
    const before = screen.getByLabelText('SQL query').value

    fireEvent.click(screen.getByText('Search'))
    await waitFor(() => screen.getByLabelText('Column'))
    fireEvent.click(screen.getByText('Cancel'))

    expect(screen.queryByLabelText('Column')).not.toBeTruthy()
    expect(screen.getByLabelText('SQL query').value).toBe(before)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w packages/ui -- ViewDbManager.test.jsx`
Expected: FAIL — `screen.getByText('Search')` finds nothing (no toolbar yet)

- [ ] **Step 3: Add core imports, state, and column-fetch helper**

In `packages/ui/src/views/ViewDbManager.jsx`, update the `@nexusmd/core` import (lines 21–32) to add the builder functions:

```jsx
import {
  resolveConnectionParams,
  buildConfig,
  createInitialState,
  applyConnected,
  applyDisconnected,
  applyTableSelected,
  applyTableLoaded,
  applyRowsDeleted,
  applyCellUpdated,
  applyError,
  buildSearchQuery,
  buildDeleteQuery,
} from '@nexusmd/core'
```

Add state after `queryTable` (from Task 6):

```jsx
  const [tableColumns, setTableColumns] = useState({})   // { [table]: Column[] }
  const [columnsLoading, setColumnsLoading] = useState(false)
  const [activeBuilder, setActiveBuilder] = useState(null)   // 'search' | 'delete' | null
```

Add a lazy-fetch helper after `handleQueryTableSelect` (from Task 6):

```jsx
  const ensureColumnsLoaded = useCallback(async (table) => {
    if (!table || tableColumns[table]) return
    setColumnsLoading(true)
    try {
      if (dbState.session?.type === 'demo') {
        // DEMO.data[table] already has a `columns` array (see lines 43, 52, 61) —
        // treat its first entry as the primary key, matching the real-DB
        // getColumns() shape closely enough for the builders to consume.
        const demoCols = (demoData.current[table]?.columns ?? []).map((name, i) => ({
          name, dataType: 'TEXT', isPrimaryKey: i === 0,
        }))
        setTableColumns(prev => ({ ...prev, [table]: demoCols }))
        return
      }
      const { type, config } = dbState.session
      const result = await db.getColumns(type, config, table)
      setTableColumns(prev => ({ ...prev, [table]: result.columns }))
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setColumnsLoading(false)
    }
  }, [db, dbState.session, tableColumns, notify])

  const toggleBuilder = useCallback(async (name) => {
    setActiveBuilder(prev => (prev === name ? null : name))
    // Mirrors the same `queryTable ?? dbState.selectedTable` fallback QueryPanel
    // displays — without it, opening a builder before ever touching the Query
    // tab's own dropdown would try to load columns for `null`.
    const target = queryTable ?? dbState.selectedTable
    if (activeBuilder !== name) await ensureColumnsLoaded(target)
  }, [activeBuilder, ensureColumnsLoaded, queryTable, dbState.selectedTable])

  const applyBuiltSql = useCallback((sql) => {
    setSqlQuery(sql)
    setActiveBuilder(null)
  }, [])
```

- [ ] **Step 4: Add `QueryCommandToolbar`, `ConditionRow`, `QueryBuilderPanel`, `SearchBuilder`, `DeleteBuilder`**

Add these after the `TableSelect` component (from Task 5):

```jsx
// ─── Query command toolbar + builder panel ─────────────────────────────────────

const COMMANDS = [
  ['search', 'Search'], ['insert', 'Insert'], ['update', 'Update'],
  ['delete', 'Delete'], ['join', 'Join'], ['aggregate', 'Aggregate'],
]

function QueryCommandToolbar({ activeBuilder, onToggle, disabled }) {
  return (
    <div className="db-query__toolbar db-query__command-toolbar" role="group" aria-label="Query commands">
      {COMMANDS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={`db-btn db-btn--sm${activeBuilder === id ? ' db-btn--active' : ''}`}
          onClick={() => onToggle(id)}
          disabled={disabled}
          title={disabled ? 'Select a table first' : undefined}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

const OPERATORS = ['=', '!=', '>', '<', 'LIKE', 'IS NULL']

function ConditionRow({ columns, condition, onChange }) {
  return (
    <div className="db-condition-row">
      <select
        aria-label="Column"
        className="db-input"
        value={condition.column}
        onChange={e => onChange({ ...condition, column: e.target.value })}
      >
        <option value="" disabled>Column…</option>
        {columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
      </select>
      <select
        aria-label="Operator"
        className="db-input"
        value={condition.operator}
        onChange={e => onChange({ ...condition, operator: e.target.value })}
      >
        {OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
      </select>
      {condition.operator !== 'IS NULL' && (
        <input
          aria-label="Value"
          className="db-input"
          type="text"
          value={condition.value}
          onChange={e => onChange({ ...condition, value: e.target.value })}
        />
      )}
    </div>
  )
}

function BuilderFooter({ onBuild, onCancel, buildDisabled }) {
  return (
    <div className="db-builder__footer">
      <button type="button" className="db-btn db-btn--ghost" onClick={onCancel}>Cancel</button>
      <button type="button" className="db-btn db-btn--primary" onClick={onBuild} disabled={buildDisabled}>
        Build
      </button>
    </div>
  )
}

function SearchBuilder({ table, columns, onBuild, onCancel }) {
  const [conditions, setConditions] = useState([{ column: '', operator: '=', value: '' }])
  const updateCondition = (i, next) => setConditions(cs => cs.map((c, idx) => idx === i ? next : c))

  const valid = conditions.every(c => c.column && (c.operator === 'IS NULL' || c.value !== ''))

  return (
    <div className="db-builder">
      {conditions.map((c, i) => (
        <ConditionRow key={i} columns={columns} condition={c} onChange={next => updateCondition(i, next)} />
      ))}
      <button type="button" className="db-btn db-btn--ghost db-btn--sm"
        onClick={() => setConditions(cs => [...cs, { column: '', operator: '=', value: '' }])}>
        + Add condition
      </button>
      <BuilderFooter
        buildDisabled={!valid}
        onCancel={onCancel}
        onBuild={() => onBuild(buildSearchQuery(table, conditions.filter(c => c.column)))}
      />
    </div>
  )
}

function DeleteBuilder({ table, columns, onBuild, onCancel }) {
  const [conditions, setConditions] = useState([{ column: '', operator: '=', value: '' }])
  const updateCondition = (i, next) => setConditions(cs => cs.map((c, idx) => idx === i ? next : c))

  const valid = conditions.length > 0
    && conditions.every(c => c.column && (c.operator === 'IS NULL' || c.value !== ''))

  return (
    <div className="db-builder">
      {conditions.map((c, i) => (
        <ConditionRow key={i} columns={columns} condition={c} onChange={next => updateCondition(i, next)} />
      ))}
      <button type="button" className="db-btn db-btn--ghost db-btn--sm"
        onClick={() => setConditions(cs => [...cs, { column: '', operator: '=', value: '' }])}>
        + Add condition
      </button>
      <BuilderFooter
        buildDisabled={!valid}
        onCancel={onCancel}
        onBuild={() => onBuild(buildDeleteQuery(table, conditions.filter(c => c.column)))}
      />
    </div>
  )
}

function QueryBuilderPanel({ activeBuilder, table, columns, columnsLoading, onBuild, onCancel }) {
  if (!activeBuilder) return null
  if (columnsLoading) return <p className="db-hint">Loading columns…</p>

  const props = { table, columns, onBuild, onCancel }
  if (activeBuilder === 'search') return <SearchBuilder {...props} />
  if (activeBuilder === 'delete') return <DeleteBuilder {...props} />
  return null
}
```

- [ ] **Step 5: Wire the toolbar and panel into `QueryPanel`**

Update the `QueryPanel` function signature and JSX (built on top of Task 6's version):

```jsx
function QueryPanel({
  tables, queryTable, onSelectTable, sqlQuery, onSqlChange, queryResult, onRun,
  activeBuilder, onToggleBuilder, columns, columnsLoading, onBuildSql,
}) {
  return (
    <div className="db-query">
      <div className="db-query__editor">
        <div className="db-field">
          <label className="db-label" htmlFor="db-query-table-select">Table</label>
          <TableSelect
            id="db-query-table-select"
            tables={tables}
            value={queryTable ?? ''}
            onChange={onSelectTable}
          />
        </div>
        <QueryCommandToolbar
          activeBuilder={activeBuilder}
          onToggle={onToggleBuilder}
          disabled={!queryTable}
        />
        <QueryBuilderPanel
          activeBuilder={activeBuilder}
          table={queryTable}
          columns={columns}
          columnsLoading={columnsLoading}
          onBuild={onBuildSql}
          onCancel={() => onToggleBuilder(activeBuilder)}
        />
        <textarea
          className="db-textarea db-textarea--mono db-textarea--query"
          value={sqlQuery}
          onChange={e => onSqlChange(e.target.value)}
          placeholder={'SELECT * FROM patients\nWHERE status = \'active\''}
          rows={6}
          onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') onRun() }}
          aria-label="SQL query"
          spellCheck={false}
        />
        <div className="db-query__toolbar">
          <span className="db-hint">Ctrl+Enter to run</span>
          <button className="db-btn db-btn--primary" onClick={onRun}>
            <span className="db-icon db-icon--play" aria-hidden="true" />
            Run query
          </button>
        </div>
      </div>
```

(Leave the `queryResult` rendering block below unchanged.)

Update the `QueryPanel` invocation site to pass the new props:

```jsx
                {activeTab === 'query' && (
                  <QueryPanel
                    tables={session.tables}
                    queryTable={queryTable ?? dbState.selectedTable}
                    onSelectTable={handleQueryTableSelect}
                    sqlQuery={sqlQuery}
                    onSqlChange={setSqlQuery}
                    queryResult={queryResult}
                    onRun={runQuery}
                    activeBuilder={activeBuilder}
                    onToggleBuilder={toggleBuilder}
                    columns={tableColumns[queryTable ?? dbState.selectedTable] ?? []}
                    columnsLoading={columnsLoading}
                    onBuildSql={applyBuiltSql}
                  />
                )}
```

- [ ] **Step 6: Add CSS for the builder UI**

In `packages/ui/src/styles/ViewDbManager.css`, after the `.db-table-select` rule added in Task 5:

```css
.db-query__command-toolbar {
  flex-wrap: wrap;
  gap: 6px;
}

.db-builder {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--color-border, #ccc);
  border-radius: 6px;
}

.db-condition-row {
  display: flex;
  gap: 8px;
}

.db-condition-row > * {
  flex: 1;
}

.db-builder__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test -w packages/ui -- ViewDbManager.test.jsx`
Expected: PASS, all tests in the file green

- [ ] **Step 8: Run the full UI test suite**

Run: `npm run test -w packages/ui`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src/views/ViewDbManager.jsx packages/ui/src/styles/ViewDbManager.css packages/ui/src/views/ViewDbManager.test.jsx
git commit -m "feat(db-manager): add query command toolbar with Search and Delete builders"
```

---

### Task 8: Insert builder

**Files:**
- Modify: `packages/ui/src/views/ViewDbManager.jsx`
- Modify: `packages/ui/src/views/ViewDbManager.test.jsx`

**Interfaces:**
- Consumes: `buildInsertQuery` (Task 4), `QueryBuilderPanel`/`BuilderFooter`/`tableColumns` (Task 7).
- Produces: `InsertBuilder` component, dispatched by `QueryBuilderPanel` for `activeBuilder === 'insert'`.

- [ ] **Step 1: Write the failing test**

In `packages/ui/src/views/ViewDbManager.test.jsx`, in the `'ViewDbManager — query command builders'` describe block, add:

```js
  it('builds an INSERT query from checked columns', async () => {
    await openQueryTabForPatients()

    fireEvent.click(screen.getByText('Insert'))
    await waitFor(() => screen.getByLabelText('Include name'))

    fireEvent.click(screen.getByLabelText('Include name'))
    fireEvent.change(screen.getByLabelText('Value for name'), { target: { value: 'Alice' } })
    fireEvent.click(screen.getByText('Build'))

    expect(screen.getByLabelText('SQL query').value).toBe("INSERT INTO patients (name) VALUES ('Alice')")
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w packages/ui -- ViewDbManager.test.jsx`
Expected: FAIL — `screen.getByLabelText('Include name')` finds nothing (no `InsertBuilder` yet)

- [ ] **Step 3: Implement `InsertBuilder`**

Add the import for `buildInsertQuery` to the `@nexusmd/core` import block (alongside `buildSearchQuery, buildDeleteQuery` from Task 7):

```jsx
  buildSearchQuery,
  buildDeleteQuery,
  buildInsertQuery,
```

Add the component after `DeleteBuilder` (from Task 7):

```jsx
function InsertBuilder({ table, columns, onBuild, onCancel }) {
  const [values, setValues] = useState({})   // { [colName]: string }
  const [included, setIncluded] = useState(() => new Set())

  const toggle = (name) => setIncluded(prev => {
    const next = new Set(prev)
    next.has(name) ? next.delete(name) : next.add(name)
    return next
  })

  const valid = included.size > 0

  return (
    <div className="db-builder">
      {columns.map(col => (
        <div key={col.name} className="db-condition-row">
          <label className="db-checkbox-label">
            <input
              type="checkbox"
              aria-label={`Include ${col.name}`}
              checked={included.has(col.name)}
              onChange={() => toggle(col.name)}
            />
            {col.name}
          </label>
          {included.has(col.name) && (
            <input
              aria-label={`Value for ${col.name}`}
              className="db-input"
              type="text"
              value={values[col.name] ?? ''}
              onChange={e => setValues(v => ({ ...v, [col.name]: e.target.value }))}
            />
          )}
        </div>
      ))}
      <BuilderFooter
        buildDisabled={!valid}
        onCancel={onCancel}
        onBuild={() => onBuild(buildInsertQuery(
          table,
          columns.filter(c => included.has(c.name)).map(c => ({ name: c.name, value: values[c.name] })),
        ))}
      />
    </div>
  )
}
```

Add the dispatch line to `QueryBuilderPanel` (from Task 7), after the `'delete'` line:

```jsx
  if (activeBuilder === 'insert') return <InsertBuilder {...props} />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w packages/ui -- ViewDbManager.test.jsx`
Expected: PASS, all tests in the file green

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/ViewDbManager.jsx packages/ui/src/views/ViewDbManager.test.jsx
git commit -m "feat(db-manager): add Insert query builder"
```

---

### Task 9: Update builder

**Files:**
- Modify: `packages/ui/src/views/ViewDbManager.jsx`
- Modify: `packages/ui/src/views/ViewDbManager.test.jsx`

**Interfaces:**
- Consumes: `buildUpdateQuery` (Task 4), `ConditionRow`/`BuilderFooter` (Task 7), the checkbox+value row pattern from `InsertBuilder` (Task 8).
- Produces: `UpdateBuilder` component, dispatched by `QueryBuilderPanel` for `activeBuilder === 'update'`.

- [ ] **Step 1: Write the failing test**

In `packages/ui/src/views/ViewDbManager.test.jsx`, in the `'ViewDbManager — query command builders'` describe block, add:

```js
  it('builds an UPDATE query with SET and WHERE clauses', async () => {
    await openQueryTabForPatients()

    fireEvent.click(screen.getByText('Update'))
    await waitFor(() => screen.getByLabelText('Include status'))

    fireEvent.click(screen.getByLabelText('Include status'))
    fireEvent.change(screen.getByLabelText('Value for status'), { target: { value: 'inactive' } })
    fireEvent.change(screen.getByLabelText('Column'), { target: { value: 'id' } })
    fireEvent.change(screen.getByLabelText('Operator'), { target: { value: '=' } })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '1' } })
    fireEvent.click(screen.getByText('Build'))

    expect(screen.getByLabelText('SQL query').value).toBe("UPDATE patients SET status = 'inactive'\nWHERE id = 1")
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w packages/ui -- ViewDbManager.test.jsx`
Expected: FAIL — `screen.getByLabelText('Include status')` finds nothing (no `UpdateBuilder` yet)

- [ ] **Step 3: Implement `UpdateBuilder`**

Add `buildUpdateQuery` to the `@nexusmd/core` import block:

```jsx
  buildUpdateQuery,
```

Add the component after `InsertBuilder` (from Task 8):

```jsx
function UpdateBuilder({ table, columns, onBuild, onCancel }) {
  const [values, setValues] = useState({})
  const [included, setIncluded] = useState(() => new Set())
  const [conditions, setConditions] = useState([{ column: '', operator: '=', value: '' }])
  const updateCondition = (i, next) => setConditions(cs => cs.map((c, idx) => idx === i ? next : c))

  const toggle = (name) => setIncluded(prev => {
    const next = new Set(prev)
    next.has(name) ? next.delete(name) : next.add(name)
    return next
  })

  const validSet = included.size > 0
  const validConditions = conditions.length > 0
    && conditions.every(c => c.column && (c.operator === 'IS NULL' || c.value !== ''))

  return (
    <div className="db-builder">
      <p className="db-hint">Set</p>
      {columns.map(col => (
        <div key={col.name} className="db-condition-row">
          <label className="db-checkbox-label">
            <input
              type="checkbox"
              aria-label={`Include ${col.name}`}
              checked={included.has(col.name)}
              onChange={() => toggle(col.name)}
            />
            {col.name}
          </label>
          {included.has(col.name) && (
            <input
              aria-label={`Value for ${col.name}`}
              className="db-input"
              type="text"
              value={values[col.name] ?? ''}
              onChange={e => setValues(v => ({ ...v, [col.name]: e.target.value }))}
            />
          )}
        </div>
      ))}
      <p className="db-hint">Where</p>
      {conditions.map((c, i) => (
        <ConditionRow key={i} columns={columns} condition={c} onChange={next => updateCondition(i, next)} />
      ))}
      <button type="button" className="db-btn db-btn--ghost db-btn--sm"
        onClick={() => setConditions(cs => [...cs, { column: '', operator: '=', value: '' }])}>
        + Add condition
      </button>
      <BuilderFooter
        buildDisabled={!validSet || !validConditions}
        onCancel={onCancel}
        onBuild={() => onBuild(buildUpdateQuery(
          table,
          columns.filter(c => included.has(c.name)).map(c => ({ name: c.name, value: values[c.name] })),
          conditions.filter(c => c.column),
        ))}
      />
    </div>
  )
}
```

Add the dispatch line to `QueryBuilderPanel`, after the `'insert'` line:

```jsx
  if (activeBuilder === 'update') return <UpdateBuilder {...props} />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w packages/ui -- ViewDbManager.test.jsx`
Expected: PASS, all tests in the file green

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/ViewDbManager.jsx packages/ui/src/views/ViewDbManager.test.jsx
git commit -m "feat(db-manager): add Update query builder"
```

---

### Task 10: Join builder

**Files:**
- Modify: `packages/ui/src/views/ViewDbManager.jsx`
- Modify: `packages/ui/src/views/ViewDbManager.test.jsx`

**Interfaces:**
- Consumes: `buildJoinQuery` (Task 4), `TableSelect` (Task 5), `ensureColumnsLoaded` (Task 7, extended here to fetch the *second* table's columns too).
- Produces: `JoinBuilder` component, dispatched by `QueryBuilderPanel` for `activeBuilder === 'join'`.

- [ ] **Step 1: Write the failing test**

In `packages/ui/src/views/ViewDbManager.test.jsx`, in the `'ViewDbManager — query command builders'` describe block, add:

```js
  it('builds a JOIN query across two tables', async () => {
    await openQueryTabForPatients()

    fireEvent.click(screen.getByText('Join'))
    await waitFor(() => screen.getByLabelText('Join table'))

    fireEvent.change(screen.getByLabelText('Join table'), { target: { value: 'staff' } })
    await waitFor(() => screen.getByLabelText('Left column'))
    fireEvent.change(screen.getByLabelText('Join type'), { target: { value: 'LEFT' } })
    fireEvent.change(screen.getByLabelText('Left column'), { target: { value: 'id' } })
    fireEvent.change(screen.getByLabelText('Right column'), { target: { value: 'name' } })
    fireEvent.click(screen.getByText('Build'))

    expect(screen.getByLabelText('SQL query').value).toBe(
      'SELECT * FROM patients\nLEFT JOIN staff ON patients.id = staff.name',
    )
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w packages/ui -- ViewDbManager.test.jsx`
Expected: FAIL — `screen.getByLabelText('Join table')` finds nothing (no `JoinBuilder` yet)

- [ ] **Step 3: Implement `JoinBuilder`**

Add `buildJoinQuery` to the `@nexusmd/core` import block:

```jsx
  buildJoinQuery,
```

`JoinBuilder` needs the *second* table's columns, which may not be cached yet. Give it its own `onLoadColumnsFor(table)` callback wired straight to `ensureColumnsLoaded`, and read from the same `tableColumns` cache map — pass `allColumns` (the full `tableColumns` object) down instead of a single-table `columns` array for this one builder. Update `QueryBuilderPanel`'s props (from Task 7) to also forward `allTables` and `allColumns` and `onLoadColumnsFor`:

```jsx
function QueryBuilderPanel({
  activeBuilder, table, columns, columnsLoading, onBuild, onCancel,
  allTables, allColumns, onLoadColumnsFor,
}) {
  if (!activeBuilder) return null
  if (columnsLoading) return <p className="db-hint">Loading columns…</p>

  const props = { table, columns, onBuild, onCancel }
  if (activeBuilder === 'search') return <SearchBuilder {...props} />
  if (activeBuilder === 'delete') return <DeleteBuilder {...props} />
  if (activeBuilder === 'insert') return <InsertBuilder {...props} />
  if (activeBuilder === 'update') return <UpdateBuilder {...props} />
  if (activeBuilder === 'join') {
    return (
      <JoinBuilder
        table={table}
        columns={columns}
        allTables={allTables}
        allColumns={allColumns}
        onLoadColumnsFor={onLoadColumnsFor}
        onBuild={onBuild}
        onCancel={onCancel}
      />
    )
  }
  return null
}
```

Add the component after `UpdateBuilder` (from Task 9):

```jsx
function JoinBuilder({ table, columns, allTables, allColumns, onLoadColumnsFor, onBuild, onCancel }) {
  const [rightTable, setRightTable] = useState('')
  const [joinType, setJoinType] = useState('INNER')
  const [leftColumn, setLeftColumn] = useState('')
  const [rightColumn, setRightColumn] = useState('')

  const rightColumns = allColumns[rightTable] ?? []
  const valid = rightTable && leftColumn && rightColumn

  const selectRightTable = async (name) => {
    setRightTable(name)
    setRightColumn('')
    await onLoadColumnsFor(name)
  }

  return (
    <div className="db-builder">
      <div className="db-condition-row">
        <label className="db-label" htmlFor="db-join-table">Join table</label>
        <TableSelect
          id="db-join-table"
          tables={allTables.filter(t => t !== table)}
          value={rightTable}
          onChange={selectRightTable}
        />
      </div>
      <div className="db-condition-row">
        <label className="db-label" htmlFor="db-join-type">Join type</label>
        <select id="db-join-type" aria-label="Join type" className="db-input" value={joinType}
          onChange={e => setJoinType(e.target.value)}>
          <option value="INNER">INNER</option>
          <option value="LEFT">LEFT</option>
          <option value="RIGHT">RIGHT</option>
        </select>
      </div>
      {rightTable && (
        <div className="db-condition-row">
          <select aria-label="Left column" className="db-input" value={leftColumn}
            onChange={e => setLeftColumn(e.target.value)}>
            <option value="" disabled>Left column…</option>
            {columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
          <select aria-label="Right column" className="db-input" value={rightColumn}
            onChange={e => setRightColumn(e.target.value)}>
            <option value="" disabled>Right column…</option>
            {rightColumns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </div>
      )}
      <BuilderFooter
        buildDisabled={!valid}
        onCancel={onCancel}
        onBuild={() => onBuild(buildJoinQuery(table, rightTable, joinType, leftColumn, rightColumn))}
      />
    </div>
  )
}
```

Update `toggleBuilder` (from Task 7) — no change needed, it already calls `ensureColumnsLoaded(queryTable)` for the *left* table; `JoinBuilder` calls `onLoadColumnsFor` itself for the right table.

Update the `QueryPanel` → `QueryBuilderPanel` call site (inside `QueryPanel`'s JSX, from Task 7) to forward the new props:

```jsx
        <QueryBuilderPanel
          activeBuilder={activeBuilder}
          table={queryTable}
          columns={columns}
          columnsLoading={columnsLoading}
          onBuild={onBuildSql}
          onCancel={() => onToggleBuilder(activeBuilder)}
          allTables={tables}
          allColumns={allColumns}
          onLoadColumnsFor={onLoadColumnsFor}
        />
```

`QueryPanel`'s own signature needs `allColumns` and `onLoadColumnsFor` added, and the `ViewDbManager` call site needs to pass them through:

```jsx
function QueryPanel({
  tables, queryTable, onSelectTable, sqlQuery, onSqlChange, queryResult, onRun,
  activeBuilder, onToggleBuilder, columns, columnsLoading, onBuildSql,
  allColumns, onLoadColumnsFor,
}) {
```

```jsx
                {activeTab === 'query' && (
                  <QueryPanel
                    tables={session.tables}
                    queryTable={queryTable ?? dbState.selectedTable}
                    onSelectTable={handleQueryTableSelect}
                    sqlQuery={sqlQuery}
                    onSqlChange={setSqlQuery}
                    queryResult={queryResult}
                    onRun={runQuery}
                    activeBuilder={activeBuilder}
                    onToggleBuilder={toggleBuilder}
                    columns={tableColumns[queryTable ?? dbState.selectedTable] ?? []}
                    columnsLoading={columnsLoading}
                    onBuildSql={applyBuiltSql}
                    allColumns={tableColumns}
                    onLoadColumnsFor={ensureColumnsLoaded}
                  />
                )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w packages/ui -- ViewDbManager.test.jsx`
Expected: PASS, all tests in the file green

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/ViewDbManager.jsx packages/ui/src/views/ViewDbManager.test.jsx
git commit -m "feat(db-manager): add Join query builder"
```

---

### Task 11: Aggregate builder

**Files:**
- Modify: `packages/ui/src/views/ViewDbManager.jsx`
- Modify: `packages/ui/src/views/ViewDbManager.test.jsx`

**Interfaces:**
- Consumes: `buildAggregateQuery` (Task 4), `columns`/`BuilderFooter` (Task 7).
- Produces: `AggregateBuilder` component, dispatched by `QueryBuilderPanel` for `activeBuilder === 'aggregate'`. Final task in this plan.

- [ ] **Step 1: Write the failing test**

In `packages/ui/src/views/ViewDbManager.test.jsx`, in the `'ViewDbManager — query command builders'` describe block, add:

```js
  it('builds an AGGREGATE query with a function, column, and GROUP BY', async () => {
    await openQueryTabForPatients()

    fireEvent.click(screen.getByText('Aggregate'))
    await waitFor(() => screen.getByLabelText('Function'))

    fireEvent.change(screen.getByLabelText('Function'), { target: { value: 'COUNT' } })
    fireEvent.change(screen.getByLabelText('Aggregate column'), { target: { value: 'id' } })
    fireEvent.click(screen.getByLabelText('Group by status'))
    fireEvent.click(screen.getByText('Build'))

    expect(screen.getByLabelText('SQL query').value).toBe('SELECT COUNT(id), status FROM patients\nGROUP BY status')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w packages/ui -- ViewDbManager.test.jsx`
Expected: FAIL — `screen.getByLabelText('Function')` finds nothing (no `AggregateBuilder` yet)

- [ ] **Step 3: Implement `AggregateBuilder`**

Add `buildAggregateQuery` to the `@nexusmd/core` import block:

```jsx
  buildAggregateQuery,
```

Add the component after `JoinBuilder` (from Task 10):

```jsx
const AGGREGATE_FUNCTIONS = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']

function AggregateBuilder({ table, columns, onBuild, onCancel }) {
  const [fn, setFn] = useState('COUNT')
  const [column, setColumn] = useState('')
  const [groupBy, setGroupBy] = useState(() => new Set())

  const toggleGroupBy = (name) => setGroupBy(prev => {
    const next = new Set(prev)
    next.has(name) ? next.delete(name) : next.add(name)
    return next
  })

  const valid = !!column

  return (
    <div className="db-builder">
      <div className="db-condition-row">
        <select aria-label="Function" className="db-input" value={fn} onChange={e => setFn(e.target.value)}>
          {AGGREGATE_FUNCTIONS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select aria-label="Aggregate column" className="db-input" value={column}
          onChange={e => setColumn(e.target.value)}>
          <option value="" disabled>Column…</option>
          {columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
      </div>
      <p className="db-hint">Group by</p>
      {columns.map(col => (
        <label key={col.name} className="db-checkbox-label">
          <input
            type="checkbox"
            aria-label={`Group by ${col.name}`}
            checked={groupBy.has(col.name)}
            onChange={() => toggleGroupBy(col.name)}
          />
          {col.name}
        </label>
      ))}
      <BuilderFooter
        buildDisabled={!valid}
        onCancel={onCancel}
        onBuild={() => onBuild(buildAggregateQuery(table, [{ fn, column }], [...groupBy]))}
      />
    </div>
  )
}
```

Add the dispatch line to `QueryBuilderPanel` (from Task 10), after the `'insert'`/`'update'` lines and before the `'join'` block:

```jsx
  if (activeBuilder === 'aggregate') return <AggregateBuilder {...props} />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w packages/ui -- ViewDbManager.test.jsx`
Expected: PASS, all tests in the file green

- [ ] **Step 5: Run the full workspace test suite**

Run: `npm test`
Expected: PASS across `packages/core`, `packages/web-adapters`, `packages/ui`

Run: `npm run test -w apps/desktop`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/views/ViewDbManager.jsx packages/ui/src/views/ViewDbManager.test.jsx
git commit -m "feat(db-manager): add Aggregate query builder"
```

---

## Manual Verification (after all tasks)

Once all 11 tasks are complete, use the `master/apps/desktop:verify` skill to run the desktop app and confirm end-to-end:
1. Connect to the demo database — the sidebar shows a "Tables" dropdown instead of a button list.
2. Select a table from the sidebar dropdown — Browse tab loads its rows.
3. Switch to the Query tab, pick a (possibly different) table from its own dropdown — the textarea auto-fills `SELECT * FROM <table>`.
4. Click each of the six command buttons in turn (Search, Insert, Update, Delete, Join, Aggregate), fill in a minimal form, click Build, and confirm the textarea receives valid SQL that runs successfully via "Run query" against the demo data.
5. Repeat steps 1–4 against a real SQLite file if one is available, to confirm the `getColumns` PRAGMA path and the widened `INSERT`/`UPDATE` guardrail work outside demo mode.
