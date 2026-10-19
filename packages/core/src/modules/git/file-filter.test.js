import { describe, it, expect } from 'vitest'
import { filterFiles } from './file-filter.js'

describe('filterFiles', () => {
  it('matches a subsequence case-insensitively', () => {
    const files = ['src/views/git/view-git.jsx', 'README.md', 'docs/notes.txt']
    expect(filterFiles(files, 'VGJ')).toEqual(['src/views/git/view-git.jsx'])
    expect(filterFiles(files, 'readme')).toEqual(['README.md'])
    expect(filterFiles(files, 'zzz')).toEqual([])
  })

  it('ranks basename matches first', () => {
    const files = ['src/app/view.jsx', 'src/views/git/view-git.jsx', 'docs/vgit.md']
    const out = filterFiles(files, 'view')
    expect(out[0]).toBe('src/app/view.jsx')
    expect(out).toContain('src/views/git/view-git.jsx')
    expect(filterFiles(files, '')).toEqual(files)
  })

  it('caps the list and the matches', () => {
    const files = Array.from({ length: 60000 }, (_, i) => `packages/pkg${i % 97}/src/dir${i % 13}/file-${i}.js`)
    const t = performance.now()
    expect(filterFiles(files, 'fl')).toHaveLength(50)
    expect(filterFiles(files, '', 50)).toHaveLength(50)
    // Windows runners are slow; the point is that it doesn't freeze.
    expect(performance.now() - t).toBeLessThan(1000)
  })
})

describe('filterFiles span', () => {
  it('measures the shortest matched span', () => {
    // Both have the same basename match status and length; only the best window differs (axxab: 2, a-x-b: 3).
    const out = filterFiles(['d/a-x-b', 'd/axxab'], 'ab')
    expect(out).toEqual(['d/axxab', 'd/a-x-b'])
  })
})
