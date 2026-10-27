import { statusCode } from '@nexusmd/core'

// What the Files tab marks each changed file with, from the worktree's changes. The letters and tones
// are the Changes tab's, except that a new file is A whether it is staged or not: in a tree of files,
// "untracked" just means added. A file changed in more than one area (staged and then edited again)
// shows the one that matters most: conflict, then added, then deleted, then modified.
const MARKS = {
  U: { letter: 'U', tone: 'bad', label: 'Conflicted' },
  A: { letter: 'A', tone: 'ok', label: 'Added' },
  D: { letter: 'D', tone: 'bad', label: 'Deleted' },
  M: { letter: 'M', tone: 'warn', label: 'Modified' },
}
const RANK = ['U', 'A', 'D', 'M']

function markOf(c) {
  if (c.area === 'conflict') return 'U'
  if (c.area === 'untracked') return 'A'
  const code = statusCode(c).trim()
  if (code === 'A' || code === 'C') return 'A'   // copied counts as a new file
  if (code === 'D') return 'D'
  return 'M'                                     // M, R (renamed), T (type changed)
}

// { files: Map(path -> { letter, tone, label }), dirs: Map(folder -> number of changed files under it) }
export function fileMarks(changes = []) {
  const files = new Map()
  for (const c of changes) {
    if (!c?.path) continue
    const m = markOf(c)
    const had = files.get(c.path)
    if (!had || RANK.indexOf(m) < RANK.indexOf(had.letter)) files.set(c.path, MARKS[m])
  }
  const dirs = new Map()
  for (const path of files.keys()) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/')
      dirs.set(dir, (dirs.get(dir) ?? 0) + 1)
    }
  }
  return { files, dirs }
}
