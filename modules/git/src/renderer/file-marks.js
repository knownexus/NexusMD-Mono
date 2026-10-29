import { statusCode } from '@nexusmd/core'

// What the Files tab marks each changed file with, from the worktree's changes: one mark per area the
// file is changed in, in the Changes tab's colours (staged green, not staged amber, conflicts red) and
// untracked files blue with the Changes tab's "?". A file staged and then edited again has two marks.
const AREAS = ['conflict', 'staged', 'unstaged', 'untracked']
const TONE = { conflict: 'bad', staged: 'ok', unstaged: 'warn', untracked: 'info' }
// The name (and a folder's dot) takes the colour of what most needs doing: a conflict, then work not
// staged yet, then new files, then staged work.
const PRESSING = ['conflict', 'unstaged', 'untracked', 'staged']
const KIND = { A: ['A', 'added'], C: ['A', 'added'], D: ['D', 'deleted'], R: ['R', 'renamed'] }

function markOf(c) {
  if (c.area === 'conflict') return { area: 'conflict', letter: 'U', tone: 'bad', label: 'Conflicted' }
  if (c.area === 'untracked') return { area: 'untracked', letter: '?', tone: 'info', label: 'Untracked' }
  const [letter, word] = KIND[statusCode(c).trim()] ?? ['M', 'modified']
  const area = c.area === 'staged' ? 'staged' : 'unstaged'
  return { area, letter, tone: TONE[area], label: `${area === 'staged' ? 'Staged' : 'Not staged'}: ${word}` }
}

const pressing = areas => PRESSING.find(a => areas.includes(a))

/**
 * { files: Map(path -> { tone, marks: [{ area, letter, tone, label }] }),
 *   dirs: Map(folder -> { count of changed files under it, tone }) }
 */
export function fileMarks(changes = []) {
  const byPath = new Map()
  for (const c of changes ?? []) {
    if (!c?.path) continue
    const m = markOf(c)
    const list = byPath.get(c.path) ?? []
    if (!list.some(x => x.area === m.area)) list.push(m)
    byPath.set(c.path, list)
  }
  const files = new Map()
  for (const [path, list] of byPath) {
    const marks = list.sort((a, b) => AREAS.indexOf(a.area) - AREAS.indexOf(b.area))
    files.set(path, { tone: TONE[pressing(marks.map(m => m.area))], marks })
  }
  const areasUnder = new Map()
  for (const [path, { marks }] of files) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/')
      const had = areasUnder.get(dir) ?? { count: 0, areas: [] }
      areasUnder.set(dir, { count: had.count + 1, areas: [...had.areas, ...marks.map(m => m.area)] })
    }
  }
  const dirs = new Map([...areasUnder].map(([dir, { count, areas }]) => [dir, { count, tone: TONE[pressing(areas)] }]))
  return { files, dirs }
}
