// @vitest-environment node
// The source-branch module against real git: detection, storage, staleness and counts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync, execFile } from 'child_process'
import { createRequire } from 'module'
import { editPlan } from '@nexusmd/core'

const { createSourceReader } = createRequire(import.meta.url)('./git-source.cjs')
const { register } = createRequire(import.meta.url)('./git.cjs')

let root
let n = 0
const saved = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM }
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().replace(/\r\n/g, '\n')
const commit = (dir, msg) => { fs.writeFileSync(path.join(dir, 'f'), msg + '\n' + Math.random()); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', msg) }
const stored = (dir, b) => { try { return git(dir, 'config', '--get', `branch.${b}.nexusBase`).trim() } catch { return null } }
const tip = (dir, ref = 'HEAD') => git(dir, 'rev-parse', ref).trim()
const dropReflogs = dir => git(dir, 'reflog', 'expire', '--expire=now', '--all')

// git 2.45+ can keep refs in a reftable, where the reader can't see them on disk.
const reftableSupported = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-reftable-'))
  try { execFileSync('git', ['init', '-q', '--ref-format=reftable', dir], { stdio: 'pipe' }); return true } catch { return false } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})()

// A fresh repo on main with three commits, plus a reader whose spawns are counted. `intercept(args)` may
// answer a spawn itself (return a result) instead of running git. Each ref format's repo is built once
// and copied: every git command costs a process start, which is slow on Windows.
const templates = {}
function repo({ reftable = false, intercept = () => null } = {}) {
  const key = reftable ? 'reftable' : 'files'
  if (!templates[key]) {
    templates[key] = path.join(root, '.template-' + key)
    fs.mkdirSync(templates[key])
    git(templates[key], 'init', '-q', ...(reftable ? ['--ref-format=reftable'] : []))
    for (const m of ['c1', 'c2', 'c3']) commit(templates[key], m)
  }
  const dir = path.join(root, 'r' + n++)
  fs.cpSync(templates[key], dir, { recursive: true })
  const calls = []
  const run = args => new Promise(resolve => {
    calls.push(args)
    const answer = intercept(args)
    if (answer) { resolve(answer); return }
    execFile('git', args, { cwd: dir }, (err, stdout) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout).replace(/\r\n/g, '\n') }))
  })
  const reader = createSourceReader({ run, commonDir: path.join(dir, '.git') })
  return { dir, calls, reader }
}

// A teammate's branch pushed from another clone and fetched here, with dev (at main's tip) checked out,
// so the HEAD reflog would wrongly name dev and nearest-branch picks main.
function teammateBranch(dir) {
  const remote = path.join(root, 'remote' + n++ + '.git')
  git(root, 'init', '-q', '--bare', remote)
  git(dir, 'remote', 'add', 'origin', remote)
  git(dir, 'push', '-q', 'origin', 'main')
  const other = path.join(root, 'clone' + n++)
  git(root, 'clone', '-q', remote, other)
  git(other, 'switch', '-q', '-c', 'teammate'); commit(other, 't1')
  git(other, 'push', '-q', 'origin', 'teammate')
  git(dir, 'fetch', '-q', 'origin')
  git(dir, 'switch', '-q', '-c', 'dev')
}

