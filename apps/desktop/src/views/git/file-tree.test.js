import { describe, it, expect } from 'vitest'
import { buildFileTree, dropFolder, importSummary } from './file-tree.js'

describe('buildFileTree', () => {
  const tree = buildFileTree(['b.txt', 'src/z.js', 'src/views/a.jsx', 'src/a.js', 'docs/x.md'])
  it('nests folders, folders and files each sorted by name', () => {
    expect(tree.dirs.map(d => d.path)).toEqual(['docs', 'src'])
    const src = tree.dirs[1]
    expect(src.dirs.map(d => d.path)).toEqual(['src/views'])
    expect(src.files.map(f => f.path)).toEqual(['src/a.js', 'src/z.js'])
    expect(tree.files).toEqual([{ name: 'b.txt', path: 'b.txt' }])
  })
  it('is an empty root for no files', () => {
    expect(buildFileTree([])).toEqual({ name: '', path: '', dirs: [], files: [] })
  })
})

describe('dropFolder', () => {
  it('is a folder row itself and a file row’s folder', () => {
    expect(dropFolder({ kind: 'dir', path: 'src/views' })).toBe('src/views')
    expect(dropFolder({ kind: 'file', path: 'src/a.js' })).toBe('src')
    expect(dropFolder({ kind: 'file', path: 'b.txt' })).toBe('')
  })
})

describe('importSummary', () => {
  it('names the unit once', () => {
    expect(importSummary({ added: 2, replaced: 1, skipped: 1 })).toBe('Added 2 files, replaced 1, skipped 1.')
    expect(importSummary({ added: 1 })).toBe('Added 1 file.')
    expect(importSummary({ skipped: 3 })).toBe('Skipped 3 files.')
    expect(importSummary({ added: 1, failed: [{}] })).toBe('Added 1 file, 1 failed.')
    expect(importSummary({})).toBe('Nothing to copy.')
  })
})
