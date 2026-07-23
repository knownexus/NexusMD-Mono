import { describe, it, expect } from 'vitest'
import {
  typeOf, getAtPath, setValueAtPath, deleteAtPath, replaceAtPath,
  addFieldAtPath, coerceVal, allContainerPaths, highlightSegments,
} from '../src/views/json-editor-helpers.js'

describe('typeOf', () => {
  it('distinguishes array, null, and primitive types', () => {
    expect(typeOf([1, 2])).toBe('array')
    expect(typeOf(null)).toBe('null')
    expect(typeOf('x')).toBe('string')
    expect(typeOf(1)).toBe('number')
    expect(typeOf(true)).toBe('boolean')
    expect(typeOf({})).toBe('object')
  })
})

describe('getAtPath', () => {
  it('walks nested objects and arrays', () => {
    const data = { a: { b: [10, 20] } }
    expect(getAtPath(data, ['a', 'b', 1])).toBe(20)
    expect(getAtPath(data, [])).toBe(data)
  })
})

describe('setValueAtPath', () => {
  it('replaces a nested value without mutating the original', () => {
    const data = { a: { b: 1 } }
    const next = setValueAtPath(data, ['a', 'b'], 2)
    expect(next).toEqual({ a: { b: 2 } })
    expect(data).toEqual({ a: { b: 1 } })
  })

  it('replaces the root when path is empty', () => {
    expect(setValueAtPath({ a: 1 }, [], { b: 2 })).toEqual({ b: 2 })
  })

  it('replaces an array element by index', () => {
    const data = { list: [1, 2, 3] }
    expect(setValueAtPath(data, ['list', 1], 99)).toEqual({ list: [1, 99, 3] })
  })
})

describe('deleteAtPath', () => {
  it('removes an object key', () => {
    expect(deleteAtPath({ a: 1, b: 2 }, ['a'])).toEqual({ b: 2 })
  })

  it('removes an array item and shifts indices', () => {
    expect(deleteAtPath({ list: [1, 2, 3] }, ['list', 1])).toEqual({ list: [1, 3] })
  })

  it('is a no-op at the root', () => {
    const data = { a: 1 }
    expect(deleteAtPath(data, [])).toBe(data)
  })
})

describe('replaceAtPath', () => {
  it('renames a key while preserving position', () => {
    const data = { a: 1, b: 2, c: 3 }
    expect(Object.keys(replaceAtPath(data, ['b'], 'renamed', 20))).toEqual(['a', 'renamed', 'c'])
  })

  it('keeps the same key when newKey matches the old one', () => {
    expect(replaceAtPath({ a: 1 }, ['a'], 'a', 2)).toEqual({ a: 2 })
  })

  it('ignores newKey for array items', () => {
    expect(replaceAtPath({ list: [1, 2] }, ['list', 0], 'ignored', 9)).toEqual({ list: [9, 2] })
  })

  it('replaces the whole tree at the root', () => {
    expect(replaceAtPath({ a: 1 }, [], undefined, { b: 2 })).toEqual({ b: 2 })
  })
})

describe('addFieldAtPath', () => {
  it('adds a keyed field to an object', () => {
    expect(addFieldAtPath({}, [], 'name', 'Alice')).toEqual({ name: 'Alice' })
  })

  it('pushes onto an array, ignoring key', () => {
    expect(addFieldAtPath({ list: [1] }, ['list'], null, 2)).toEqual({ list: [1, 2] })
  })
})

describe('coerceVal', () => {
  it('coerces each JSON type from raw modal input', () => {
    expect(coerceVal('string', 'hi')).toBe('hi')
    expect(coerceVal('number', '42')).toBe(42)
    expect(coerceVal('number', 'nope')).toBe(0)
    expect(coerceVal('boolean', 'true')).toBe(true)
    expect(coerceVal('boolean', false)).toBe(false)
    expect(coerceVal('null', 'x')).toBe(null)
    expect(coerceVal('object', 'x')).toEqual({})
    expect(coerceVal('array', 'x')).toEqual([])
  })
})

describe('allContainerPaths', () => {
  it('lists every object/array path, including root', () => {
    const data = { a: { b: 1 }, list: [1, [2]] }
    expect(allContainerPaths(data)).toEqual(['', 'a', 'list', 'list.1'])
  })

  it('returns an empty list for a primitive root', () => {
    expect(allContainerPaths(1)).toEqual([])
  })
})

describe('highlightSegments', () => {
  it('returns the whole string unmatched when there is no search term', () => {
    expect(highlightSegments('hello', '')).toEqual([{ text: 'hello', match: false }])
  })

  it('splits out case-insensitive matches', () => {
    expect(highlightSegments('Alice Johnson', 'jo')).toEqual([
      { text: 'Alice ', match: false },
      { text: 'Jo', match: true },
      { text: 'hnson', match: false },
    ])
  })

  it('escapes regex special characters in the search term', () => {
    expect(highlightSegments('a.b', '.')).toEqual([
      { text: 'a', match: false },
      { text: '.', match: true },
      { text: 'b', match: false },
    ])
  })
})
