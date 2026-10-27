// packages/ui/src/views/db-min-cols.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readMinCols, writeMinCols } from './db-min-cols.js'

beforeEach(() => { window.localStorage.clear() })
afterEach(() => { vi.restoreAllMocks() })

describe('minimised columns store', () => {
  it('round-trips the names for one connection and table', () => {
    writeMinCols('uat', 'patients', ['name', 'dob'])
    expect(readMinCols('uat', 'patients')).toEqual(['name', 'dob'])
    expect(readMinCols('uat', 'staff')).toEqual([])
    expect(readMinCols('prod', 'patients')).toEqual([])
  })

  it('reads nothing back once every column is shown again', () => {
    writeMinCols('uat', 'patients', ['name'])
    writeMinCols('uat', 'patients', [])
    expect(readMinCols('uat', 'patients')).toEqual([])
    expect(window.localStorage.getItem('nx-db:min-cols:uat:patients')).toBeNull()
  })

  it('treats bad JSON or a non-list as none', () => {
    window.localStorage.setItem('nx-db:min-cols:uat:patients', '{nope')
    expect(readMinCols('uat', 'patients')).toEqual([])
    window.localStorage.setItem('nx-db:min-cols:uat:patients', '{"a":1}')
    expect(readMinCols('uat', 'patients')).toEqual([])
  })

  it('treats unavailable storage as none and does not throw on write', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readMinCols('uat', 'patients')).toEqual([])
    expect(() => writeMinCols('uat', 'patients', ['name'])).not.toThrow()
  })
})
