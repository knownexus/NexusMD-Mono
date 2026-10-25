// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { register } from './git.cjs'

let root
let outside
const revealed = []
const handlers = {}
const saved = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM }
const run = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
const call = (channel, ...args) => handlers[channel](null, ...args)
const repo = { name: 'Work', path: null }
const REG = () => [repo.path]
const disk = file => path.join(repo.path, file)
const drop = (dest, sources, options) => call('git:importFiles', repo, repo.path, REG(), dest, sources, options)
const status = () => run(repo.path, 'status', '--porcelain', '-uall').split('\n').filter(Boolean).sort()

beforeAll(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-gitimp-')))
  const globalConfig = path.join(root, 'gitconfig')
  fs.writeFileSync(globalConfig, '[user]\n\tname = Test\n\temail = test@example.invalid\n[core]\n\tautocrlf = false\n')
  process.env.GIT_CONFIG_GLOBAL = globalConfig
  process.env.GIT_CONFIG_NOSYSTEM = '1'

  repo.path = path.join(root, 'Work')
  fs.mkdirSync(repo.path)
  run(repo.path, 'init', '-b', 'main')
  fs.mkdirSync(disk('docs'))
  fs.writeFileSync(disk('docs/readme.txt'), 'original\n')
  run(repo.path, 'add', '.')
  run(repo.path, 'commit', '-m', 'Initial')

  outside = path.join(root, 'Outside')
  fs.mkdirSync(path.join(outside, 'pack', 'inner'), { recursive: true })
  fs.writeFileSync(path.join(outside, 'logo.png'), 'png')
  fs.writeFileSync(path.join(outside, 'readme.txt'), 'dropped\n')
  fs.writeFileSync(path.join(outside, 'pack', 'a.txt'), 'a')
  fs.writeFileSync(path.join(outside, 'pack', 'inner', 'b.txt'), 'b')
  fs.mkdirSync(path.join(outside, 'pack', '.git'))
  fs.writeFileSync(path.join(outside, 'pack', '.git', 'config'), 'nope')

  register({ handle: (channel, fn) => { handlers[channel] = fn } }, {
    logger: { scope: () => ({ error: () => {}, info: () => {} }) },
    reveal: async (full, isRoot) => { revealed.push({ full, isRoot }) },
  })
}, 60000)

afterAll(() => {
  if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved.global
  if (saved.nosystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = saved.nosystem
  fs.rmSync(root, { recursive: true, force: true })
})

describe('git workspace drag-and-drop import against a real repository', { timeout: 60000 }, () => {
  it('copies a new file into a folder as untracked, leaving the source', async () => {
    const r = await drop('docs', [path.join(outside, 'logo.png')])
    expect(r).toEqual({ added: 1, replaced: 0, skipped: 0, failed: [] })
    expect(fs.readFileSync(disk('docs/logo.png'), 'utf8')).toBe('png')
    expect(fs.existsSync(path.join(outside, 'logo.png'))).toBe(true)
    expect(status()).toEqual(['?? docs/logo.png'])
  })

  it('reports an existing name instead of replacing it', async () => {
    const plan = await drop('docs', [path.join(outside, 'readme.txt')], { dryRun: true })
    expect(plan).toEqual({ total: 1, conflicts: ['docs/readme.txt'], failed: [] })
    const r = await drop('docs', [path.join(outside, 'readme.txt')])
    expect(r).toMatchObject({ added: 0, replaced: 0, skipped: 1 })
    expect(fs.readFileSync(disk('docs/readme.txt'), 'utf8')).toBe('original\n')
  })

  it('replaces only the names it is told to, which then show as unstaged', async () => {
    const r = await drop('docs', [path.join(outside, 'readme.txt')], { replace: ['docs/readme.txt'] })
    expect(r).toMatchObject({ added: 0, replaced: 1, skipped: 0 })
    expect(fs.readFileSync(disk('docs/readme.txt'), 'utf8')).toBe('dropped\n')
    expect(status()).toContain(' M docs/readme.txt')
    expect(fs.readdirSync(disk('docs')).filter(n => n.endsWith('.tmp'))).toEqual([])
  })

  it('copies a dropped folder with its contents but not its .git, creating the destination', async () => {
    const r = await drop('', [path.join(outside, 'pack')])
    expect(r).toMatchObject({ added: 2, failed: [] })
    expect(fs.existsSync(disk('pack/inner/b.txt'))).toBe(true)
    expect(fs.existsSync(disk('pack/.git'))).toBe(false)
    const deep = await drop('new/deeper', [path.join(outside, 'logo.png')])
    expect(deep.added).toBe(1)
    expect(fs.existsSync(disk('new/deeper/logo.png'))).toBe(true)
  })

  it('refuses destinations inside .git, outside the worktree, or that are files', async () => {
    const src = [path.join(outside, 'logo.png')]
    await expect(drop('.git', src)).rejects.toThrow('Not a worktree folder')
    await expect(drop('docs/.git/hooks', src)).rejects.toThrow('Not a worktree folder')
    await expect(drop('../Outside', src)).rejects.toThrow('Not a worktree folder')
    await expect(drop('docs/readme.txt', src)).rejects.toThrow('Not a worktree folder')
    expect(fs.existsSync(path.join(root, 'Outside', 'logo.png'))).toBe(true)
  })

  it('rejects relative sources and unregistered repositories', async () => {
    await expect(drop('docs', ['logo.png'])).rejects.toThrow('no file path')
    await expect(drop('docs', [])).rejects.toThrow('Nothing was dropped')
    await expect(call('git:importFiles', repo, repo.path, [path.join(root, 'Other')], 'docs', [path.join(outside, 'logo.png')])).rejects.toThrow('Not a registered repository')
  })

  it('reveals files and folders selected, and opens only the worktree root itself', async () => {
    const reveal = rel => call('git:reveal', repo, repo.path, REG(), rel)
    await reveal('docs/readme.txt')
    await reveal('docs')
    await reveal('')
    expect(revealed).toEqual([
      { full: disk('docs/readme.txt'), isRoot: false },
      { full: disk('docs'), isRoot: false },
      { full: repo.path, isRoot: true },
    ])
  })

  it('refuses to reveal .git, paths outside the worktree, missing paths and unregistered repositories', async () => {
    const before = revealed.length
    await expect(call('git:reveal', repo, repo.path, REG(), '.git')).rejects.toThrow('Not a worktree file')
    await expect(call('git:reveal', repo, repo.path, REG(), '../Outside')).rejects.toThrow('Invalid file path')
    await expect(call('git:reveal', repo, repo.path, REG(), 'docs/gone.txt')).rejects.toThrow('no longer exists')
    await expect(call('git:reveal', repo, repo.path, [path.join(root, 'Other')], 'docs')).rejects.toThrow('Not a registered repository')
    expect(revealed.length).toBe(before)
  })

  it('skips a file dropped onto itself', async () => {
    const r = await drop('docs', [disk('docs/logo.png')], { replace: ['docs/logo.png'] })
    expect(r).toMatchObject({ added: 0, replaced: 0, skipped: 1 })
  })
})