beforeAll(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-gsrc-')))
  const globalConfig = path.join(root, 'gitconfig')
  fs.writeFileSync(globalConfig, '[user]\n\tname = Ana\n\temail = ana@example.invalid\n[core]\n\tautocrlf = false\n[init]\n\tdefaultBranch = main\n')
  process.env.GIT_CONFIG_GLOBAL = globalConfig
  process.env.GIT_CONFIG_NOSYSTEM = '1'
})
afterAll(() => {
  if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved.global
  if (saved.nosystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = saved.nosystem
  fs.rmSync(root, { recursive: true, force: true })
})

describe('source branch detection and storage', { timeout: 60000 }, () => {
  it('reads the branch reflog', async () => {
    const { dir, reader } = repo()
    git(dir, 'branch', 'feat', 'main')
    expect((await reader.get('feat', {})).ref).toBe('refs/heads/main')
    expect(stored(dir, 'feat')).toBe('refs/heads/main')
  })

  it('falls back to the HEAD reflog when the branch was created from HEAD', async () => {
    const { dir, reader } = repo()
    git(dir, 'switch', '-q', '-c', 'dev'); commit(dir, 'd1')
    git(dir, 'switch', '-q', '-c', 'feat')
    expect((await reader.get('feat', {})).ref).toBe('refs/heads/dev')
  })

  it('ignores a "Created from HEAD" entry once another branch is checked out', async () => {
    const { dir, reader } = repo()
    git(dir, 'switch', '-q', '-c', 'dev'); commit(dir, 'd1')
    git(dir, 'switch', '-q', '-c', 'feat')
    git(dir, 'switch', '-q', 'main')
    expect((await reader.get('feat', {})).ref).toBe('refs/heads/dev')
  })

  // Only the reflog can say dev here: nearest-branch ties dev with main and picks the default branch.
  it('reads the branch reflog over a nearest-branch tie', async () => {
    const { dir, reader } = repo()
    git(dir, 'branch', 'dev', 'main')
    git(dir, 'branch', 'feat', 'dev')
    git(dir, 'switch', '-q', 'feat'); commit(dir, 'f1')
    expect((await reader.get('feat', {})).ref).toBe('refs/heads/dev')
  })

  it('reads the HEAD reflog over a nearest-branch tie', async () => {
    const { dir, reader } = repo()
    git(dir, 'switch', '-q', '-c', 'dev')
    git(dir, 'switch', '-q', '-c', 'feat'); commit(dir, 'f1')
    expect((await reader.get('feat', {})).ref).toBe('refs/heads/dev')
  })

  it('never takes a branch\'s own remote branch as its source', async () => {
    const { dir, reader } = repo()
    teammateBranch(dir)
    git(dir, 'switch', '-q', 'teammate')
    expect((await reader.get('teammate', {})).ref).toBe('refs/heads/main')
  })

  it('never takes a branch\'s upstream as its source', async () => {
    const { dir, reader } = repo()
    teammateBranch(dir)
    git(dir, 'branch', '--track', 'mine', 'origin/teammate')
    expect((await reader.get('mine', {})).ref).toBe('refs/heads/main')
  })

  it('does not detect again after finding nothing', async () => {
    const { dir, calls, reader } = repo()
    git(dir, 'switch', '-q', '--orphan', 'solo'); commit(dir, 's1'); git(dir, 'branch', '-D', 'main')
    dropReflogs(dir)
    expect(await reader.get('solo', {})).toBeNull()
    calls.length = 0
    expect(await reader.get('solo', {})).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('picks the nearest branch when there is no reflog', async () => {
    const { dir, reader } = repo()
    git(dir, 'switch', '-q', '-c', 'dev')
    for (let i = 0; i < 5; i++) commit(dir, 'd' + i)
    git(dir, 'update-ref', 'refs/heads/feat', tip(dir, 'dev'))
    git(dir, 'switch', '-q', 'feat'); commit(dir, 'f1'); commit(dir, 'f2')
    dropReflogs(dir)
    expect((await reader.get('feat', {})).ref).toBe('refs/heads/dev')
  })

  it('treats a fresh branch at the tip of main as sourced from main with 0 ahead', async () => {
    const { dir, reader } = repo()
    git(dir, 'update-ref', 'refs/heads/feat', tip(dir, 'main'))
    const got = await reader.get('feat', { head: tip(dir, 'main'), count: true })
    expect(got).toEqual({ ref: 'refs/heads/main', count: 0 })
  })

  it('ignores branches made from the branch itself', async () => {
    const { dir, reader } = repo()
    git(dir, 'update-ref', 'refs/heads/feat', tip(dir, 'main'))
    git(dir, 'switch', '-q', 'feat'); commit(dir, 'f1')
    git(dir, 'switch', '-q', '-c', 'child'); commit(dir, 'k1'); commit(dir, 'k2')
    dropReflogs(dir)
    expect((await reader.get('feat', {})).ref).toBe('refs/heads/main')
  })

  it('breaks a tie in favour of the default branch', async () => {
    const { dir, reader } = repo()
    git(dir, 'update-ref', 'refs/heads/other', tip(dir, 'main'))
    git(dir, 'update-ref', 'refs/heads/aaa', tip(dir, 'main'))
    git(dir, 'update-ref', 'refs/heads/feat', tip(dir, 'main'))
    git(dir, 'switch', '-q', 'feat'); commit(dir, 'f1')
    dropReflogs(dir)
    expect((await reader.get('feat', {})).ref).toBe('refs/heads/main')
  })

  it('returns null for the default branch and writes nothing', async () => {
    const { dir, reader } = repo()
    expect(await reader.get('main', {})).toBeNull()
    expect(stored(dir, 'main')).toBeNull()
  })

  it('uses the stored value without spawning git', async () => {
    const { dir, calls, reader } = repo()
    git(dir, 'branch', 'other'); git(dir, 'branch', 'feat')
    await reader.write('feat', 'refs/heads/other')
    calls.length = 0
    expect((await reader.get('feat', {})).ref).toBe('refs/heads/other')
    expect(calls).toHaveLength(0)
  })

  it('re-detects a stale value and keeps the value across a rename', async () => {
    const { dir, reader } = repo()
    git(dir, 'branch', 'feat', 'main')
    git(dir, 'config', '--local', 'branch.feat.nexusBase', 'refs/heads/gone')
    expect((await reader.get('feat', {})).ref).toBe('refs/heads/main')
    expect(stored(dir, 'feat')).toBe('refs/heads/main')
    git(dir, 'branch', 'other'); await reader.write('feat', 'refs/heads/other')
    git(dir, 'branch', '-m', 'feat', 'feat2')
    expect((await reader.get('feat2', {})).ref).toBe('refs/heads/other')
  })

  it('counts commits ahead and caches by head', async () => {
    const { dir, calls, reader } = repo()
    git(dir, 'switch', '-q', '-c', 'feat')
    for (const m of ['a', 'b', 'c']) commit(dir, m)
    const head = tip(dir)
    expect(await reader.get('feat', { head, count: true })).toEqual({ ref: 'refs/heads/main', count: 3 })
    calls.length = 0
    expect((await reader.get('feat', { head, count: true })).count).toBe(3)
    expect(calls).toHaveLength(0)
  })

  it('counts again on the next poll after a failed count', async () => {
    let fail = true
    const intercept = args => {
      if (!fail || args[0] !== 'rev-list' || args[1] !== '--count' || args[args.length - 1] !== '--') return null
      fail = false
      return { code: 128, stdout: '' }
    }
    const { dir, reader } = repo({ intercept })
    git(dir, 'switch', '-q', '-c', 'feat'); commit(dir, 'a')
    const head = tip(dir)
    expect(await reader.get('feat', { head, count: true })).toEqual({ ref: 'refs/heads/main', count: null })
    expect(await reader.get('feat', { head, count: true })).toEqual({ ref: 'refs/heads/main', count: 1 })
  })

  it('spends one spawn per candidate branch when detecting', async () => {
    const { dir, calls, reader } = repo()
    for (let i = 0; i < 10; i++) git(dir, 'branch', `b${i}`)
    git(dir, 'switch', '-q', '-c', 'feat'); commit(dir, 'f1')
    dropReflogs(dir)
    calls.length = 0
    expect((await reader.get('feat', {})).ref).toBe('refs/heads/main')
    expect(calls.filter(a => a[0] === 'merge-base')).toHaveLength(0)
    expect(calls.length).toBeLessThanOrEqual(11 + 6)
  })

  it('runs one detection for overlapping polls', async () => {
    const { dir, calls, reader } = repo()
    git(dir, 'switch', '-q', '-c', 'feat'); commit(dir, 'f1')
    dropReflogs(dir)
    calls.length = 0
    const [a, b] = await Promise.all([reader.get('feat', {}), reader.get('feat', {})])
    expect(a.ref).toBe('refs/heads/main')
    expect(b.ref).toBe('refs/heads/main')
    expect(calls.filter(c => c[0] === 'for-each-ref' && c.includes('refs/heads'))).toHaveLength(1)
  })
})

describe.skipIf(!reftableSupported)('a reftable repository', { timeout: 60000 }, () => {
  it('detects once and then trusts the stored value without spawning', async () => {
    const { dir, calls, reader } = repo({ reftable: true })
    git(dir, 'switch', '-q', '-c', 'feat'); commit(dir, 'f1')
    expect((await reader.get('feat', {})).ref).toBe('refs/heads/main')
    expect(stored(dir, 'feat')).toBe('refs/heads/main')
    calls.length = 0
    expect((await reader.get('feat', {})).ref).toBe('refs/heads/main')
    expect(calls).toHaveLength(0)
  })

  it('gives the default branch no source, asking git for it only once', async () => {
    const { dir, calls, reader } = repo({ reftable: true })
    git(dir, 'branch', 'other')
    expect(await reader.get('main', {})).toBeNull()
    calls.length = 0
    expect(await reader.get('main', {})).toBeNull()
    expect(calls).toHaveLength(0)
    expect(stored(dir, 'main')).toBeNull()
  })

  it('counts again when the source moves', async () => {
    const { dir, reader } = repo({ reftable: true })
    git(dir, 'switch', '-q', '-c', 'feat'); commit(dir, 'f1')
    const head = tip(dir)
    expect(await reader.get('feat', { head, count: true })).toEqual({ ref: 'refs/heads/main', count: 1 })
    git(dir, 'branch', '-f', 'main', 'feat')
    expect(await reader.get('feat', { head, count: true })).toEqual({ ref: 'refs/heads/main', count: 0 })
  })
})

describe('git:status source', { timeout: 60000 }, () => {
  const handlers = {}
  const status = (dir, options) => handlers['git:status'](null, { name: 'r', path: dir }, dir, [dir], options)
  beforeAll(() => {
    register({ handle: (channel, fn) => { handlers[channel] = fn } }, {
      logger: { scope: () => ({ error: () => {}, info: () => {} }) },
      editorCommand: { exe: process.execPath, helper: path.join(__dirname, 'git-editor.cjs') },
    })
  })

  it('reports the source and its commit count for an unpublished branch', async () => {
    const { dir } = repo()
    git(dir, 'switch', '-q', '-c', 'feat'); commit(dir, 'f1'); commit(dir, 'f2')
    const s = await status(dir)
    expect(s.source).toEqual({ ref: 'refs/heads/main', count: 2 })
  })

  it('counts a published branch only when asked', async () => {
    const { dir } = repo()
    const remote = path.join(root, 'remote' + n++ + '.git')
    git(root, 'init', '-q', '--bare', remote)
    git(dir, 'remote', 'add', 'origin', remote)
    git(dir, 'switch', '-q', '-c', 'feat'); commit(dir, 'f1')
    git(dir, 'push', '-q', '-u', 'origin', 'feat')
    expect((await status(dir)).source).toEqual({ ref: 'refs/heads/main', count: null })
    const counted = (await status(dir, { countSource: true })).source
    expect(counted.ref).toBe('refs/heads/main')
    expect(typeof counted.count).toBe('number')
  })

  it('has no source on the default branch or a detached HEAD', async () => {
    const { dir } = repo()
    expect((await status(dir)).source).toBeNull()
    git(dir, 'switch', '-q', '--detach')
    expect((await status(dir)).source).toBeNull()
  })

  it('has no source before the first commit', async () => {
    const dir = path.join(root, 'r' + n++)
    fs.mkdirSync(dir)
    git(dir, 'init', '-q')
    expect((await status(dir)).source).toBeNull()
  })
})

describe('recording the source at creation', { timeout: 60000 }, () => {
  const handlers = {}
  const call = (channel, ...args) => handlers[channel](null, ...args)
  const act = async (dir, kind, options = {}) => {
    const repoArg = { name: 'r', path: dir }
    const p = await call('git:preview', repoArg, dir, [dir], kind, options)
    if (!p.eligible) return { previewRefused: p.reason }
    return call('git:run', repoArg, dir, [dir], kind, options, p.stamp)
  }
  beforeAll(() => {
    register({ handle: (channel, fn) => { handlers[channel] = fn } }, {
      logger: { scope: () => ({ error: () => {}, info: () => {} }) },
      editorCommand: { exe: process.execPath, helper: path.join(__dirname, 'git-editor.cjs') },
    })
  })

  it('remembers the checked-out branch for a new branch', async () => {
    const { dir } = repo()
    git(dir, 'switch', '-q', '-c', 'dev'); commit(dir, 'd1')
    expect(await act(dir, 'branch', { name: 'feat', checkout: true })).toMatchObject({ ok: true })
    expect(stored(dir, 'feat')).toBe('refs/heads/dev')
  })

  it('remembers a branch start ref', async () => {
    const { dir } = repo()
    git(dir, 'switch', '-q', '-c', 'dev')
    expect(await act(dir, 'branch', { name: 'f2', start: 'refs/heads/main' })).toMatchObject({ ok: true })
    expect(stored(dir, 'f2')).toBe('refs/heads/main')
  })

  it('remembers the checked-out branch when the start is a commit', async () => {
    const { dir } = repo()
    git(dir, 'switch', '-q', '-c', 'dev')
    expect(await act(dir, 'branch', { name: 'f3', start: tip(dir, 'main~1') })).toMatchObject({ ok: true })
    expect(stored(dir, 'f3')).toBe('refs/heads/dev')
  })

  it('records nothing for a commit start from a detached HEAD', async () => {
    const { dir } = repo()
    const oid = tip(dir)
    git(dir, 'switch', '-q', '--detach')
    expect(await act(dir, 'branch', { name: 'f4', start: oid })).toMatchObject({ ok: true })
    expect(stored(dir, 'f4')).toBeNull()
  })

  it('records nothing when tracking the branch\'s own remote branch', async () => {
    const { dir, reader } = repo()
    teammateBranch(dir)
    expect(await act(dir, 'branch', { name: 'teammate', start: 'refs/remotes/origin/teammate', checkout: true })).toMatchObject({ ok: true })
    expect(stored(dir, 'teammate')).toBeNull()
    expect((await reader.get('teammate', {})).ref).toBe('refs/heads/main')
  })

  it('setSource writes the source', async () => {
    const { dir } = repo()
    git(dir, 'switch', '-q', '-c', 'dev')
    await act(dir, 'branch', { name: 'feat', checkout: true })
    expect(await act(dir, 'setSource', { branch: 'feat', ref: 'refs/heads/main' })).toMatchObject({ ok: true })
    expect(stored(dir, 'feat')).toBe('refs/heads/main')
  })

  it('setSource refuses tags, missing refs, the branch itself and the default branch', async () => {
    const { dir } = repo()
    git(dir, 'branch', 'feat'); git(dir, 'tag', 'v1')
    for (const options of [
      { branch: 'feat', ref: 'refs/tags/v1' },
      { branch: 'feat', ref: 'refs/heads/nope' },
      { branch: 'feat', ref: 'refs/heads/feat' },
      { branch: 'main', ref: 'refs/heads/feat' },
    ]) expect((await act(dir, 'setSource', options)).previewRefused).toBeTruthy()
    expect(stored(dir, 'feat')).toBeNull()
  })
})

describe('rebasing with editPlan', { timeout: 60000 }, () => {
  const handlers = {}
  beforeAll(() => {
    register({ handle: (channel, fn) => { handlers[channel] = fn } }, {
      logger: { scope: () => ({ error: () => {}, info: () => {} }) },
      editorCommand: { exe: process.execPath, helper: path.join(__dirname, 'git-editor.cjs') },
    })
  })

  const branchCommits = dir => git(dir, 'log', '--format=%H %P|%s', 'main..HEAD').split('\n').filter(Boolean).map(l => {
    const [ids, subject] = l.split('|')
    const [oid, ...parents] = ids.split(' ')
    return { oid, subject, parents }
  })
  const runPlan = async (dir, plan) => {
    const options = { base: plan.base, rows: plan.rows }
    const repoArg = { name: 'r', path: dir }
    const p = await handlers['git:preview'](null, repoArg, dir, [dir], 'rebaseInteractive', options)
    expect(p.eligible).toBe(true)
    return handlers['git:run'](null, repoArg, dir, [dir], 'rebaseInteractive', options, p.stamp)
  }

  it('rewords a middle commit of an unpublished branch and keeps the tree', async () => {
    const { dir } = repo()
    git(dir, 'switch', '-q', '-c', 'feat')
    for (const m of ['f1', 'f2', 'f3']) commit(dir, m)
    const treeBefore = git(dir, 'rev-parse', 'HEAD^{tree}').trim()
    const commits = branchCommits(dir)
    expect(await runPlan(dir, editPlan(commits, { kind: 'reword', oid: commits[1].oid, message: 'f2 reworded' }))).toMatchObject({ ok: true })
    expect(git(dir, 'log', '--format=%s', 'main..HEAD').trim().split('\n')).toEqual(['f3', 'f2 reworded', 'f1'])
    expect(git(dir, 'rev-parse', 'HEAD^{tree}').trim()).toBe(treeBefore)
  })

  it('keeps lines starting with # in a reworded message', async () => {
    const { dir } = repo()
    git(dir, 'switch', '-q', '-c', 'feat')
    for (const m of ['f1', 'f2']) commit(dir, m)
    const commits = branchCommits(dir)
    expect(await runPlan(dir, editPlan(commits, { kind: 'reword', oid: commits[1].oid, message: '#42 fix login\n\nBody line' }))).toMatchObject({ ok: true })
    expect(git(dir, 'log', '-1', '--format=%B', 'HEAD~1').trim()).toBe('#42 fix login\n\nBody line')
  })

  it('refuses a squash that leaves git\'s template as the message', async () => {
    const { dir } = repo()
    git(dir, 'switch', '-q', '-c', 'feat')
    for (const m of ['f1', 'f2']) commit(dir, m)
    const commits = branchCommits(dir)
    const plan = editPlan(commits, { kind: 'squash', oids: [commits[0].oid, commits[1].oid], message: null })
    const p = await handlers['git:preview'](null, { name: 'r', path: dir }, dir, [dir], 'rebaseInteractive', { base: plan.base, rows: plan.rows })
    expect(p.eligible).toBe(false)
    expect(p.reason).toMatch(/message/)
  })

  it('keeps lines starting with # in a squashed message', async () => {
    const { dir } = repo()
    git(dir, 'switch', '-q', '-c', 'feat')
    for (const m of ['f1', 'f2', 'f3']) commit(dir, m)
    const commits = branchCommits(dir)
    const message = 'f2 and f3\n\n# heading\nmore'
    expect(await runPlan(dir, editPlan(commits, { kind: 'squash', oids: [commits[0].oid, commits[1].oid], message }))).toMatchObject({ ok: true })
    expect(git(dir, 'log', '-1', '--format=%B', 'HEAD').trim()).toBe(message)
    expect(git(dir, 'log', '--format=%s', 'main..HEAD').trim().split('\n')).toEqual(['f2 and f3', 'f1'])
  })
})
