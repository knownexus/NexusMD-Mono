import { describe, it, expect } from 'vitest'
import fs from 'fs'
import {
  parseRefs, parseLog, graphCells, parseSearch, historyQuery, HISTORY_STEP, HISTORY_MAX, parseRefList, defaultBase,
  parseCommitDetails, parseNameStatus, parentLabel,
} from './history.js'

const fixture = name => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'latin1')
// The .txt fixtures are UTF-8 (unicode subjects and names).
const text = name => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const commits = rows => rows.filter(r => r.commit).map(r => r.commit)

describe('parseLog', () => {
  it('reads commits and connector rows from a merge', () => {
    const rows = parseLog(text('log-merge.txt'))
    expect(rows).toHaveLength(7)
    expect(rows.map(r => !!r.commit)).toEqual([true, false, true, true, false, true, true])
    const [merge, side, c3, c2, c1] = commits(rows)
    expect(merge.subject).toBe('Merge side')
    expect(merge.parents).toHaveLength(2)
    expect(merge.refs).toEqual([{ kind: 'head', name: 'HEAD' }, { kind: 'branch', name: 'main' }])
    expect(side.refs).toEqual([{ kind: 'branch', name: 'side' }])
    expect(c3.subject).toBe('c3 [x] ünïcode')
    expect(c2.refs).toEqual([{ kind: 'tag', name: 'v1' }, { kind: 'remote', name: 'origin/main' }])
    expect(c1.parents).toEqual([])
    expect(merge.author).toBe('Ana Ñ')
    expect(merge.oid).toMatch(/^[0-9a-f]{40}$/)
    expect(merge.time).toBeGreaterThan(1e12)
  })
  it('a detached HEAD is just HEAD', () => {
    expect(commits(parseLog(text('log-detached.txt')))[0].refs).toEqual([{ kind: 'head', name: 'HEAD' }])
  })
  it('an octopus merge has three parents', () => {
    const rows = parseLog(text('log-octopus.txt'))
    const octopus = commits(rows).find(c => c.subject === 'octopus')
    expect(octopus.parents).toHaveLength(3)
    expect(rows.find(r => r.commit === octopus).graph.startsWith('*-.')).toBe(true)
    for (const r of rows.filter(r => r.commit)) expect(r.graph).toContain('*')
  })
  it('keeps every line of a criss-cross history', () => {
    const t = text('log-criss-cross.txt')
    const rows = parseLog(t)
    expect(rows).toHaveLength(t.split('\n').filter(Boolean).length)
    expect(commits(rows).filter(c => c.parents.length === 2)).toHaveLength(2)
  })
  it('survives a page cut mid-graph', () => {
    expect(parseLog(text('log-merge.txt').split('\n').slice(0, 3).join('\n'))).toHaveLength(3)
  })
  it('keeps a subject that contains the field separator', () => {
    const line = `* \x1e${'a'.repeat(40)}\x1f\x1fA\x1fa@b\x1f1\x1f\x1fone\x1ftwo`
    expect(parseLog(line)[0].commit.subject).toBe('one\x1ftwo')
  })
  it('ignores blank and malformed records', () => {
    expect(parseLog('')).toEqual([])
    expect(parseLog('* \x1eshort')).toEqual([])
  })
})

describe('parseRefs', () => {
  it('tells local, remote and tag refs apart by their full names', () => {
    expect(parseRefs('HEAD -> refs/heads/a/b')).toEqual([{ kind: 'head', name: 'HEAD' }, { kind: 'branch', name: 'a/b' }])
    expect(parseRefs('refs/remotes/origin/a')).toEqual([{ kind: 'remote', name: 'origin/a' }])
    expect(parseRefs('tag: refs/tags/v1')).toEqual([{ kind: 'tag', name: 'v1' }])
    expect(parseRefs('refs/heads/origin/main')).toEqual([{ kind: 'branch', name: 'origin/main' }])
    expect(parseRefs('refs/stash')).toEqual([{ kind: 'other', name: 'refs/stash' }])
    expect(parseRefs('')).toEqual([])
  })
})

