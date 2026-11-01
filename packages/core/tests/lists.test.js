import { describe, it, expect } from 'vitest'
import {
  readLists, writeLists, newListId, toBucket, safeListUrl,
  FIELD_DEFS, DEFAULT_STATUSES, DEFAULT_FIELDS, PRIORITY_LABELS, BUCKET_ORDER, BUCKET_LABELS,
} from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    get length() { return m.size }, key: i => [...m.keys()][i] ?? null,
  }
}
const getProfileKey = k => k.replace('helm.', 'helm.p.p1.')

describe('readLists', () => {
  it('returns { lists: [] } for empty, non-JSON and missing storage', () => {
    const KEY = 'helm.p.p1.lists'
    expect(readLists({ storage: memStorage(), getProfileKey, namespace: 'helm' })).toEqual({ lists: [] })
    expect(readLists({ storage: memStorage({ [KEY]: '' }), getProfileKey, namespace: 'helm' })).toEqual({ lists: [] })
    expect(readLists({ storage: memStorage({ [KEY]: '{not json' }), getProfileKey, namespace: 'helm' })).toEqual({ lists: [] })
    expect(readLists({ storage: memStorage({ [KEY]: 'null' }), getProfileKey, namespace: 'helm' })).toEqual({ lists: [] })
    expect(readLists({ storage: undefined, getProfileKey, namespace: 'helm' })).toEqual({ lists: [] })
  })

  it('always returns a lists array of objects for malformed stored values', () => {
    const KEY = 'helm.p.p1.lists'
    const read = (raw) => readLists({ storage: memStorage({ [KEY]: raw }), getProfileKey, namespace: 'helm' })
    expect(read('{}')).toEqual({ lists: [] })
    expect(read('[]')).toEqual({ lists: [] })
    expect(read('{"lists":null}')).toEqual({ lists: [] })
    expect(read('{"lists":"x"}')).toEqual({ lists: [] })
    expect(read('{"lists":[null,{"id":"a"}]}')).toEqual({ lists: [{ id: 'a' }] })
  })

  it('reads the mobile key helm.lists under the profile scope', () => {
    const storage = memStorage({ 'helm.p.p1.lists': JSON.stringify({ lists: [{ id: 'a', name: 'A' }] }) })
    expect(readLists({ storage, getProfileKey, namespace: 'helm' })).toEqual({ lists: [{ id: 'a', name: 'A' }] })
  })
})

describe('writeLists', () => {
  it('writeLists then readLists round-trips', () => {
    const storage = memStorage()
    const ctx = { storage, getProfileKey: k => k, namespace: 'nexusmd' }
    const data = { lists: [{ id: 'a', name: 'A', color: '#6c8ebf', fields: DEFAULT_FIELDS, items: [{ id: '1', title: 'x' }] }] }
    writeLists(ctx, data)
    expect(storage.getItem('nexusmd.lists')).toBe(JSON.stringify(data))
    expect(readLists(ctx)).toEqual(data)
  })
})

describe('newListId', () => {
  it('returns distinct non-empty strings', () => {
    const a = newListId(), b = newListId()
    expect(typeof a).toBe('string')
    expect(a.length).toBeGreaterThan(0)
    expect(a).not.toBe(b)
  })
})

describe('toBucket', () => {
  it('maps statuses to board buckets', () => {
    expect(toBucket('Closed')).toBe('done')
    expect(toBucket('Blocked by X')).toBe('blocked')
    expect(toBucket('Doing')).toBe('inprogress')
    expect(toBucket('')).toBe('notstarted')
    expect(toBucket(undefined)).toBe('notstarted')
  })
})

describe('Lists constants', () => {
  it('match the mobile values', () => {
    expect(FIELD_DEFS.map(f => f.id)).toEqual(['owner', 'status', 'due', 'priority', 'notes', 'number', 'url', 'check'])
    expect(FIELD_DEFS.find(f => f.id === 'check')).toEqual({ id: 'check', label: 'Checkbox', type: 'boolean' })
    expect(PRIORITY_LABELS).toEqual(['P1', 'P2', 'P3', 'P4'])
    expect(DEFAULT_STATUSES).toEqual(['Not started', 'In progress', 'Done', 'Blocked'])
    expect(DEFAULT_FIELDS).toEqual(['owner', 'status', 'due', 'priority', 'notes'])
    expect(BUCKET_ORDER).toEqual(['notstarted', 'inprogress', 'done', 'blocked'])
    expect(BUCKET_LABELS).toEqual({ notstarted: 'Not started', inprogress: 'In progress', done: 'Done', blocked: 'Blocked' })
  })
})

describe('safeListUrl', () => {
  it('accepts http and https URLs', () => {
    expect(safeListUrl('https://a.com/x')).toBe('https://a.com/x')
    expect(safeListUrl('http://a.com')).toBe('http://a.com')
  })
  it('rejects other schemes, malformed strings and non-strings', () => {
    for (const v of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'ftp://a.com', 'not a url', '',
      ' https://a.com', 'https://a.com ', '\tjavascript:alert(1)', 42, null, undefined, {}]) {
      expect(safeListUrl(v)).toBeNull()
    }
  })
})
