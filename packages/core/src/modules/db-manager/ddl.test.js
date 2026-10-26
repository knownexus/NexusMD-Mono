// packages/core/src/modules/db-manager/ddl.test.js
import { describe, it, expect } from 'vitest'
import { columnTypes, validateTableSpec, buildCreateTable, buildCreateView, buildDropStatement, formatDefault, isSingleStatement } from './ddl.js'

const col = (name, type, extra = {}) => ({ name, type, nullable: true, primaryKey: false, identity: false, default: '', ...extra })

describe('columnTypes', () => {
  it('offers each dialect its own types', () => {
    expect(columnTypes('sqlserver').map(t => t.name)).toEqual(expect.arrayContaining(['int', 'bit', 'nvarchar', 'decimal', 'datetime2', 'uniqueidentifier']))
    expect(columnTypes('sqlite').map(t => t.name)).toEqual(['INTEGER', 'REAL', 'TEXT', 'NUMERIC', 'BLOB'])
  })
})

describe('validateTableSpec', () => {
  it('needs a name and at least one named column', () => {
    expect(validateTableSpec('sqlserver', '', [])).toEqual(expect.arrayContaining(['Give the table a name.', 'Add at least one column.']))
    expect(validateTableSpec('sqlserver', 'T', [col('', 'int')])).toContain('Every column needs a name.')
  })

  it('refuses duplicate column names, ignoring case', () => {
    expect(validateTableSpec('sqlserver', 'T', [col('Id', 'int'), col('id', 'int')])).toContain('Column names must be different: id.')
  })

  it('allows one identity column, on a whole-number type', () => {
    expect(validateTableSpec('sqlserver', 'T', [col('A', 'nvarchar', { identity: true, length: '10' })])).toContain('A: only a whole-number column can be an identity.')
    expect(validateTableSpec('sqlserver', 'T', [col('A', 'int', { identity: true }), col('B', 'int', { identity: true })])).toContain('Only one column can be an identity.')
  })

  it('checks lengths and precision', () => {
    expect(validateTableSpec('sqlserver', 'T', [col('A', 'nvarchar', { length: '0' })])).toContain('A: length must be 1 to 4000, or max.')
    expect(validateTableSpec('sqlserver', 'T', [col('A', 'decimal', { precision: '5', scale: '6' })])).toContain('A: scale can’t be more than precision.')
  })

  it('passes a sound table', () => {
    expect(validateTableSpec('sqlserver', 'Member', [col('Id', 'int', { primaryKey: true, identity: true }), col('Name', 'nvarchar', { length: '100' })])).toEqual([])
  })
})

describe('buildCreateTable', () => {
  it('writes SQL Server DDL with identity, sizes, defaults and a named primary key', () => {
    const sql = buildCreateTable('sqlserver', 'Member', [
      col('Id', 'int', { primaryKey: true, identity: true }),
      col('Name', 'nvarchar', { length: '100', nullable: false }),
      col('Notes', 'nvarchar', { length: 'max' }),
      col('Price', 'decimal', { precision: '8', scale: '2', default: '0' }),
      col('Active', 'bit', { nullable: false, default: '1' }),
      col('Joined', 'datetime2', { default: 'GETDATE()' }),
    ])
    expect(sql).toBe([
      'CREATE TABLE [Member] (',
      '  [Id] int IDENTITY(1,1) NOT NULL,',
      '  [Name] nvarchar(100) NOT NULL,',
      '  [Notes] nvarchar(max) NULL,',
      '  [Price] decimal(8,2) NULL DEFAULT 0,',
      '  [Active] bit NOT NULL DEFAULT 1,',
      '  [Joined] datetime2 NULL DEFAULT GETDATE(),',
      '  CONSTRAINT [PK_Member] PRIMARY KEY ([Id])',
      ')',
    ].join('\n'))
  })

  it('makes a composite primary key, whose columns can’t be NULL', () => {
    const sql = buildCreateTable('sqlserver', 'Link', [col('A', 'int', { primaryKey: true }), col('B', 'int', { primaryKey: true })])
    expect(sql).toContain('[A] int NOT NULL')
    expect(sql).toContain('CONSTRAINT [PK_Link] PRIMARY KEY ([A], [B])')
  })

  it('writes SQLite DDL, with an auto-numbered INTEGER PRIMARY KEY', () => {
    const sql = buildCreateTable('sqlite', 'note', [col('id', 'INTEGER', { primaryKey: true, identity: true }), col('body', 'TEXT', { nullable: false, default: "it's" })])
    expect(sql).toBe([
      'CREATE TABLE [note] (',
      '  [id] INTEGER PRIMARY KEY AUTOINCREMENT,',
      "  [body] TEXT NOT NULL DEFAULT 'it''s'",
      ')',
    ].join('\n'))
  })

  it('brackets awkward names safely', () => {
    expect(buildCreateTable('sqlserver', 'odd]name', [col('Key', 'int')])).toContain('CREATE TABLE [odd]]name]')
  })
})

describe('formatDefault', () => {
  it('keeps numbers and known functions, quotes everything else', () => {
    expect(formatDefault('sqlserver', '42')).toBe('42')
    expect(formatDefault('sqlserver', 'newid()')).toBe('NEWID()')
    expect(formatDefault('sqlserver', 'NULL')).toBe('NULL')
    expect(formatDefault('sqlserver', "O'Brien")).toBe("N'O''Brien'")
    expect(formatDefault('sqlite', 'current_timestamp')).toBe('CURRENT_TIMESTAMP')
    expect(formatDefault('sqlserver', '')).toBe(null)
  })
})

describe('buildCreateView', () => {
  it('wraps a SELECT, dropping a trailing semicolon', () => {
    expect(buildCreateView('ActiveMembers', 'SELECT * FROM [Member] WHERE Active = 1;  ')).toBe('CREATE VIEW [ActiveMembers] AS\nSELECT * FROM [Member] WHERE Active = 1')
  })

  it('needs a name and a SELECT', () => {
    expect(() => buildCreateView('', 'SELECT 1')).toThrow('Give the view a name.')
    expect(() => buildCreateView('V', 'DELETE FROM T')).toThrow(/SELECT/)
    expect(() => buildCreateView('V', 'SELECT 1; DROP TABLE T')).toThrow(/one statement/)
  })
})

describe('buildDropStatement', () => {
  it('drops a table or a view by its bracketed name', () => {
    expect(buildDropStatement('Old Table')).toBe('DROP TABLE [Old Table]')
    expect(buildDropStatement('V', { view: true })).toBe('DROP VIEW [V]')
  })
})

describe('isSingleStatement', () => {
  it('ignores semicolons in strings, brackets and comments, and a trailing one', () => {
    expect(isSingleStatement("SELECT ';' AS x, [a;b] FROM t -- ; here\n /* ; */;")).toBe(true)
    expect(isSingleStatement('SELECT 1; SELECT 2')).toBe(false)
  })
})
