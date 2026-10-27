import { describe, it, expect } from 'vitest'
import { fileMarks } from './file-marks.js'

const staged = (path, x) => ({ path, area: 'staged', xy: `${x}.` })
const unstaged = (path, y) => ({ path, area: 'unstaged', xy: `.${y}` })
const untracked = path => ({ path, area: 'untracked', xy: '??' })
const conflict = path => ({ path, area: 'conflict', xy: 'UU' })
const letters = changes => Object.fromEntries([...fileMarks(changes).files].map(([p, m]) => [p, m.letter]))

describe('fileMarks', () => {
  it('marks new files A, staged or not, and the rest M, D or U', () => {
    expect(letters([
      untracked('new.txt'), staged('added.js', 'A'), unstaged('edited.md', 'M'), staged('gone.css', 'D'),
      staged('moved.js', 'R'), conflict('both.txt'),
    ])).toEqual({ 'new.txt': 'A', 'added.js': 'A', 'edited.md': 'M', 'gone.css': 'D', 'moved.js': 'M', 'both.txt': 'U' })
  })

  it('shows the letter that matters most for a file changed in two areas', () => {
    expect(letters([staged('a.js', 'A'), unstaged('a.js', 'M')])).toEqual({ 'a.js': 'A' })
    expect(letters([unstaged('b.js', 'M'), staged('b.js', 'D')])).toEqual({ 'b.js': 'D' })
  })

  it('counts the changed files under every folder', () => {
    const { dirs } = fileMarks([untracked('src/a.js'), unstaged('src/ui/b.js', 'M'), unstaged('README.md', 'M')])
    expect(Object.fromEntries(dirs)).toEqual({ src: 2, 'src/ui': 1 })
  })

  it('copes with no changes', () => {
    expect(fileMarks().files.size).toBe(0)
    expect(fileMarks(undefined).dirs.size).toBe(0)
  })
})
