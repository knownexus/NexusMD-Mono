import { describe, it, expect } from 'vitest'
import { wordMatch, filterByWords, filterFilesByWords } from './word-match.js'

describe('wordMatch', () => {
  it('matches the start of the text and of words after symbols', () => {
    expect(wordMatch('fix/qrcode-response', 'fix')).toBe(true)
    expect(wordMatch('fix/qrcode-response', 'qr')).toBe(true)
    expect(wordMatch('fix/qrcode-response', 'resp')).toBe(true)
    expect(wordMatch('Admin_Portal', 'portal')).toBe(true)
    expect(wordMatch('docs/qr-codes.md', 'md')).toBe(true)
  })

  it('never matches the middle of a word', () => {
    expect(wordMatch('fix/qrcode-response', 'code')).toBe(false)
    expect(wordMatch('MobileApp', 'app')).toBe(false)
    expect(wordMatch('feature/womens-gym', 'mens')).toBe(false)
  })

  it('needs every term, in any order, case-insensitively', () => {
    expect(wordMatch('Joiners feature/womens-gym-decoupling', 'gym JOIN')).toBe(true)
    expect(wordMatch('Joiners feature/womens-gym-decoupling', 'gym mobile')).toBe(false)
    expect(wordMatch('anything', '   ')).toBe(true)
  })

  it('treats regex characters literally', () => {
    expect(wordMatch('release/v2.1', 'v2.1')).toBe(true)
    expect(wordMatch('release/v2x1', 'v2.1')).toBe(false)
    expect(() => wordMatch('a(b', '(b')).not.toThrow()
  })
})

describe('filterByWords', () => {
  it('keeps order and passes everything for an empty query', () => {
    const items = [{ n: 'feature/a' }, { n: 'fix/b' }, { n: 'feature/c' }]
    expect(filterByWords(items, 'feat', i => i.n).map(i => i.n)).toEqual(['feature/a', 'feature/c'])
    expect(filterByWords(items, '', i => i.n)).toBe(items)
  })
})

describe('filterFilesByWords', () => {
  it('ranks basename matches first, then shorter paths', () => {
    const files = ['src/qr/views/home.tsx', 'Controllers/QRCodeController.cs', 'docs/qr-codes.md', 'src/barcode.ts']
    const out = filterFilesByWords(files, 'qr')
    expect(out).toEqual(['docs/qr-codes.md', 'Controllers/QRCodeController.cs', 'src/qr/views/home.tsx'])
    expect(out).not.toContain('src/barcode.ts')
  })

  it('caps the list', () => {
    const files = Array.from({ length: 200 }, (_, i) => `src/file-${i}.js`)
    expect(filterFilesByWords(files, 'file')).toHaveLength(50)
    expect(filterFilesByWords(files, '', 10)).toHaveLength(10)
  })
})
