import { wordMatch } from '@nexusmd/core'

/** A lane with more changes than this gets the filter field and the Folders | Flat switch. */
export const BIG_LANE = 50

// Worst first: the letter a folder shows when its files differ and none is commoner than another.
const SEVERITY = ['U', 'D', 'M', 'A', '?']

function letterOf(c) {
  if (c.area === 'conflict') return 'U'
  if (c.area === 'untracked') return '?'
  const code = c.area === 'staged' ? (c.xy?.[0] ?? 'M') : (c.xy?.[1] ?? 'M')
  return !code || code === '.' ? 'M' : code
}

/**
 * Changes grouped by folder in one pass: [{ path: 'apps/web/', count, letter, files }], sorted by path.
 * `letter` is the commonest status letter in the folder, the worse one on a tie. Files in the root
 * are under './'.
 */
export function groupByFolder(changes) {
  const byPath = new Map()
  for (const change of changes) {
    const i = change.path.lastIndexOf('/')
    const path = i < 0 ? './' : change.path.slice(0, i + 1)
    let g = byPath.get(path)
    if (!g) byPath.set(path, g = { path, count: 0, files: [], letters: {} })
    g.count++
    g.files.push(change)
    const l = letterOf(change)
    g.letters[l] = (g.letters[l] ?? 0) + 1
  }
  return [...byPath.values()]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(({ letters, ...g }) => {
      const rank = l => SEVERITY.indexOf(l) < 0 ? SEVERITY.length : SEVERITY.indexOf(l)
      const letter = Object.keys(letters).sort((a, b) => letters[b] - letters[a] || rank(a) - rank(b))[0]
      return { ...g, letter }
    })
}

/** The changes whose path matches `query` from the start of words; the same array for a blank query. */
export function filterChanges(changes, query) {
  return query.trim() ? changes.filter(c => wordMatch(c.path, query)) : changes
}
