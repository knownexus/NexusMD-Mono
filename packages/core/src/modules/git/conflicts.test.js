import { describe, it, expect } from 'vitest'
import {
  parseConflicts, resolveRegion, hasMarkers, conflictKind, conflictLabels, operationText,
} from './conflicts.js'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const two = 'top\n<<<<<<< HEAD\nL1\n=======\nR1\n>>>>>>> topic\nmid\n<<<<<<< HEAD\nL2\n=======\nR2\n>>>>>>> topic\nend\n'

describe('parseConflicts', () => {
  it('parses two blocks with offsets', () => {
    const blocks = parseConflicts(two)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({
      start: 4, end: two.indexOf('mid'), left: 'L1\n', base: null, right: 'R1\n',
    })
    expect(two.slice(blocks[1].start, blocks[1].end)).toBe('<<<<<<< HEAD\nL2\n=======\nR2\n>>>>>>> topic\n')
    expect(two.slice(blocks[1].end)).toBe('end\n')
  })

  it('parses diff3 and CRLF markers', () => {
    const t = 'x\r\n<<<<<<< HEAD\r\nL\r\n||||||| base\r\nB\r\n=======\r\nR\r\n>>>>>>> topic\r\ny\r\n'
    const [b] = parseConflicts(t)
    expect(b.left).toBe('L\r\n')
    expect(b.base).toBe('B\r\n')
    expect(b.right).toBe('R\r\n')
    expect(t.slice(b.end)).toBe('y\r\n')
  })

  it('ignores marker lookalikes and unterminated blocks', () => {
    expect(parseConflicts('<<<<<<<< x\n=======\n>>>>>>> y\n')).toEqual([])
    expect(parseConflicts('<<<<<<< HEAD\nL\n=======\nR\n')).toEqual([])
  })
})

describe('resolveRegion', () => {
  it('takes left, right and both in either order', () => {
    expect(resolveRegion(two, 0, 'left')).toBe(two.replace('<<<<<<< HEAD\nL1\n=======\nR1\n>>>>>>> topic\n', 'L1\n'))
    expect(resolveRegion(two, 1, 'right')).toContain('mid\nR2\nend\n')
    expect(resolveRegion(two, 1, 'leftFirst')).toContain('mid\nL2\nR2\nend\n')
    expect(resolveRegion(two, 1, 'rightFirst')).toContain('mid\nR2\nL2\nend\n')
  })

  it('regions are re-read from the current text', () => {
    const edited = 'new line\n' + two
    expect(resolveRegion(edited, 0, 'right')).toBe('new line\ntop\nR1\nmid\n' + two.slice(two.indexOf('<<<<<<< HEAD\nL2')))
  })

  it('returns the text unchanged for an unknown index', () => {
    expect(resolveRegion(two, 5, 'left')).toBe(two)
  })
})

describe('hasMarkers', () => {
  it('detects markers and ignores ======= inside a longer line', () => {
    expect(hasMarkers(two)).toBe(true)
    expect(hasMarkers('a\n=======\nb')).toBe(true)
    expect(hasMarkers('a\n======= more\nb')).toBe(false)
    expect(hasMarkers('a ======= b\n====== \n')).toBe(false)
    expect(hasMarkers('plain\n')).toBe(false)
  })
})

describe('conflictKind', () => {
  it('maps each XY', () => {
    expect(conflictKind('UU')).toBe('both-modified')
    expect(conflictKind('AA')).toBe('both-added')
    expect(conflictKind('DU')).toBe('deleted-by-left')
    expect(conflictKind('UD')).toBe('deleted-by-right')
    expect(conflictKind('AU')).toBe('added-by-left')
    expect(conflictKind('UA')).toBe('added-by-right')
    expect(conflictKind('DD')).toBe('both-deleted')
  })
})

describe('conflictLabels', () => {
  it('rebase puts the replayed commit on the right as mine', () => {
    const l = conflictLabels({ kind: 'rebase', onto: { oid: A, name: 'main' }, replaying: { oid: B, subject: 'Fix login' } }, 'feat/x')
    expect(l.left).toEqual({ title: 'main (already applied)', take: "Take main's", version: "main's version" })
    expect(l.right).toEqual({ title: 'Your commit bbbbbbb "Fix login"', take: 'Take mine', version: 'my version' })
  })

  it('unknown base uses neutral wording', () => {
    const l = conflictLabels({ kind: 'rebase', onto: { oid: A, name: null }, replaying: { oid: B, subject: 's' } }, 'x')
    expect(l.left).toEqual({ title: 'The new base (aaaaaaa)', take: "Take the base's", version: "the base's version" })
  })

  it('strips ref prefixes from names', () => {
    const l = conflictLabels({ kind: 'rebase', onto: { oid: A, name: 'refs/remotes/origin/main' }, replaying: { oid: B, subject: 's' } }, 'x')
    expect(l.left.title).toBe('origin/main (already applied)')
  })

  it('merge', () => {
    const l = conflictLabels({ kind: 'merge', merging: { oid: A, name: 'refs/heads/topic' } }, 'main')
    expect(l.left).toEqual({ title: 'Your branch (main)', take: 'Take mine', version: 'my version' })
    expect(l.right).toEqual({ title: 'topic (being merged)', take: "Take topic's", version: "topic's version" })
    const u = conflictLabels({ kind: 'merge', merging: { oid: A, name: null } }, 'main')
    expect(u.right).toEqual({ title: 'The merged commit (aaaaaaa)', take: 'Take the merged version', version: 'the merged version' })
  })

  it('cherry-pick', () => {
    const l = conflictLabels({ kind: 'cherry-pick', picked: { oid: B, subject: 'Add x' } }, 'main')
    expect(l.left.title).toBe('Your branch (main)')
    expect(l.right).toEqual({ title: 'Picked commit bbbbbbb "Add x"', take: 'Take the picked version', version: 'the picked version' })
  })

  it('revert', () => {
    const l = conflictLabels({ kind: 'revert', picked: { oid: B, subject: 'Add x' } }, 'main')
    expect(l.left.take).toBe('Take mine')
    expect(l.right).toEqual({ title: 'Reverting bbbbbbb "Add x"', take: 'Take the reverted version', version: 'the reverted version' })
  })
})

describe('operationText', () => {
  it('rebase', () => {
    const op = { kind: 'rebase', step: 2, total: 5, onto: { oid: A, name: 'main' }, replaying: { oid: B, subject: 'Fix login' } }
    expect(operationText(op, 'feat/x')).toBe('Rebasing feat/x onto main · commit 2 of 5 · bbbbbbb "Fix login"')
  })

  it('rebase with unknown step and base name', () => {
    const op = { kind: 'rebase', step: null, total: null, onto: { oid: A, name: null }, replaying: { oid: B, subject: 'Fix login' } }
    expect(operationText(op, 'feat/x')).toBe('Rebasing feat/x onto aaaaaaa · bbbbbbb "Fix login"')
  })

  it('merge, cherry-pick, revert', () => {
    expect(operationText({ kind: 'merge', merging: { oid: A, name: 'topic' } }, 'main')).toBe('Merging topic into main')
    expect(operationText({ kind: 'merge', merging: { oid: A, name: null } }, 'main')).toBe('Merging aaaaaaa into main')
    expect(operationText({ kind: 'cherry-pick', picked: { oid: B, subject: 'Add x' } }, 'main')).toBe('Cherry-picking bbbbbbb "Add x"')
    expect(operationText({ kind: 'revert', picked: { oid: B, subject: 'Add x' } }, 'main')).toBe('Reverting bbbbbbb "Add x"')
  })
})
