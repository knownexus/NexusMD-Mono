// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { register } from './git.cjs'

let root
const handlers = {}
const saved = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM }
const run = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
const tryRun = (cwd, ...args) => { try { return run(cwd, ...args) } catch (e) { return `ERR ${e.stdout}${e.stderr}` } }
const call = (channel, ...args) => handlers[channel](null, ...args)
const REPOS = []
const REG = () => [...REPOS]
const write = (dir, file, text) => fs.writeFileSync(path.join(dir, file), text)
const commit = (dir, msg) => { run(dir, 'add', '-A'); run(dir, 'commit', '-qm', msg) }
const status = r => call('git:status', r, r.path, REG())
const marker = r => path.join(r.path, '.git', 'nexusmd-rebase-onto')

async function act(repo, wt, kind, options = {}) {
  const p = await call('git:preview', repo, wt, REG(), kind, options)
  if (!p.eligible) return { previewRefused: p.reason }
  return call('git:run', repo, wt, REG(), kind, options, p.stamp)
}

// A repository whose `main` and `feature` both edit the one line of `f`; `feature` is checked out.
function diverged(name) {
  const dir = path.join(root, name)
  fs.mkdirSync(dir)
  run(dir, 'init', '-q')
  write(dir, 'f', 'base\n'); commit(dir, 'base')
  run(dir, 'checkout', '-q', '-b', 'feature')
  write(dir, 'f', 'feature\n'); commit(dir, 'feature edit')
  run(dir, 'checkout', '-q', 'main')
  write(dir, 'f', 'main\n'); commit(dir, 'main edit')
  run(dir, 'checkout', '-q', 'feature')
  REPOS.push(dir)
  return { name, path: dir }
}

beforeAll(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-gitc-')))
  const globalConfig = path.join(root, 'gitconfig')
  fs.writeFileSync(globalConfig, '[user]\n\tname = Ana\n\temail = ana@example.invalid\n[core]\n\tautocrlf = false\n[init]\n\tdefaultBranch = main\n')
  process.env.GIT_CONFIG_GLOBAL = globalConfig
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  register({ handle: (channel, fn) => { handlers[channel] = fn } }, {
    logger: { scope: () => ({ error: () => {}, info: () => {} }) },
    editorCommand: { exe: process.execPath, helper: path.join(__dirname, 'git-editor.cjs') },
  })
}, 60000)

afterAll(() => {
  if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved.global
  if (saved.nosystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = saved.nosystem
  fs.rmSync(root, { recursive: true, force: true })
})

// Real git on Windows starts a process per command; keep generous timeouts.
describe('operation details in git:status', { timeout: 60000 }, () => {
  it('status describes a stopped rebase', async () => {
    const r = diverged('Stopped')
    expect(tryRun(r.path, 'rebase', 'main')).toMatch(/CONFLICT/)
    const s = await status(r)
    const main = run(r.path, 'rev-parse', 'main').trim()
    expect(s.operationInfo).toMatchObject({
      kind: 'rebase', step: 1, total: 1,
      onto: { oid: main, name: 'main' },
      replaying: { subject: 'feature edit' },
      merging: null, picked: null,
    })
    expect(s.operationInfo.replaying.oid).toMatch(/^[0-9a-f]{40}$/)
  })

  it('base name is null when two branches point at it', async () => {
    const r = diverged('Ambiguous')
    run(r.path, 'branch', 'main-copy', 'main')
    tryRun(r.path, 'rebase', 'main')
    const s = await status(r)
    expect(s.operationInfo.kind).toBe('rebase')
    expect(s.operationInfo.onto).toEqual({ oid: run(r.path, 'rev-parse', 'main').trim(), name: null })
  })

  it('a rebase NexusMD started remembers its base', async () => {
    const bare = path.join(root, 'remote.git')
    run(root, 'init', '-q', '--bare', bare)
    const r = diverged('Remembered')
    run(r.path, 'checkout', '-q', 'main')
    run(r.path, 'remote', 'add', 'origin', bare)
    run(r.path, 'push', '-q', '-u', 'origin', 'main')
    const other = path.join(root, 'RememberedOther')
    run(root, 'clone', '-q', bare, other)
    write(other, 'f', 'remote\n'); commit(other, 'remote edit')
    // Two remote branches at the same commit: only the remembered name can pick one.
    run(other, 'push', '-q', 'origin', 'HEAD:main', 'HEAD:other')
    write(r.path, 'f', 'local\n'); commit(r.path, 'local edit')
    const res = await act(r, r.path, 'pull', { mode: 'rebase' })
    expect(res).toMatchObject({ ok: false, conflict: true })
    expect(fs.readFileSync(marker(r), 'utf8').trim()).toBe('refs/remotes/origin/main')
    expect((await status(r)).operationInfo.onto.name).toBe('origin/main')
    expect(await act(r, r.path, 'abort')).toMatchObject({ ok: true })
    expect(fs.existsSync(marker(r))).toBe(false)
    expect((await status(r)).operationInfo).toBeNull()
  })

  it('ignores a remembered base that no longer points at onto', async () => {
    const r = diverged('Stale')
    run(r.path, 'branch', 'moved', 'feature')
    tryRun(r.path, 'rebase', 'main')
    write(path.join(r.path, '.git'), 'nexusmd-rebase-onto', 'refs/heads/moved\n')
    // `main` is the only branch at onto, so the single-branch rule names it; the stale marker is not used.
    expect((await status(r)).operationInfo.onto.name).toBe('main')
    run(r.path, 'branch', 'main-copy', 'main')
    expect((await status(r)).operationInfo.onto.name).toBeNull()
  })

  it('status describes a merge and a cherry-pick', async () => {
    const m = diverged('Merging')
    expect(tryRun(m.path, 'merge', 'main')).toMatch(/CONFLICT/)
    const sm = await status(m)
    expect(sm.operationInfo).toMatchObject({ kind: 'merge', step: null, total: null, onto: null, merging: { oid: run(m.path, 'rev-parse', 'main').trim(), name: 'main' }, picked: null })

    const c = diverged('Picking')
    const pick = run(c.path, 'rev-parse', 'main').trim()
    expect(tryRun(c.path, 'cherry-pick', 'main')).toMatch(/CONFLICT/)
    const sc = await status(c)
    expect(sc.operationInfo).toMatchObject({ kind: 'cherry-pick', picked: { oid: pick, subject: 'main edit' }, merging: null, onto: null })
  })

  it('has no operationInfo when nothing is in progress', async () => {
    const r = diverged('Idle')
    expect((await status(r)).operationInfo).toBeNull()
  })
})
