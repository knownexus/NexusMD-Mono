// packages/core/src/modules/db-manager/cell-types.test.js
import { describe, it, expect } from 'vitest'
import { columnKind, isPartialInput, cellToInput, parseCellInput } from './cell-types.js'

const col = (dataType, extra = {}) => ({ name: 'c', dataType, nullable: false, ...extra })

describe('columnKind', () => {
  it('sorts SQL Server and SQLite types into editors', () => {
    expect(['int', 'bigint', 'tinyint', 'INTEGER'].map(t => columnKind(col(t)))).toEqual(['integer', 'integer', 'integer', 'integer'])
    expect(['decimal', 'numeric', 'money', 'float', 'REAL'].map(t => columnKind(col(t)))).toEqual(['decimal', 'decimal', 'decimal', 'decimal', 'decimal'])
    expect(columnKind(col('bit'))).toBe('boolean')
    expect(columnKind(col('BOOLEAN'))).toBe('boolean')
    expect(columnKind(col('date'))).toBe('date')
    expect(['datetime', 'datetime2', 'smalldatetime'].map(t => columnKind(col(t)))).toEqual(['datetime', 'datetime', 'datetime'])
    expect(columnKind(col('time'))).toBe('time')
    expect(columnKind(col('uniqueidentifier'))).toBe('guid')
    expect(['nvarchar', 'varchar', 'TEXT', 'xml', 'datetimeoffset'].map(t => columnKind(col(t)))).toEqual(['text', 'text', 'text', 'text', 'text'])
  })

  it('makes identity, computed, rowversion and binary columns read-only', () => {
    expect(columnKind(col('int', { isIdentity: true }))).toBe('readonly')
    expect(columnKind(col('nvarchar', { isComputed: true }))).toBe('readonly')
    expect(['timestamp', 'rowversion', 'varbinary', 'image', 'BLOB'].map(t => columnKind(col(t)))).toEqual(Array(5).fill('readonly'))
  })

  it('treats an unknown column as text', () => {
    expect(columnKind(null)).toBe('text')
  })
})

describe('isPartialInput (what a keystroke may leave in the box)', () => {
  it('lets a whole-number box hold only digits and a leading minus', () => {
    expect(['', '-', '12', '-40'].every(v => isPartialInput('integer', v))).toBe(true)
    expect(['1.5', 'abc', '1e3', '--1', '1-'].some(v => isPartialInput('integer', v))).toBe(false)
  })

  it('lets a decimal box hold one point', () => {
    expect(['', '-', '.', '1.', '-0.25'].every(v => isPartialInput('decimal', v))).toBe(true)
    expect(['1.2.3', 'x', '1,5'].some(v => isPartialInput('decimal', v))).toBe(false)
  })

  it('allows anything in other boxes', () => {
    expect(isPartialInput('text', 'anything at all')).toBe(true)
  })
})

describe('cellToInput', () => {
  it('shows dates without shifting them across time zones', () => {
    const d = new Date(Date.UTC(2024, 2, 5, 14, 7, 9))
    expect(cellToInput(col('date'), d)).toBe('2024-03-05')
    expect(cellToInput(col('datetime2'), d)).toBe('2024-03-05T14:07:09')
    expect(cellToInput(col('time'), new Date(Date.UTC(1970, 0, 1, 8, 30, 0)))).toBe('08:30:00')
  })

  it('passes stored strings through and shows NULL as empty', () => {
    expect(cellToInput(col('datetime'), '2024-03-05 14:07:09')).toBe('2024-03-05T14:07:09')
    expect(cellToInput(col('int'), null)).toBe('')
    expect(cellToInput(col('int'), 42)).toBe('42')
  })
})

describe('parseCellInput', () => {
  it('accepts whole numbers in range, as numbers', () => {
    expect(parseCellInput(col('int'), ' 42 ')).toEqual({ value: 42 })
    expect(parseCellInput(col('tinyint'), '255')).toEqual({ value: 255 })
    expect(parseCellInput(col('tinyint'), '256').error).toMatch(/0 to 255/)
    expect(parseCellInput(col('smallint'), '-32769').error).toMatch(/-32768 to 32767/)
    expect(parseCellInput(col('int'), '2147483648').error).toMatch(/2147483647/)
    expect(parseCellInput(col('int'), '1.5').error).toMatch(/whole number/)
  })

  it('keeps big bigint values exact, as text', () => {
    expect(parseCellInput(col('bigint'), '9223372036854775807')).toEqual({ value: '9223372036854775807' })
    expect(parseCellInput(col('bigint'), '9223372036854775808').error).toBeTruthy()
  })

  it('checks decimals against precision and scale, keeping them exact', () => {
    const money = col('decimal', { precision: 6, scale: 2 })
    expect(parseCellInput(money, '1234.50')).toEqual({ value: '1234.50' })
    expect(parseCellInput(money, '1234.567').error).toMatch(/2 decimal places/)
    expect(parseCellInput(money, '12345.5').error).toMatch(/4 digits before/)
    expect(parseCellInput(col('float'), '2.5')).toEqual({ value: 2.5 })
    expect(parseCellInput(col('float'), 'abc').error).toMatch(/number/)
  })

  it('reads bits as true / false', () => {
    expect(parseCellInput(col('bit'), true)).toEqual({ value: true })
    expect(parseCellInput(col('bit'), 'false')).toEqual({ value: false })
  })

  it('checks dates, times and GUIDs', () => {
    expect(parseCellInput(col('date'), '2024-02-29')).toEqual({ value: '2024-02-29' })
    expect(parseCellInput(col('date'), '2023-02-29').error).toMatch(/date/)
    expect(parseCellInput(col('datetime2'), '2024-03-05T14:07')).toEqual({ value: '2024-03-05T14:07:00' })
    expect(parseCellInput(col('time'), '25:00').error).toMatch(/time/)
    expect(parseCellInput(col('uniqueidentifier'), '6F9619FF-8B86-D011-B42D-00C04FC964FF').value).toBe('6F9619FF-8B86-D011-B42D-00C04FC964FF')
    expect(parseCellInput(col('uniqueidentifier'), 'not-a-guid').error).toMatch(/GUID/)
  })

  it('limits text to the column length, but keeps empty text as empty text', () => {
    expect(parseCellInput(col('nvarchar', { maxLength: 3 }), 'abcd').error).toMatch(/3 characters/)
    expect(parseCellInput(col('nvarchar', { maxLength: -1 }), 'x'.repeat(5000)).value).toHaveLength(5000)
    expect(parseCellInput(col('nvarchar'), '')).toEqual({ value: '' })
  })

  it('turns an empty non-text value into NULL only where NULL is allowed', () => {
    expect(parseCellInput(col('int', { nullable: true }), '')).toEqual({ value: null })
    expect(parseCellInput(col('int'), '').error).toMatch(/needs a value/)
    expect(parseCellInput(col('int', { nullable: true }), '', { isNull: true })).toEqual({ value: null })
    expect(parseCellInput(col('nvarchar'), 'x', { isNull: true }).error).toMatch(/can't be NULL/)
  })

  it('refuses read-only columns', () => {
    expect(parseCellInput(col('int', { isIdentity: true }), '5').error).toMatch(/database sets/)
  })
})
