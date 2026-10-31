import { describe, it, expect } from 'vitest'
import { searchPaths, validateKey, editNode, addChild, removeNode, describePath, pathKey, rawOf } from './json-tree.js'

const data = { name: 'Alice', age: 28, tags: ['dev', 'mentor'], address: { city: 'Bristol', zip: 'BS1' } }

describe('searching the tree', () => {
  it('keeps matching nodes and the containers above them', () => {
    const { show, count, active } = searchPaths(data, 'bristol')
    expect(active).toBe(true)
    expect(count).toBe(1)
    expect([...show].sort()).toEqual([pathKey([]), pathKey(['address']), pathKey(['address', 'city'])].sort())
  })
  it('matches on keys as well as values, case-insensitively', () => {
    const r = searchPaths(data, 'TAGS')
    expect(r.show.has(pathKey(['tags']))).toBe(true)
    expect(r.count).toBe(1)
  })
  it('is inactive for an empty search and finds nothing for a miss', () => {
    expect(searchPaths(data, '  ').active).toBe(false)
    expect(searchPaths(data, 'zzz')).toMatchObject({ count: 0, active: true })
    expect(searchPaths(data, 'zzz').show.size).toBe(0)
  })
})

describe('checking a key', () => {
  it('needs a name that no sibling uses', () => {
    expect(validateKey({ a: 1 }, ' ', undefined)).toMatch(/name/)
    expect(validateKey({ a: 1, b: 2 }, 'b', 'a')).toMatch(/already/)
    expect(validateKey({ a: 1 }, 'a', 'a')).toBe('')
    expect(validateKey([1, 2], '', undefined)).toBe('')
  })
})

describe('editing a node', () => {
  it('changes a value without touching the original', () => {
    const r = editNode(data, ['name'], { key: 'name', type: 'string', raw: 'Bob' })
    expect(r.next.name).toBe('Bob')
    expect(data.name).toBe('Alice')
  })
  it('renames a key in place, keeping the order', () => {
    const r = editNode(data, ['age'], { key: 'years', type: 'number', raw: '29' })
    expect(Object.keys(r.next)).toEqual(['name', 'years', 'tags', 'address'])
    expect(r.next.years).toBe(29)
  })
  it('changes the type, and keeps a group\'s contents when only its name changes', () => {
    expect(editNode(data, ['age'], { key: 'age', type: 'string', raw: '28' }).next.age).toBe('28')
    expect(editNode(data, ['address'], { key: 'home', type: 'object', raw: '' }).next.home).toEqual(data.address)
    expect(editNode(data, ['address'], { key: 'address', type: 'null', raw: '' }).next.address).toBeNull()
  })
  it('refuses a clashing key or a non-number', () => {
    expect(editNode(data, ['age'], { key: 'name', type: 'number', raw: '1' }).error).toMatch(/already/)
    expect(editNode(data, ['age'], { key: 'age', type: 'number', raw: 'abc' }).error).toMatch(/not a number/)
    expect(editNode(data, ['age'], { key: 'age', type: 'number', raw: '' }).error).toMatch(/Enter a number/)
  })
  it('edits a list item without a key', () => {
    expect(editNode(data, ['tags', 1], { key: 1, type: 'string', raw: 'lead' }).next.tags).toEqual(['dev', 'lead'])
  })
})

describe('adding and removing', () => {
  it('adds a field to a group and an item to a list', () => {
    expect(addChild(data, ['address'], { key: 'country', type: 'string', raw: 'UK' }).next.address).toEqual({ city: 'Bristol', zip: 'BS1', country: 'UK' })
    expect(addChild(data, ['tags'], { key: '', type: 'string', raw: 'new' }).next.tags).toEqual(['dev', 'mentor', 'new'])
    expect(addChild(data, ['address'], { key: 'city', type: 'string', raw: 'x' }).error).toMatch(/already/)
  })
  it('adds to the top-level group', () => {
    expect(addChild({ a: 1 }, [], { key: 'b', type: 'boolean', raw: 'true' }).next).toEqual({ a: 1, b: true })
  })
  it('removes a node and describes where it was', () => {
    expect(removeNode(data, ['tags', 0]).tags).toEqual(['mentor'])
    expect(removeNode(data, ['age'])).not.toHaveProperty('age')
    expect(describePath(['address', 'city'])).toBe('address › city')
    expect(describePath([])).toBe('Whole document')
    expect(rawOf('x')).toBe('x'); expect(rawOf(5)).toBe('5'); expect(rawOf(null)).toBe(''); expect(rawOf({})).toBe('')
  })
})
