import { describe, it, expect } from 'vitest'
import { fileMarks } from './file-marks.js'

const staged = (path, x) => ({ path, area: 'staged', xy: `${x}.` })
const unstaged = (path, y) => ({ path, area: 'unstaged', xy: `.${y}` })
const untracked = path => ({ path, area: 'untracked', xy: '??' })
const conflict = path => ({ path, area: 'conflict', xy: 'UU' })
const of = (changes, path) => fileMarks(changes).files.get(path)

describe('fileMarks', () => {
  it('marks each file by where its change is: staged green, not staged amber, untracked blue ?, conflicted red U', () => {
    const changes = [staged('added.js', 'A'), unstaged('edited.md', 'M'), untracked('new.txt'), conflict('both.txt'), staged('gone.css', 'D')]
    expect(of(changes, 'added.js')).toMatchObject({ tone: 'ok', marks: [{ area: 'staged', letter: 'A', tone: 'ok', label: 'Staged: added' }] })
    expect(of(changes, 'edited.md')).toMatchObject({ tone: 'warn', marks: [{ area: 'unstaged', letter: 'M', tone: 'warn', label: 'Not staged: modified' }] })
    expect(of(changes, 'new.txt')).toMatchObject({ tone: 'info', marks: [{ area: 'untracked', letter: '?', tone: 'info', label: 'Untracked' }] })
    expect(of(changes, 'both.txt')).toMatchObject({ tone: 'bad', marks: [{ area: 'conflict', letter: 'U', tone: 'bad', label: 'Conflicted' }] })
    expect(of(changes, 'gone.css').marks[0]).toMatchObject({ letter: 'D', label: 'Staged: deleted' })
  })

  it('shows both marks for a file staged and then edited again, and colours its name by what is still to do', () => {
    const m = of([unstaged('a.js', 'M'), staged('a.js', 'M')], 'a.js')
    expect(m.marks.map(x => x.area)).toEqual(['staged', 'unstaged'])
    expect(m.tone).toBe('warn')
  })

  it('names renamed and type-changed files', () => {
    expect(of([staged('moved.js', 'R')], 'moved.js').marks[0]).toMatchObject({ letter: 'R', label: 'Staged: renamed' })
    expect(of([unstaged('link', 'T')], 'link').marks[0]).toMatchObject({ letter: 'M', label: 'Not staged: modified' })
  })

  it('counts the changed files under every folder, coloured by the most pressing one', () => {
    const { dirs } = fileMarks([untracked('src/a.js'), staged('src/ui/b.js', 'M'), unstaged('README.md', 'M'), conflict('src/ui/c.js')])
    expect(Object.fromEntries(dirs)).toEqual({ src: { count: 3, tone: 'bad' }, 'src/ui': { count: 2, tone: 'bad' } })
    expect(Object.fromEntries(fileMarks([staged('lib/x.js', 'A'), untracked('lib/y.js')]).dirs)).toEqual({ lib: { count: 2, tone: 'info' } })
  })

  it('copes with no changes', () => {
    expect(fileMarks().files.size).toBe(0)
    expect(fileMarks(undefined).dirs.size).toBe(0)
  })
})
