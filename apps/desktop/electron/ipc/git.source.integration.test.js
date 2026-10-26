// @vitest-environment node
// The source-branch module against real git: detection, storage, staleness and counts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync, execFile } from 'child_process'
import { createRequire } from 'module'

const { createSourceReader } = createRequire(import.meta.url)('./git-source.cjs')

let root
let n = 0
const saved = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM }
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().replace(/\r\n/g, '\n')
const commit = (dir, msg) => { fs.writeFileSync(path.join(dir, 'f'), msg + '\n' + Math.random()); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', msg) }
const stored = (dir, b) => { try { return git(dir, 'config', '--get', `branch.${b}.nexusBase`).trim() } catch { return null } }
const tip = (dir, ref = 'HEAD') => git(dir, 'rev-parse', ref).trim()
const dropReflogs = dir => git(dir, 'reflog', 'expire', '--expire=now', '--all')

// A fresh repo on main with three commits, plus a reader whose spawns are counted.
function repo() {
  const dir = path.join(root, 'r' + n++)
  fs.mkdirSync(dir)
  git(dir, 'init', '-q')
  for (const m of ['c1', 'c2', 'c3']) commit(dir, m)
  const calls = []
  const run = args => new Promise(resolve => {
    calls.push(args)
    execFile('git', args, { cwd: dir }, (err, stdout) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout).replace(/\r\n/g, '\n') }))
  })
  const reader = createSourceReader({ run, commonDir: path.join(dir, '.git') })
  return { dir, calls, reader }
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
})
