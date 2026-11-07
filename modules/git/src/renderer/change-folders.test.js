import { describe, it, expect } from 'vitest'
import { groupByFolder, filterChanges, BIG_LANE } from './change-folders.js'

const c = (path, area = 'untracked', xy = '??') => ({ id: `${area}\0${path}`, path, area, xy })

describe('groupByFolder', () => {
  it('groups changes by their folder with a trailing slash, counting each, sorted by path', () => {
    const groups = groupByFolder([c('b/x.js'), c('a/y.js'), c('b/z.js'), c('top.txt')])
    expect(groups.map(g => [g.path, g.count])).toEqual([['./', 1], ['a/', 1], ['b/', 2]])
    expect(groups[2].files.map(f => f.path)).toEqual(['b/x.js', 'b/z.js'])
  })

  it('names the dominant status letter, breaking ties by severity (U, D, M, A, ?)', () => {
    const mod = (p) => c(p, 'unstaged', '.M')
    const del = (p) => c(p, 'unstaged', '.D')
    expect(groupByFolder([mod('d/a'), mod('d/b'), del('d/c')])[0].letter).toBe('M')
    expect(groupByFolder([mod('d/a'), del('d/c')])[0].letter).toBe('D')
    expect(groupByFolder([mod('d/a'), c('d/n')])[0].letter).toBe('M')
    expect(groupByFolder([c('d/n'), c('d/m', 'conflict', 'UU')])[0].letter).toBe('U')
  })

  it('groups tens of thousands of files in one pass', () => {
    const many = Array.from({ length: 50000 }, (_, i) => c(`dist/${i % 10}/f${i}.js`))
    const t = Date.now()
    const groups = groupByFolder(many)
    expect(groups).toHaveLength(10)
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(50000)
    expect(Date.now() - t).toBeLessThan(1000)
  })
})

describe('filterChanges', () => {
  it('keeps every change for an empty query', () => {
    const list = [c('a.js'), c('b.js')]
    expect(filterChanges(list, '  ')).toBe(list)
  })

  it('matches from the start of words in the path', () => {
    const list = [c('src/components/Button.jsx'), c('src/util.js'), c('docs/readme.md')]
    expect(filterChanges(list, 'src comp').map(x => x.path)).toEqual(['src/components/Button.jsx'])
    expect(filterChanges(list, 'omp')).toEqual([])
  })
})

describe('BIG_LANE', () => {
  it('is 50: a lane with more changes than that gets the filter and the folder view', () => {
    expect(BIG_LANE).toBe(50)
  })
})