describe('graphCells', () => {
  it('redraws git\'s characters with two columns per lane', () => {
    expect(graphCells('| * ')).toEqual([{ ch: '│', lane: 0 }, { ch: ' ', lane: 0 }, { ch: '●', lane: 1 }, { ch: ' ', lane: 1 }])
    expect(graphCells('*-.').map(c => c.ch).join('')).toBe('●─·')
    expect(graphCells('|/').map(c => c.ch).join('')).toBe('│╱')
    expect(graphCells('|\\').map(c => c.ch).join('')).toBe('│╲')
  })
})

describe('parseSearch', () => {
  it('reads each prefix', () => {
    expect(parseSearch(' fix bug ')).toEqual({ kind: 'message', text: 'fix bug' })
    expect(parseSearch('@ Ana')).toEqual({ kind: 'author', text: 'Ana' })
    expect(parseSearch(':src/a b.cs')).toEqual({ kind: 'path', text: 'src/a b.cs' })
  })
  it('escapes a literal first @ or :', () => {
    expect(parseSearch('\\@home')).toEqual({ kind: 'message', text: '@home' })
    expect(parseSearch('\\:x')).toEqual({ kind: 'message', text: ':x' })
  })
  it('is empty for blank input', () => {
    expect(parseSearch('')).toBeNull()
    expect(parseSearch('   ')).toBeNull()
  })
  it('refuses what it can\'t search for', () => {
    expect(() => parseSearch('@')).toThrow('Type a name after @')
    expect(() => parseSearch(':')).toThrow('Type a path after :')
    expect(() => parseSearch('x'.repeat(201))).toThrow('Search is limited to 200 characters')
    expect(() => parseSearch('a\nb')).toThrow('Search must be one line')
    expect(() => parseSearch(':../x')).toThrow('Search paths must be inside the worktree')
    expect(() => parseSearch(':/etc/x')).toThrow('Search paths must be inside the worktree')
    expect(() => parseSearch(':C:\\x')).toThrow('Search paths must be inside the worktree')
  })
})

describe('historyQuery', () => {
  it('fills in the defaults', () => {
    expect(historyQuery({ ref: 'HEAD' })).toEqual({ ref: 'HEAD', filter: 'all', base: null, search: null, limit: HISTORY_STEP })
  })
  it('keeps a base only for sinceBase', () => {
    expect(historyQuery({ ref: 'HEAD', filter: 'all', base: 'refs/heads/main' }).base).toBeNull()
    expect(historyQuery({ ref: 'refs/heads/x', filter: 'sinceBase', base: 'refs/remotes/origin/main' }).base).toBe('refs/remotes/origin/main')
  })
  it('refuses bad queries with main\'s messages', () => {
    expect(() => historyQuery({ ref: 'HEAD', filter: 'sinceBase' })).toThrow('Pick a base to compare with')
    expect(() => historyQuery({ ref: 'HEAD', filter: 'sinceBase', base: 'refs/tags/v1' })).toThrow('Pick a base to compare with')
    expect(() => historyQuery({ ref: 'HEAD', limit: 300 })).toThrow('Unsupported page size')
    expect(() => historyQuery({ ref: 'HEAD', limit: HISTORY_MAX + HISTORY_STEP })).toThrow('Unsupported page size')
    expect(() => historyQuery({ ref: 'HEAD', filter: 'weird' })).toThrow('Unknown filter')
    expect(() => historyQuery({ ref: '-x' })).toThrow('Choose a branch')
    expect(() => historyQuery({ ref: 'refs/heads/' })).toThrow('Choose a branch')
    expect(() => historyQuery({ ref: 'HEAD', search: { kind: 'path', text: '../x' } })).toThrow('Search paths must be inside the worktree')
    expect(() => historyQuery({ ref: 'HEAD', search: { kind: 'regex', text: 'x' } })).toThrow('Unknown search')
  })
  it('accepts the largest page', () => {
    expect(historyQuery({ ref: 'HEAD', limit: HISTORY_MAX }).limit).toBe(5000)
  })
})

