// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { parseDiff } from '@nexusmd/core'
import { register } from './git.cjs'

const STALE = 'Changed since you reviewed it. Refresh and review again.'
let root
const handlers = {}
const saved = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM }
const run = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
const call = (channel, ...args) => handlers[channel](null, ...args)
const repo = name => ({ name, path: path.join(root, name) })
const REG = () => ['Work', 'Fresh', 'Hooked', 'Guarded'].map(n => path.join(root, n))
const story = changed => Array.from({ length: 30 }, (_, i) => `line ${i + 1}${changed.includes(i + 1) ? ' changed' : ''}`).join('\n') + '\n'
const CRLF = 'a\r\nb\r\nc\r\nd\r\ne\r\nf\r\ng\r\nh\r\ni\r\nj\r\n'
const write = (r, file, text) => fs.writeFileSync(path.join(r.path, file), text)
const filesStamp = (r, wt, paths) => call('git:stamp', r, wt, REG(), { kind: 'files', paths })
const commitStamp = (r, wt) => call('git:stamp', r, wt, REG(), { kind: 'commit' })
const failWorktree = () => path.join(root, 'Hooked-fail-marker')

beforeAll(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-gitw-')))
  const globalConfig = path.join(root, 'gitconfig')
  fs.writeFileSync(globalConfig, '[user]\n\tname = Test\n\temail = test@example.invalid\n[core]\n\tautocrlf = false\n')
  process.env.GIT_CONFIG_GLOBAL = globalConfig
  process.env.GIT_CONFIG_NOSYSTEM = '1'

  const work = repo('Work')
  fs.mkdirSync(work.path)
  run(work.path, 'init', '-b', 'main')
  write(work, 'story.txt', story([]))
  write(work, '-x [1].txt', 'odd\n')
  write(work, 'crlf.txt', CRLF)
  run(work.path, 'add', '.')
  run(work.path, 'commit', '-m', 'Initial')

  fs.mkdirSync(repo('Fresh').path)
  run(repo('Fresh').path, 'init', '-b', 'main')

  const hooked = repo('Hooked')
  fs.mkdirSync(hooked.path)
  run(hooked.path, 'init', '-b', 'main')
  write(hooked, 'base.txt', 'base\n')
  run(hooked.path, 'add', '.')
  run(hooked.path, 'commit', '-m', 'Base')
  run(hooked.path, 'worktree', 'add', '-b', 'side', failWorktree(), 'main')
  const hook = path.join(hooked.path, '.git', 'hooks', 'pre-commit')
  fs.writeFileSync(hook, '#!/bin/sh\ncase "$PWD" in *fail-marker*) echo "hook says no" >&2; exit 1;; esac\nexit 0\n')
  fs.chmodSync(hook, 0o755)

  // A secret guard that filters with a glob pathspec, as many team hooks do.
  const guarded = repo('Guarded')
  fs.mkdirSync(guarded.path)
  run(guarded.path, 'init', '-b', 'main')
  write(guarded, 'base.txt', 'base\n')
  run(guarded.path, 'add', '.')
  run(guarded.path, 'commit', '-m', 'Base')
  const guard = path.join(guarded.path, '.git', 'hooks', 'pre-commit')
  fs.writeFileSync(guard, '#!/bin/sh\nn=$(git diff --cached --name-only -- \'*.secret\' | wc -l)\n[ "$n" -eq 0 ] || { echo "secret files staged" >&2; exit 1; }\n')
  fs.chmodSync(guard, 0o755)

  register({ handle: (channel, fn) => { handlers[channel] = fn } }, { logger: { scope: () => ({ error: () => {}, info: () => {} }) } })
}, 60000)

