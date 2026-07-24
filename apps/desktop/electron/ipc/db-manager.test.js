// @vitest-environment node
//
// Tests for the db-manager IPC handler module.
// Uses an injectable fake ipcMain — no Electron process required.
// DB calls are mocked at the package boundary (better-sqlite3).

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Fake ipcMain that records registered handlers ─────────────────────────────

function makeFakeIpcMain() {
  const handlers = {}
  return {
    handle(channel, fn) { handlers[channel] = fn },
    _invoke(channel, ...args) {
      if (!handlers[channel]) throw new Error(`No handler for ${channel}`)
      return handlers[channel](null, ...args)     // null = Electron event object
    },
    _handlers: handlers,
  }
}

// ── Mock better-sqlite3 ───────────────────────────────────────────────────────

const mockSqliteRows = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]
const mockSqliteStmt = {
  all:  vi.fn(() => mockSqliteRows),
  run:  vi.fn(() => ({ changes: 2 })),
  get:  vi.fn(),
}
const mockSqliteDb = {
  pragma:  vi.fn(),
  prepare: vi.fn(() => mockSqliteStmt),
  close:   vi.fn(),
}

// A plain constructor (not vi.fn) — `new`-ing a vi.fn mock whose
// implementation is an arrow function throws "not a constructor", since
// arrow functions can't back a `new` call.
function MockDatabase() { return mockSqliteDb }

const { register } = await import('./db-manager.cjs')

// ─────────────────────────────────────────────────────────────────────────────

describe('db-manager IPC — SQLite', () => {
  let ipc

  beforeEach(() => {
    mockSqliteDb.prepare.mockClear()
    mockSqliteStmt.all.mockClear()
    mockSqliteStmt.run.mockClear()

    ipc = makeFakeIpcMain()
    register(ipc, { drivers: { requireSqlite: () => MockDatabase } })
  })

  const cfg = { type: 'sqlite', config: { filePath: '/test/data.db' } }

  it('connect returns table list', async () => {
    mockSqliteStmt.all.mockReturnValueOnce([{ name: 'users' }, { name: 'orders' }])
    const result = await ipc._invoke('db-manager:connect', cfg)
    expect(result.ok).toBe(true)
    expect(result.tables).toEqual(['users', 'orders'])
  })

  it('get-rows returns columns and rows', async () => {
    const result = await ipc._invoke('db-manager:get-rows', {
      ...cfg, table: 'users', limit: 100, offset: 0,
    })
    expect(result.columns).toEqual(['id', 'name'])
    expect(result.rows).toEqual([[1, 'Alice'], [2, 'Bob']])
  })

  it('get-rows rejects invalid table identifier', async () => {
    await expect(
      ipc._invoke('db-manager:get-rows', { ...cfg, table: 'users; DROP TABLE users--' }),
    ).rejects.toThrow('Invalid identifier')
  })

  it('get-rows clamps limit to 10 000', async () => {
    // SQLite binds limit/offset as query params (not string-interpolated), so
    // assert on the bound args passed to .all(), not the SQL text.
    await ipc._invoke('db-manager:get-rows', { ...cfg, table: 'users', limit: 999999, offset: 0 })
    expect(mockSqliteStmt.all).toHaveBeenLastCalledWith(10_000, 0)
  })

  it('delete-rows calls DELETE and returns affected count', async () => {
    const result = await ipc._invoke('db-manager:delete-rows', {
      ...cfg, table: 'users', primaryKey: 'id', values: [1, 2],
    })
    expect(result.ok).toBe(true)
    expect(result.affected).toBe(2)
    const sql = mockSqliteDb.prepare.mock.calls.at(-1)?.[0] ?? ''
    expect(sql).toMatch(/DELETE FROM "users"/)
  })

  it('delete-rows rejects empty values array', async () => {
    await expect(
      ipc._invoke('db-manager:delete-rows', { ...cfg, table: 'users', primaryKey: 'id', values: [] }),
    ).rejects.toThrow('non-empty array')
  })

  it('update-cell calls UPDATE', async () => {
    const result = await ipc._invoke('db-manager:update-cell', {
      ...cfg, table: 'users', primaryKey: 'id', primaryValue: 1, column: 'name', value: 'Carol',
    })
    expect(result.ok).toBe(true)
    const sql = mockSqliteDb.prepare.mock.calls.at(-1)?.[0] ?? ''
    expect(sql).toMatch(/UPDATE "users" SET "name"/)
  })

  it('run-query allows SELECT', async () => {
    mockSqliteStmt.all.mockReturnValueOnce([{ id: 1 }])
    const result = await ipc._invoke('db-manager:run-query', {
      ...cfg, sql: 'SELECT * FROM users',
    })
    expect(result.columns).toEqual(['id'])
  })

  it('run-query blocks INSERT', async () => {
    await expect(
      ipc._invoke('db-manager:run-query', { ...cfg, sql: "INSERT INTO users VALUES (99, 'x')" }),
    ).rejects.toThrow('Only SELECT')
  })

  it('run-query allows DELETE', async () => {
    const result = await ipc._invoke('db-manager:run-query', {
      ...cfg, sql: 'DELETE FROM users WHERE id = 99',
    })
    expect(result.affected).toBe(2)
  })

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
})

describe('identifier validation', () => {
  let ipc

  beforeEach(() => {
    ipc = makeFakeIpcMain()
    register(ipc)
  })

  const cfg = { type: 'sqlite', config: { filePath: '/test/data.db' } }

  it.each([
    ['users; DROP TABLE users--', 'SQL injection'],
    ["users'", 'single quote'],
    ['users"', 'double quote'],
    ['../etc/passwd', 'path traversal'],
  ])('rejects table name with %s', async (table) => {
    await expect(
      ipc._invoke('db-manager:get-rows', { ...cfg, table }),
    ).rejects.toThrow('Invalid identifier')
  })
})
