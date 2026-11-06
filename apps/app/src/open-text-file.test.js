import { describe, it, expect } from 'vitest'
import { addOpenedDocument, documentNameOf, MAX_OPEN_BYTES } from './open-text-file.js'

const store = (seed) => {
  const m = new Map(seed ? [['md_documents', JSON.stringify(seed)]] : [])
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, docs: () => JSON.parse(m.get('md_documents') || '{"docs":[]}').docs }
}

describe('documentNameOf', () => {
  it('is the file name without its extension', () => {
    expect(documentNameOf('notes.md')).toBe('notes')
    expect(documentNameOf('Meeting notes 2026-11-05.markdown')).toBe('Meeting notes 2026-11-05')
    expect(documentNameOf('todo.txt')).toBe('todo')
    expect(documentNameOf('archive.tar.txt')).toBe('archive.tar')
  })
  it('copes with a name that has no extension, a folder in it, or nothing at all', () => {
    expect(documentNameOf('README')).toBe('README')
    expect(documentNameOf('docs/readme.md')).toBe('readme')
    expect(documentNameOf('')).toBeNull()
    expect(documentNameOf(undefined)).toBeNull()
    expect(documentNameOf('.md')).toBeNull()
  })
})

describe('addOpenedDocument', () => {
  it('adds the file as a new saved document, named after the file, and says which one it is', () => {
    const s = store()
    const r = addOpenedDocument(s, { name: 'notes.md', text: '# Plan\n\nTwo things.' }, { now: 1000, id: 'd1' })
    expect(r).toEqual({ id: 'd1', created: true })
    expect(s.docs()).toEqual([{ id: 'd1', name: 'notes', autoName: 'Plan', content: '# Plan\n\nTwo things.', createdAt: 1000, updatedAt: 1000 }])
  })

  it('keeps the documents that are already there, and puts this one newest so the Documents page opens on it', () => {
    const s = store({ docs: [{ id: 'old', name: null, autoName: 'Old', content: 'old', createdAt: 1, updatedAt: 5 }] })
    addOpenedDocument(s, { name: 'new.txt', text: 'hello' }, { now: 9000, id: 'd2' })
    const docs = s.docs()
    expect(docs.map(d => d.id)).toEqual(['old', 'd2'])
    expect([...docs].sort((a, b) => b.updatedAt - a.updatedAt)[0].id).toBe('d2')
  })

  it('opening the same file again (same name, same text) brings the existing document forward instead of making a copy', () => {
    const s = store({ docs: [{ id: 'd1', name: 'notes', autoName: 'Plan', content: '# Plan', createdAt: 1, updatedAt: 2 }, { id: 'other', name: null, autoName: 'Other', content: 'x', createdAt: 1, updatedAt: 50 }] })
    const r = addOpenedDocument(s, { name: 'notes.md', text: '# Plan' }, { now: 9000, id: 'unused' })
    expect(r).toEqual({ id: 'd1', created: false })
    expect(s.docs()).toHaveLength(2)
    expect(s.docs().find(d => d.id === 'd1').updatedAt).toBe(9000)
  })

  it('a file with the same name but different text is a new document (the file changed)', () => {
    const s = store({ docs: [{ id: 'd1', name: 'notes', autoName: 'Plan', content: '# Plan', createdAt: 1, updatedAt: 2 }] })
    expect(addOpenedDocument(s, { name: 'notes.md', text: '# Plan v2' }, { now: 9000, id: 'd2' })).toEqual({ id: 'd2', created: true })
    expect(s.docs()).toHaveLength(2)
  })

  it('removes a byte order mark and turns Windows line endings into plain ones', () => {
    const s = store()
    addOpenedDocument(s, { name: 'a.md', text: '﻿# Title\r\nline\r\n' }, { now: 1, id: 'd1' })
    expect(s.docs()[0].content).toBe('# Title\nline\n')
    expect(s.docs()[0].autoName).toBe('Title')
  })

  it('an empty file still opens as an empty document', () => {
    const s = store()
    expect(addOpenedDocument(s, { name: 'empty.txt', text: '' }, { now: 1, id: 'd1' })).toEqual({ id: 'd1', created: true })
    expect(s.docs()[0]).toMatchObject({ name: 'empty', content: '', autoName: 'Untitled' })
  })

  it('refuses text over the size limit rather than putting it in storage', () => {
    const s = store()
    const big = 'x'.repeat(MAX_OPEN_BYTES + 1)
    expect(() => addOpenedDocument(s, { name: 'big.txt', text: big }, { now: 1, id: 'd1' })).toThrow(/too large/)
    expect(s.docs()).toEqual([])
  })

  it('says so when storage is full, and leaves what was there alone', () => {
    const s = store({ docs: [{ id: 'd1', name: null, autoName: 'A', content: 'a', createdAt: 1, updatedAt: 1 }] })
    s.setItem = () => { throw new Error('QuotaExceededError') }
    expect(() => addOpenedDocument(s, { name: 'a.md', text: 'new' }, { now: 2, id: 'd2' })).toThrow(/could not be saved/)
    expect(s.docs()).toHaveLength(1)
  })

  it('does not write over saved documents it cannot read: it says so and leaves them exactly as they are', () => {
    const m = new Map([['md_documents', '{ torn']])
    const s = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }
    expect(() => addOpenedDocument(s, { name: 'a.md', text: 'hi' }, { now: 1, id: 'd1' })).toThrow(/could not be read/)
    expect(m.get('md_documents')).toBe('{ torn')
  })
})

describe('addOpenedDocument: which store', () => {
  it('writes to the key it is told to (the tablet layout keeps documents under the profile)', () => {
    const m = new Map()
    const s = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }
    addOpenedDocument(s, { name: 'a.md', text: 'x' }, { now: 1, id: 'd1', key: 'helm.p1.md_documents' })
    expect([...m.keys()]).toEqual(['helm.p1.md_documents'])
  })
})