describe('refs and the default base', () => {
  const raw = [
    'refs/heads/feature\0aaa\0refs/remotes/origin/feature\0*',
    'refs/heads/main\0bbb\0refs/remotes/origin/main\0 ',
    'refs/heads/master\0ccc\0\0 ',
    'refs/remotes/origin/main\0bbb\0\0 ',
    'refs/remotes/origin/develop\0ddd\0\0 ',
  ].join('\n') + '\n'
  const refs = parseRefList(raw)
  it('parses the refs read', () => {
    expect(refs[0]).toEqual({ ref: 'refs/heads/feature', oid: 'aaa', upstream: 'refs/remotes/origin/feature', head: true })
    expect(refs[2]).toEqual({ ref: 'refs/heads/master', oid: 'ccc', upstream: null, head: false })
  })
  it('prefers origin\'s HEAD, then main, then master, never the ref itself', () => {
    expect(defaultBase(refs, { ref: 'HEAD', originHead: 'refs/remotes/origin/develop' })).toBe('refs/remotes/origin/develop')
    expect(defaultBase(refs, { ref: 'HEAD' })).toBe('refs/heads/main')
    expect(defaultBase(refs, { ref: 'refs/heads/main' })).toBe('refs/heads/master')
    expect(defaultBase(refs, { ref: 'HEAD', originHead: 'refs/remotes/origin/gone' })).toBe('refs/heads/main')
    expect(defaultBase([{ ref: 'refs/heads/x', head: true }], { ref: 'HEAD' })).toBeNull()
  })
})

describe('parseCommitDetails', () => {
  const raw = (message, over = {}) => [
    over.oid ?? 'a'.repeat(40), over.parents ?? `${'b'.repeat(40)} ${'c'.repeat(40)}`, 'Ana Ñ', 'ana@example.com', '2026-10-14T10:00:00+01:00',
    over.committer ?? 'Bot', 'bot@example.com', '2026-10-14T11:00:00+01:00', over.refs ?? 'HEAD -> refs/heads/main', message,
  ].join('\0') + '\n'
  it('keeps the full message with its blank lines', () => {
    const d = parseCommitDetails(raw('Subject\n\nBody line 1\n\nBody line 2\n'))
    expect(d.message).toBe('Subject\n\nBody line 1\n\nBody line 2')
    expect(d.parents).toHaveLength(2)
    expect(d.committer).toBe('Bot')
    expect(d.author).toBe('Ana Ñ')
    expect(d.refs).toEqual([{ kind: 'head', name: 'HEAD' }, { kind: 'branch', name: 'main' }])
  })
  it('handles a root commit and an empty body', () => {
    const d = parseCommitDetails(raw('Only a subject\n', { parents: '', refs: '' }))
    expect(d.parents).toEqual([])
    expect(d.refs).toEqual([])
    expect(d.message).toBe('Only a subject')
  })
})

describe('parseNameStatus', () => {
  it('reads renames with both paths and unicode names', () => {
    expect(parseNameStatus(Buffer.from(fixture('name-status-renames.bin'), 'latin1').toString('utf8'))).toEqual([
      { status: 'R', score: 100, oldPath: 'f', path: 'f renamed.txt' },
      { status: 'A', score: null, oldPath: null, path: 'ü z.txt' },
    ])
  })
  it('reads copies, type changes and deletes', () => {
    expect(parseNameStatus('C075\0a\0b\0T\0link\0D\0gone\0M\0m\0')).toEqual([
      { status: 'C', score: 75, oldPath: 'a', path: 'b' },
      { status: 'T', score: null, oldPath: null, path: 'link' },
      { status: 'D', score: null, oldPath: null, path: 'gone' },
      { status: 'M', score: null, oldPath: null, path: 'm' },
    ])
    expect(parseNameStatus('')).toEqual([])
  })
})

describe('parentLabel', () => {
  it('names a merge\'s two parents, and only the first of an octopus', () => {
    const merge = { parents: ['1538ae7aaaa', 'd4fa71ebbbb'] }
    expect(parentLabel(merge, 0)).toBe('1 (main line) · 1538ae7')
    expect(parentLabel(merge, 1)).toBe('2 (merged in) · d4fa71e')
    const octopus = { parents: ['aaaaaaa1', 'bbbbbbb2', 'ccccccc3'] }
    expect(parentLabel(octopus, 1)).toBe('2 · bbbbbbb')
    expect(parentLabel(octopus, 2)).toBe('3 · ccccccc')
    expect(parentLabel(merge, 5)).toBe('')
  })
})
