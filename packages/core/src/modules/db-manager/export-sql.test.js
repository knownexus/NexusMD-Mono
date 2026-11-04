import { describe, it, expect } from 'vitest'
import { orderByDependencies, buildSchemaScript, buildTableData, joinDataScript } from './export-sql.js'

const col = (name, dataType, extra = {}) => ({ name, dataType, isPrimaryKey: false, nullable: true, maxLength: null, precision: null, scale: null, isIdentity: false, isComputed: false, ...extra })

describe('orderByDependencies', () => {
  it('puts a referenced table before the one that points at it', () => {
    const s = { Order: { foreignKeys: [{ refTable: 'Customer' }] }, Customer: { foreignKeys: [] } }
    expect(orderByDependencies(['Order', 'Customer'], s)).toEqual(['Customer', 'Order'])
  })
  it('survives a cycle and a self reference', () => {
    const s = { A: { foreignKeys: [{ refTable: 'B' }, { refTable: 'A' }] }, B: { foreignKeys: [{ refTable: 'A' }] } }
    expect(orderByDependencies(['A', 'B'], s).sort()).toEqual(['A', 'B'])
  })
})

describe('buildSchemaScript', () => {
  it('writes SQL Server tables with sizes, identity, keys, foreign keys and indexes', () => {
    const tables = [
      { name: 'Customer', columns: [col('Id', 'int', { isPrimaryKey: true, nullable: false, isIdentity: true }), col('Name', 'nvarchar', { maxLength: -1 }), col('Balance', 'decimal', { precision: 10, scale: 2 })], foreignKeys: [], indexes: [{ name: 'IX_Name', columns: [{ name: 'Name', desc: false }], unique: true, primaryKey: false, filter: null }] },
      { name: 'dbo2.Order', columns: [col('Id', 'int', { isPrimaryKey: true, nullable: false }), col('CustomerId', 'int')], foreignKeys: [{ name: 'FK_o_c', columns: ['CustomerId'], refTable: 'Customer', refColumns: ['Id'], onDelete: 'CASCADE', onUpdate: 'NO_ACTION' }] },
    ]
    const sql = buildSchemaScript('sqlserver', tables, { database: 'Shop' })
    expect(sql).toContain('-- Schema of Shop · 2 tables')
    expect(sql).toContain('[Id] int IDENTITY(1,1) NOT NULL')
    expect(sql).toContain('[Name] nvarchar(max) NULL')
    expect(sql).toContain('[Balance] decimal(10,2) NULL')
    expect(sql).toContain('CONSTRAINT [PK_Customer] PRIMARY KEY ([Id])')
    expect(sql).toContain('CREATE TABLE [dbo2].[Order]')
    expect(sql).toContain('ALTER TABLE [dbo2].[Order] ADD CONSTRAINT [FK_o_c] FOREIGN KEY ([CustomerId]) REFERENCES [Customer] ([Id]) ON DELETE CASCADE;')
    expect(sql).not.toContain('NO ACTION')
    expect(sql).toContain('CREATE UNIQUE INDEX [IX_Name] ON [Customer] ([Name]);')
  })

  it('writes SQLite keys inside the table and skips the primary key index', () => {
    const tables = [
      { name: 'a', columns: [col('id', 'INTEGER', { isPrimaryKey: true, isIdentity: true, nullable: false })], indexes: [{ name: 'pk', columns: [{ name: 'id' }], primaryKey: true }] },
      { name: 'b', columns: [col('id', 'INTEGER', { isPrimaryKey: true, nullable: false }), col('a_id', 'INTEGER')], foreignKeys: [{ name: 'x', columns: ['a_id'], refTable: 'a', refColumns: ['id'] }] },
    ]
    const sql = buildSchemaScript('sqlite', tables)
    expect(sql).toContain('[id] INTEGER PRIMARY KEY AUTOINCREMENT')
    expect(sql).toContain('PRIMARY KEY ([id]),\n  FOREIGN KEY ([a_id]) REFERENCES [a] ([id])')
    expect(sql).not.toContain('ALTER TABLE')
    expect(sql).not.toContain('CREATE INDEX')
  })
})

describe('buildTableData', () => {
  const info = [col('Id', 'int', { isIdentity: true, isPrimaryKey: true }), col('Name', 'nvarchar'), col('Ver', 'timestamp')]
  it('keeps identity values, wraps them, and leaves unscriptable columns out', () => {
    const sql = buildTableData('sqlserver', 'T', ['Id', 'Name', 'Ver'], [[1, "O'Neil", null], [2, null, null]], info)
    expect(sql).toContain('1 column not scripted')
    expect(sql).toContain('SET IDENTITY_INSERT [T] ON;')
    expect(sql).toContain("INSERT INTO [T] ([Id], [Name]) VALUES (1, N'O''Neil');")
    expect(sql).toContain('VALUES (2, NULL);')
    expect(sql.trim().endsWith('SET IDENTITY_INSERT [T] OFF;')).toBe(true)
  })
  it('is just a header for an empty table', () => {
    expect(buildTableData('sqlite', 'T', ['a'], [], [])).toBe('-- T · 0 rows')
  })
  it('joins parts into one script', () => {
    expect(joinDataScript(['-- a', '-- b'], { database: 'X' })).toBe('-- Data of X · 2 tables\n\n-- a\n\n-- b\n')
  })
})
