import { describe, it, expect } from 'vitest'
import { FREE, activeDoc, addDoc, ensureDoc, updateDoc, selectDoc, closeDoc, renameDoc, placeDoc, docsOf } from './db-query-docs.js'

const always = () => true
const never = () => false

describe('query tabs', () => {
  it('keeps each table’s tabs apart', () => {
    let s = addDoc({}, 'patients', { id: 'a', sql: 'SELECT 1' })
    s = addDoc(s, 'staff', { id: 'b', sql: 'SELECT 2' })
    s = addDoc(s, FREE, { id: 'c', sql: 'SELECT 3' })
    expect(activeDoc(s, 'patients').sql).toBe('SELECT 1')
    expect(activeDoc(s, 'staff').sql).toBe('SELECT 2')
    expect(activeDoc(s, FREE).sql).toBe('SELECT 3')
    expect(activeDoc(s, 'nothing')).toBeNull()
  })

  it('names tabs Query 1, Query 2… and shows the newest', () => {
    let s = addDoc({}, 't', { id: 'a' })
    s = addDoc(s, 't', { id: 'b' })
    expect(docsOf(s, 't').map(d => d.name)).toEqual(['Query 1', 'Query 2'])
    expect(activeDoc(s, 't').id).toBe('b')
  })

  it('adds a first tab only when there is none', () => {
    const s = ensureDoc({}, 't', { id: 'a', sql: 'SELECT * FROM [t]' })
    expect(ensureDoc(s, 't', { id: 'b' })).toBe(s)
    expect(docsOf(s, 't')).toHaveLength(1)
  })

  it('updates one tab, by object or function', () => {
    let s = addDoc(addDoc({}, 't', { id: 'a', sql: 'x' }), 't', { id: 'b', sql: 'y' })
    s = updateDoc(s, 't', 'a', d => ({ sql: d.sql + '!' }))
    s = updateDoc(s, 't', 'b', { running: true })
    expect(docsOf(s, 't').map(d => [d.sql, d.running])).toEqual([['x!', false], ['y', true]])
    // A tab that has gone (closed while its query ran) is left alone.
    expect(updateDoc(s, 't', 'gone', { sql: 'z' })).toBe(s)
  })

  it('switches tabs', () => {
    let s = addDoc(addDoc({}, 't', { id: 'a' }), 't', { id: 'b' })
    s = selectDoc(s, 't', 'a')
    expect(activeDoc(s, 't').id).toBe('a')
    expect(selectDoc(s, 't', 'nope')).toBe(s)
  })

  it('closing the tab showing shows its neighbour', () => {
    let s = addDoc(addDoc(addDoc({}, 't', { id: 'a' }), 't', { id: 'b' }), 't', { id: 'c' })
    s = selectDoc(s, 't', 'b')
    s = closeDoc(s, 't', 'b')
    expect(activeDoc(s, 't').id).toBe('c')
    s = closeDoc(s, 't', 'c')
    expect(activeDoc(s, 't').id).toBe('a')
  })

  it('closing the last tab leaves a fresh, empty Query 1', () => {
    let s = addDoc(addDoc({}, 't', { id: 'a', sql: 'x' }), 't', { id: 'b' })
    s = closeDoc(closeDoc(s, 't', 'a'), 't', 'b')
    expect(docsOf(s, 't')).toHaveLength(1)
    expect(activeDoc(s, 't')).toMatchObject({ name: 'Query 1', sql: '' })
  })

  it('renames a tab, ignoring a blank name', () => {
    let s = addDoc({}, 't', { id: 'a' })
    s = renameDoc(s, 't', 'a', '  Monthly totals ')
    expect(activeDoc(s, 't').name).toBe('Monthly totals')
    expect(renameDoc(s, 't', 'a', '  ')).toBe(s)
  })

  describe('placeDoc', () => {
    it('writes over the tab showing when it may, under the new id', () => {
      let s = addDoc({}, 't', { id: 'a', sql: '' })
      s = updateDoc(s, 't', 'a', { result: { rows: [] } })
      s = placeDoc(s, 't', { id: 'n', sql: 'SELECT 9' }, always)
      expect(docsOf(s, 't')).toHaveLength(1)
      expect(activeDoc(s, 't')).toMatchObject({ id: 'n', name: 'Query 1', sql: 'SELECT 9', result: null })
    })

    it('keeps the result when the SQL is the same', () => {
      let s = addDoc({}, 't', { id: 'a', sql: 'SELECT 9' })
      s = updateDoc(s, 't', 'a', { result: { rows: [[9]] } })
      s = placeDoc(s, 't', { id: 'n', sql: 'SELECT 9 ' }, always)
      expect(activeDoc(s, 't').result).toEqual({ rows: [[9]] })
    })

    it('opens a new tab when the one showing has work in it, or is running', () => {
      let s = addDoc({}, 't', { id: 'a', sql: 'mine' })
      s = placeDoc(s, 't', { id: 'n', sql: 'SELECT 9' }, never)
      expect(docsOf(s, 't').map(d => d.sql)).toEqual(['mine', 'SELECT 9'])
      s = updateDoc(s, 't', 'n', { running: true })
      s = placeDoc(s, 't', { id: 'm', sql: 'SELECT 8' }, always)
      expect(docsOf(s, 't')).toHaveLength(3)
      expect(activeDoc(s, 't').id).toBe('m')
    })

    it('makes the first tab when the table has none', () => {
      const s = placeDoc({}, 't', { id: 'n', sql: 'SELECT 1', table: 't' }, always)
      expect(activeDoc(s, 't')).toMatchObject({ id: 'n', sql: 'SELECT 1', table: 't' })
    })
  })
})