afterAll(() => {
  if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved.global
  if (saved.nosystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = saved.nosystem
  fs.rmSync(root, { recursive: true, force: true })
})

describe('git workspace writes against real repositories', () => {
  it('stages and unstages single hunks, then discards the file', async () => {
    const r = repo('Work')
    write(r, 'story.txt', story([2, 15, 28]))
    const d = await call('git:diff', r, r.path, REG(), { area: 'unstaged', paths: ['story.txt'] })
    expect(parseDiff(d.text).files[0].hunks).toHaveLength(3)
    expect(await call('git:stageHunk', r, r.path, REG(), ['story.txt'], 1, d.stamp)).toMatchObject({ ok: true })
    const cached = run(r.path, 'diff', '--cached')
    expect(cached).toContain('+line 15 changed')
    expect(cached).not.toContain('line 2 changed')
    expect(cached).not.toContain('line 28 changed')
    const s = await call('git:diff', r, r.path, REG(), { area: 'staged', paths: ['story.txt'] })
    expect(await call('git:unstageHunk', r, r.path, REG(), ['story.txt'], 0, s.stamp)).toMatchObject({ ok: true })
    expect(run(r.path, 'diff', '--cached')).toBe('')
    expect(await call('git:discard', r, r.path, REG(), ['story.txt'], await filesStamp(r, r.path, ['story.txt']))).toMatchObject({ ok: true })
    expect(fs.readFileSync(path.join(r.path, 'story.txt'), 'utf8')).toBe(story([]))
  }, 60000)

  it('takes glob characters and leading dashes in names literally', async () => {
    const r = repo('Work')
    write(r, '-x [1].txt', 'odd changed\n')
    write(r, '-x 1.txt', 'decoy\n')
    expect(await call('git:stage', r, r.path, REG(), ['-x [1].txt'], await filesStamp(r, r.path, ['-x [1].txt']))).toMatchObject({ ok: true })
    expect(run(r.path, 'diff', '--cached', '--name-only')).toBe('-x [1].txt\n')
    expect(run(r.path, 'ls-files', '--others', '--exclude-standard')).toBe('-x 1.txt\n')
    expect(await call('git:unstage', r, r.path, REG(), ['-x [1].txt'], await filesStamp(r, r.path, ['-x [1].txt']))).toMatchObject({ ok: true })
    expect(run(r.path, 'diff', '--cached', '--name-only')).toBe('')
    expect(await call('git:discard', r, r.path, REG(), ['-x [1].txt'], await filesStamp(r, r.path, ['-x [1].txt']))).toMatchObject({ ok: true })
    expect(fs.readFileSync(path.join(r.path, '-x [1].txt'), 'utf8')).toBe('odd\n')
    expect(fs.existsSync(path.join(r.path, '-x 1.txt'))).toBe(true)
    expect(await call('git:deleteUntracked', r, r.path, REG(), ['-x 1.txt'], await filesStamp(r, r.path, ['-x 1.txt'])))
      .toEqual({ ok: true, detail: 'Deleted 1 untracked file.' })
    expect(fs.existsSync(path.join(r.path, '-x 1.txt'))).toBe(false)
  }, 60000)

  it('stages one hunk of a CRLF file without touching the other', async () => {
    const r = repo('Work')
    write(r, 'crlf.txt', CRLF.replace('a\r\n', 'A\r\n').replace('j\r\n', 'J\r\n'))
    const d = await call('git:diff', r, r.path, REG(), { area: 'unstaged', paths: ['crlf.txt'] })
    expect(parseDiff(d.text).files[0].hunks).toHaveLength(2)
    expect(await call('git:stageHunk', r, r.path, REG(), ['crlf.txt'], 0, d.stamp)).toMatchObject({ ok: true })
    expect(run(r.path, 'show', ':crlf.txt')).toBe(CRLF.replace('a\r\n', 'A\r\n'))
    run(r.path, 'reset', '-q')
    run(r.path, 'checkout', '--', 'crlf.txt')
  }, 60000)

  it('refuses a write whose reviewed state changed', async () => {
    const r = repo('Work')
    write(r, 'story.txt', story([3]))
    const reviewed = await filesStamp(r, r.path, ['story.txt'])
    run(r.path, 'add', 'story.txt')
    expect(await call('git:stage', r, r.path, REG(), ['story.txt'], reviewed)).toEqual({ ok: false, stale: true, detail: STALE })
    run(r.path, 'reset', '-q')
    run(r.path, 'checkout', '--', 'story.txt')
  }, 60000)

  it('commits the staged changes with the given message', async () => {
    const r = repo('Work')
    write(r, 'story.txt', story([5]))
    await call('git:stage', r, r.path, REG(), ['story.txt'], await filesStamp(r, r.path, ['story.txt']))
    expect(await call('git:commit', r, r.path, REG(), 'Change line 5', await commitStamp(r, r.path))).toMatchObject({ ok: true })
    expect(run(r.path, 'log', '-1', '--format=%s')).toBe('Change line 5\n')
    expect(await call('git:commit', r, r.path, REG(), 'Again', await commitStamp(r, r.path))).toEqual({ ok: false, detail: 'No staged changes.' })
  }, 60000)

  it('stages and unstages on a branch with no commits', async () => {
    const r = repo('Fresh')
    write(r, 'a.txt', 'first\n')
    expect(await call('git:stage', r, r.path, REG(), ['a.txt'], await filesStamp(r, r.path, ['a.txt']))).toMatchObject({ ok: true })
    expect(run(r.path, 'status', '--porcelain')).toBe('A  a.txt\n')
    expect(await call('git:unstage', r, r.path, REG(), ['a.txt'], await filesStamp(r, r.path, ['a.txt']))).toMatchObject({ ok: true })
    expect(run(r.path, 'status', '--porcelain')).toBe('?? a.txt\n')
  }, 60000)

  it('commits each worktree separately: a failing hook in one does not stop the other', async () => {
    const r = repo('Hooked')
    for (const [wt, file] of [[r.path, 'ok.txt'], [failWorktree(), 'no.txt']]) {
      fs.writeFileSync(path.join(wt, file), 'x\n')
      await call('git:stage', r, wt, REG(), [file], await filesStamp(r, wt, [file]))
    }
    const ok = await call('git:commit', r, r.path, REG(), 'Works', await commitStamp(r, r.path))
    const no = await call('git:commit', r, failWorktree(), REG(), 'Blocked', await commitStamp(r, failWorktree()))
    expect(ok.ok).toBe(true)
    expect(no.ok).toBe(false)
    expect(no.detail).toContain('hook says no')
    expect(run(r.path, 'log', '-1', '--format=%s')).toBe('Works\n')
    expect(run(failWorktree(), 'log', '-1', '--format=%s')).toBe('Base\n')
  }, 60000)

  it('lets a pre-commit hook that filters with a glob pathspec see the staged files', async () => {
    const r = repo('Guarded')
    write(r, 'x.secret', 'key\n')
    expect(await call('git:stage', r, r.path, REG(), ['x.secret'], await filesStamp(r, r.path, ['x.secret']))).toMatchObject({ ok: true })
    const no = await call('git:commit', r, r.path, REG(), 'Leak', await commitStamp(r, r.path))
    expect(no.ok).toBe(false)
    expect(no.detail).toContain('secret files staged')
    expect(run(r.path, 'log', '-1', '--format=%s')).toBe('Base\n')
  }, 60000)

  it('stages one hunk of a Latin-1 file', async () => {
    const r = repo('Work')
    const latin = changed => Buffer.from(story(changed).replace(/line (\d+)/g, 'café $1'), 'latin1')
    fs.writeFileSync(path.join(r.path, 'latin.txt'), latin([]))
    run(r.path, 'add', 'latin.txt')
    run(r.path, 'commit', '-q', '-m', 'Latin-1 file')
    fs.writeFileSync(path.join(r.path, 'latin.txt'), latin([2, 28]))
    const d = await call('git:diff', r, r.path, REG(), { area: 'unstaged', paths: ['latin.txt'] })
    expect(parseDiff(d.text).files[0].hunks).toHaveLength(2)
    expect(await call('git:stageHunk', r, r.path, REG(), ['latin.txt'], 0, d.stamp)).toMatchObject({ ok: true })
    expect(execFileSync('git', ['show', ':latin.txt'], { cwd: r.path }).equals(latin([2]))).toBe(true)
    run(r.path, 'reset', '-q')
    run(r.path, 'checkout', '--', 'latin.txt')
  }, 60000)

  it('refuses to unstage a hunk of a staged rename', async () => {
    const r = repo('Work')
    write(r, 'old-name.txt', story([]))
    run(r.path, 'add', 'old-name.txt')
    run(r.path, 'commit', '-q', '-m', 'Add old-name')
    run(r.path, 'mv', 'old-name.txt', 'new-name.txt')
    write(r, 'new-name.txt', story([2, 28]))
    run(r.path, 'add', 'new-name.txt')
    const paths = ['new-name.txt', 'old-name.txt']
    const s = await call('git:diff', r, r.path, REG(), { area: 'staged', paths })
    expect(parseDiff(s.text).files[0].status).toBe('renamed')
    expect(await call('git:unstageHunk', r, r.path, REG(), paths, 0, s.stamp))
      .toEqual({ ok: false, detail: 'Renamed, copied or mode-changed files are staged whole.' })
    expect(run(r.path, 'status', '--porcelain')).toBe('R  old-name.txt -> new-name.txt\n')
    run(r.path, 'reset', '-q', '--hard')
  }, 60000)

  it('refuses to stage an untracked nested repository', async () => {
    const r = repo('Work')
    const nested = path.join(r.path, 'nested')
    fs.mkdirSync(nested)
    run(nested, 'init', '-q', '-b', 'main')
    fs.writeFileSync(path.join(nested, 'inner.txt'), 'inner\n')
    expect(run(r.path, 'status', '--porcelain', '--untracked-files=all')).toBe('?? nested/\n')
    expect(await call('git:stage', r, r.path, REG(), ['nested/'], await filesStamp(r, r.path, ['nested/'])))
      .toEqual({ ok: false, detail: 'Nested repositories are managed on their own.' })
    expect(run(r.path, 'ls-files', '--stage', 'nested')).toBe('')
    fs.rmSync(nested, { recursive: true, force: true })
  }, 60000)

  it('rejects a subfolder of the repository as a worktree', async () => {
    const r = repo('Work')
    const sub = path.join(r.path, 'sub')
    fs.mkdirSync(sub)
    await expect(call('git:stamp', r, sub, REG(), { kind: 'files', paths: ['x.txt'] })).rejects.toThrow('Not a worktree of')
    fs.rmSync(sub, { recursive: true, force: true })
  }, 60000)
})
