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
