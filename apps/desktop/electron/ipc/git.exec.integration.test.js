// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { register, checkExecArgv } from './git.cjs'

let root
const handlers = {}
const saved = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM }
const run = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
const repo = () => ({ name: 'Work', path: path.join(root, 'Work') })
const REG = () => [repo().path]
const exec = (argv, { r = repo(), wt = r.path, reg = REG() } = {}) => handlers['git:exec'](null, r, wt, reg, argv)

beforeAll(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-gitx-')))
  const globalConfig = path.join(root, 'gitconfig')
  fs.writeFileSync(globalConfig, '[user]\n\tname = Test\n\temail = test@example.invalid\n[core]\n\tautocrlf = false\n')
  process.env.GIT_CONFIG_GLOBAL = globalConfig
  process.env.GIT_CONFIG_NOSYSTEM = '1'

  const work = repo()
  fs.mkdirSync(path.join(work.path, 'sub'), { recursive: true })
  run(work.path, 'init', '-b', 'main')
  fs.writeFileSync(path.join(work.path, 'a.txt'), 'a\n')
  fs.writeFileSync(path.join(work.path, 'sub', 'b.txt'), 'b\n')
  run(work.path, 'add', '.')
  run(work.path, 'commit', '-m', 'Initial')

  fs.mkdirSync(path.join(root, 'Other'))
  run(path.join(root, 'Other'), 'init', '-b', 'main')

  register({ handle: (channel, fn) => { handlers[channel] = fn } }, { logger: { scope: () => ({ error: () => {}, info: () => {} }) } })
}, 60000)

afterAll(() => {
  if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved.global
  if (saved.nosystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = saved.nosystem
  fs.rmSync(root, { recursive: true, force: true })
})

describe('checkExecArgv', () => {
  it('accepts a subcommand with arguments', () => {
    expect(checkExecArgv(['log', '--oneline', '-5'])).toEqual(['log', '--oneline', '-5'])
  })

  it('refuses global options, an empty argv and non-strings', () => {
    for (const argv of [['-C', 'x', 'status'], ['-c', 'core.pager=x', 'log'], ['--git-dir=x', 'status'], ['--exec-path=x'], ['']]) {
      expect(() => checkExecArgv(argv)).toThrow(/not allowed here/)
    }
    for (const argv of [[], null, 'status', [1], ['status', 'a\0b']]) expect(() => checkExecArgv(argv)).toThrow('Not a git command')
  })

  it('refuses touching safe.directory anywhere in the argv', () => {
    expect(() => checkExecArgv(['config', '--global', '--add', 'safe.directory', '*'])).toThrow('safe.directory')
  })
})

describe('git:exec against a real repository', () => {
  it('runs status in the worktree and returns its output, in git\'s colours', async () => {
    fs.writeFileSync(path.join(repo().path, 'new.txt'), 'n\n')
    const r = await exec(['status', '--short'])
    expect(r).toMatchObject({ code: 0, stderr: '' })
    // eslint-disable-next-line no-control-regex
    expect(r.stdout).toMatch(/\x1b\[3\dm/)
    // eslint-disable-next-line no-control-regex
    expect(r.stdout.replace(/\x1b\[[0-9;]*m/g, '')).toContain('?? new.txt')
    fs.rmSync(path.join(repo().path, 'new.txt'))
  })

  it('returns a non-zero code with stderr for an unknown command', async () => {
    const r = await exec(['definitely-not-a-command'])
    expect(r.code).not.toBe(0)
    expect(r.stderr).toMatch(/not a git command/)
  })

  it('refuses an unregistered repository, a folder that is not a worktree, and global options before spawning', async () => {
    const other = { name: 'Other', path: path.join(root, 'Other') }
    await expect(exec(['status'], { r: other, reg: REG() })).rejects.toThrow('Not a registered repository')
    await expect(exec(['status'], { wt: path.join(repo().path, 'sub') })).rejects.toThrow('Not a worktree of')
    await expect(exec(['-C', other.path, 'status'])).rejects.toThrow('not allowed here')
    await expect(exec(['-c', 'alias.x=!echo hi', 'x'])).rejects.toThrow('not allowed here')
  })

  it('reads pathspecs as a terminal would, globs included', async () => {
    const r = await exec(['ls-files', '--', '*.txt'])
    expect(r.code).toBe(0)
    expect(r.stdout.split('\n').filter(Boolean).sort()).toEqual(['a.txt', 'sub/b.txt'])
  })

  it('fails fast instead of waiting on an editor', async () => {
    const r = await exec(['commit', '--allow-empty'])
    expect(r.code).not.toBe(0)
    expect(r.stderr).toMatch(/empty commit message/i)
    expect(run(repo().path, 'rev-list', '--count', 'HEAD').trim()).toBe('1')
  }, 30000)

  it('writes with the user\'s arguments, e.g. a new branch', async () => {
    expect(await exec(['branch', 'topic'])).toMatchObject({ code: 0 })
    expect(run(repo().path, 'branch', '--list', 'topic')).toContain('topic')
  })
})
