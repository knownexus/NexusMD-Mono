import { describe, it, expect } from 'vitest'
import { fileStats, formatSize } from './file-stats.js'

describe('fileStats', () => {
  it('counts the lines of an LF file, not a trailing newline, and names the language', () => {
    expect(fileStats('one\ntwo\nthree\n', 'src/a.js')).toEqual({ language: 'JavaScript', lines: 3, bytes: 14, eol: 'LF', encoding: 'UTF-8' })
  })

  it('says CRLF, Mixed and None for the line endings', () => {
    expect(fileStats('a\r\nb\r\n', 'x.txt').eol).toBe('CRLF')
    expect(fileStats('a\r\nb\nc', 'x.txt').eol).toBe('Mixed')
    expect(fileStats('single', 'x.txt').eol).toBe('None')
  })

  it('treats an empty file as no lines, and an unknown extension as plain text', () => {
    expect(fileStats('', 'notes')).toEqual({ language: 'Plain text', lines: 0, bytes: 0, eol: 'None', encoding: 'UTF-8' })
  })

  it('counts bytes, not characters, for text outside ASCII', () => {
    expect(fileStats('é', 'x.txt').bytes).toBe(2)
  })

  it('counts a line with no final newline', () => {
    expect(fileStats('a\nb', 'x.txt').lines).toBe(2)
  })

  it('handles a megabyte of text', () => {
    const big = 'x'.repeat(79) + '\n'
    const text = big.repeat(13108)
    const stats = fileStats(text, 'big.txt')
    expect(stats.lines).toBe(13108)
    expect(formatSize(stats.bytes)).toBe('1.0 MB')
  })
})

describe('formatSize', () => {
  it('reads in B, KB and MB', () => {
    expect(formatSize(14)).toBe('14 B')
    expect(formatSize(1536)).toBe('1.5 KB')
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})
