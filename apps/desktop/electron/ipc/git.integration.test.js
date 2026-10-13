// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { loadSnapshot, worktreeName } from '@nexusmd/core'
import { register } from './git.cjs'

let root
const handlers = {}
const saved = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM }
const run = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
const adapter = {
  resolve: dir => handlers['git:resolve'](null, dir),
  worktrees: (repo, reg) => handlers['git:worktrees'](null, repo, reg),
  status: (repo, wt, reg) => handlers['git:status'](null, repo, wt, reg),
  branches: (repo, reg) => handlers['git:branches'](null, repo, reg),
  discover: (roots, repos) => handlers['git:discover'](null, roots, repos),
}

beforeAll(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-git-')))
  const globalConfig = path.join(root, 'gitconfig')
  fs.writeFileSync(globalConfig, '[user]\n\tname = Test\n\temail = test@example.invalid\n[core]\n\tautocrlf = false\n')
  process.env.GIT_CONFIG_GLOBAL = globalConfig
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  const repos = path.join(root, 'repos')
  const normal = path.join(repos, 'Normal')
  fs.mkdirSync(normal, { recursive: true })
  run(normal, 'init', '-b', 'main')
  fs.writeFileSync(path.join(normal, 'a b.txt'), 'one\n')
  run(normal, 'add', '.')
  run(normal, 'commit', '-m', 'Initial')
  fs.writeFileSync(path.join(normal, 'a b.txt'), 'two\n')
  fs.writeFileSync(path.join(normal, 'new.txt'), 'new\n')
  const layout = path.join(repos, 'Layout')
  fs.mkdirSync(layout)
  run(root, 'clone', '--bare', normal, path.join(layout, '.git-main'))
  run(path.join(layout, '.git-main'), 'worktree', 'add', path.join(layout, 'master'), 'main')
  run(path.join(layout, '.git-main'), 'worktree', 'add', '-b', 'topic', path.join(root, 'external topic'), 'main')
  fs.mkdirSync(path.join(repos, 'Plain'))
  register({ handle: (channel, fn) => { handlers[channel] = fn } }, { logger: { scope: () => ({ error: () => {}, info: () => {} }) } })
}, 60000)

afterAll(() => {
  if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved.global
  if (saved.nosystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = saved.nosystem
  fs.rmSync(root, { recursive: true, force: true })
})

const registered = () => [
  { name: 'Normal', path: path.join(root, 'repos', 'Normal') },
  { name: 'Layout', path: path.join(root, 'repos', 'Layout') },
]

describe('git workspace against real repositories', () => {
  it('builds a snapshot of a normal repo and a .git-main layout with an external worktree', async () => {
    const s = await loadSnapshot(adapter, registered())
    expect(s.errors).toEqual([])
    const normal = s.worktrees.filter(t => t.repo === 'Normal')
    expect(normal).toHaveLength(1)
    expect(normal[0].changes.map(c => [c.area, c.path])).toEqual([['unstaged', 'a b.txt'], ['untracked', 'new.txt']])
    const layout = s.worktrees.filter(t => t.repo === 'Layout')
    expect(layout.map(t => t.branch).sort()).toEqual(['main', 'topic'])
    expect(layout.map(worktreeName)).toContain('master')
    expect(layout.every(t => t.error === '')).toBe(true)
    expect(s.branches.filter(b => b.repo === 'Layout').map(b => b.name)).toEqual(['main', 'topic'])
  }, 60000)

  it('discovers repo folders, skipping plain folders and marking registered ones', async () => {
    const found = await adapter.discover([path.join(root, 'repos'), path.join(root, 'missing')], [registered()[0]])
    expect(found.map(f => f.name)).toEqual(['Layout', 'Normal'])
    expect(found.find(f => f.name === 'Normal').registeredAs).toBe('Normal')
  }, 60000)

  it('reports a deleted worktree folder as missing rather than clean', async () => {
    fs.rmSync(path.join(root, 'external topic'), { recursive: true, force: true })
    const s = await loadSnapshot(adapter, registered())
    const topic = s.worktrees.find(t => t.branch === 'topic' || t.path.endsWith('external topic'))
    expect(topic.error).toMatch(/^Missing worktree/)
  }, 60000)
})
