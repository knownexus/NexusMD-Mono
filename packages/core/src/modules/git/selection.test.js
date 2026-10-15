import { describe, it, expect } from 'vitest'
import {
  changePaths, isSubmodule, isNestedRepo, FILE_ACTIONS, actionsFor, groupChanges, toggleSelection, rangeSelection, pruneSelection,
} from './selection.js'

const c = (area, path, extra = {}) => ({ path, originalPath: null, xy: '.M', area, sub: 'N...', id: `${area}\0${path}`, ...extra })
const changes = [
  c('untracked', 'new.txt'),
  c('staged', 'a.txt'),
  c('unstaged', 'a.txt'),
  c('conflict', 'both.txt', { xy: 'UU' }),
  c('unstaged', 'lib', { sub: 'SC..' }),
  c('staged', 'moved.txt', { originalPath: 'was.txt', xy: 'R.' }),
]
const ids = list => list.map(x => x.id)

describe('selection model', () => {
  it('names both paths of a rename', () => {
    expect(changePaths(changes[5])).toEqual(['moved.txt', 'was.txt'])
    expect(changePaths(changes[0])).toEqual(['new.txt'])
  })

  it('recognises submodule entries', () => {
    expect(isSubmodule(changes[4])).toBe(true)
    expect(isSubmodule(changes[2])).toBe(false)
  })

  it('treats an untracked folder as a nested repository that no action applies to', () => {
    const nested = c('untracked', 'nested/')
    expect(isNestedRepo(nested)).toBe(true)
    expect(isNestedRepo(changes[0])).toBe(false)
    const a = actionsFor([nested, changes[0]], [nested.id, changes[0].id])
    expect([ids(a.stage), ids(a.delete)]).toEqual([['untracked\0new.txt'], ['untracked\0new.txt']])
  })

  it('splits a mixed selection by the action each change allows, never including submodules', () => {
    expect(FILE_ACTIONS).toEqual(['stage', 'unstage', 'discard', 'delete'])
    const a = actionsFor(changes, ids(changes))
    expect(ids(a.stage)).toEqual(['untracked\0new.txt', 'unstaged\0a.txt', 'conflict\0both.txt'])
    expect(ids(a.unstage)).toEqual(['staged\0a.txt', 'staged\0moved.txt'])
    expect(ids(a.discard)).toEqual(['unstaged\0a.txt'])
    expect(ids(a.delete)).toEqual(['untracked\0new.txt'])
    expect(actionsFor(changes, [])).toEqual({ stage: [], unstage: [], discard: [], delete: [] })
  })

  it('groups changes as Conflicts, Staged, Changes, Untracked and omits empty groups', () => {
    const groups = groupChanges(changes)
    expect(groups.map(g => [g.area, g.title, g.changes.length])).toEqual([
      ['conflict', 'Conflicts', 1], ['staged', 'Staged', 2], ['unstaged', 'Changes', 2], ['untracked', 'Untracked', 1],
    ])
    expect(groupChanges([changes[0]]).map(g => g.title)).toEqual(['Untracked'])
  })

  it('toggles, ranges and prunes ids', () => {
    expect(toggleSelection(['x'], 'y')).toEqual(['x', 'y'])
    expect(toggleSelection(['x', 'y'], 'x')).toEqual(['y'])
    const ordered = groupChanges(changes).flatMap(g => g.changes)
    expect(rangeSelection(ordered, ['keep'], ordered[1].id, ordered[3].id)).toEqual(['keep', ordered[1].id, ordered[2].id, ordered[3].id])
    expect(rangeSelection(ordered, [], ordered[3].id, ordered[1].id)).toEqual([ordered[1].id, ordered[2].id, ordered[3].id])
    expect(rangeSelection(ordered, [], 'missing', ordered[0].id)).toEqual([ordered[0].id])
    expect(pruneSelection(['untracked\0new.txt', 'gone'], changes)).toEqual(['untracked\0new.txt'])
  })
})
