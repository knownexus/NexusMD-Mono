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

const conf = (r, rel) => call('git:conflict', r, r.path, REG(), rel)
const resolve = (r, rel, resolution, expected) => call('git:resolveConflict', r, r.path, REG(), rel, resolution, expected)
const xy = async (r, rel) => (run(r.path, 'status', '--porcelain=v2', '--', rel).split('\n').find(l => l.startsWith('u ')) || '').slice(2, 4)
const conflicted = (r, rel) => run(r.path, 'ls-files', '-u', '--', rel).trim() !== ''

describe('git:conflict and git:resolveConflict', { timeout: 60000 }, () => {
  it('stage 3 is the replayed commit', async () => {
    const r = diverged('Stages')
    tryRun(r.path, 'rebase', 'main')
    const c = await conf(r, 'f')
    expect(c.kind).toBe('both-modified')
    expect(c.binary).toBe(false)
    expect(c.stages.base.text).toBe('base\n')
    expect(c.stages.left.text).toBe('main\n')
    expect(c.stages.right.text).toBe('feature\n')
    expect(c.working.text).toMatch(/<<<<<<</)
    expect(c.stamp).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses a file that is not conflicted', async () => {
    const r = diverged('NotConflicted')
    await expect(conf(r, 'f')).rejects.toThrow('Not conflicted any more: f')
  })

  it('resolves with text and stages it', async () => {
    const r = diverged('Text')
    tryRun(r.path, 'rebase', 'main')
    const c = await conf(r, 'f')
    expect(await resolve(r, 'f', { take: 'text', text: 'both\r\n', bom: true }, c.stamp)).toMatchObject({ ok: true })
    expect(conflicted(r, 'f')).toBe(false)
    expect(await xy(r, 'f')).toBe('')
    const bytes = fs.readFileSync(path.join(r.path, 'f'))
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(bytes.subarray(3).toString()).toBe('both\r\n')
    expect(run(r.path, 'diff', '--cached', '--name-only')).toContain('f')
  })

  it('refuses text that still has markers unless forced', async () => {
    const r = diverged('Markers')
    tryRun(r.path, 'rebase', 'main')
    const c = await conf(r, 'f')
    const text = '<<<<<<< a\nx\n=======\ny\n>>>>>>> b\n'
    expect(await resolve(r, 'f', { take: 'text', text, bom: false }, c.stamp)).toMatchObject({ ok: false })
    expect(conflicted(r, 'f')).toBe(true)
    expect(fs.readFileSync(path.join(r.path, 'f'), 'utf8')).not.toBe(text)
    expect(await resolve(r, 'f', { take: 'text', text, bom: false, force: true }, c.stamp)).toMatchObject({ ok: true })
    expect(conflicted(r, 'f')).toBe(false)
  })

  it('take left and take right', async () => {
    const a = diverged('Left')
    tryRun(a.path, 'rebase', 'main')
    expect(await resolve(a, 'f', { take: 'left' }, (await conf(a, 'f')).stamp)).toMatchObject({ ok: true })
    expect(fs.readFileSync(path.join(a.path, 'f'), 'utf8')).toBe('main\n')
    expect(conflicted(a, 'f')).toBe(false)
    const b = diverged('Right')
    tryRun(b.path, 'rebase', 'main')
    expect(await resolve(b, 'f', { take: 'right' }, (await conf(b, 'f')).stamp)).toMatchObject({ ok: true })
    expect(fs.readFileSync(path.join(b.path, 'f'), 'utf8')).toBe('feature\n')
    expect(conflicted(b, 'f')).toBe(false)
  })

  function deletedOnMain(name) {
    const dir = path.join(root, name)
    fs.mkdirSync(dir)
    run(dir, 'init', '-q')
    write(dir, 'f', 'base\n'); write(dir, 'g', 'keep\n'); commit(dir, 'base')
    run(dir, 'checkout', '-q', '-b', 'feature')
    write(dir, 'f', 'feature\n'); commit(dir, 'feature edit')
    run(dir, 'checkout', '-q', 'main')
    run(dir, 'rm', '-q', 'f'); run(dir, 'commit', '-qm', 'main deletes')
    run(dir, 'checkout', '-q', 'feature')
    REPOS.push(dir)
    tryRun(dir, 'rebase', 'main')
    return { name, path: dir }
  }

  it('keeps my version of a file main deleted', async () => {
    const r = deletedOnMain('Deleted')
    const c = await conf(r, 'f')
    expect(c.kind).toBe('deleted-by-left')
    expect(c.stages.left).toBeNull()
    expect(c.stages.right.text).toBe('feature\n')
    expect(await resolve(r, 'f', { take: 'right' }, c.stamp)).toMatchObject({ ok: true })
    expect(fs.readFileSync(path.join(r.path, 'f'), 'utf8')).toBe('feature\n')
    expect(conflicted(r, 'f')).toBe(false)
    expect(run(r.path, 'ls-files', '--', 'f').trim()).toBe('f')
  })

  it('taking an absent side deletes the file', async () => {
    const r = deletedOnMain('DeletedLeft')
    expect(await resolve(r, 'f', { take: 'left' }, (await conf(r, 'f')).stamp)).toMatchObject({ ok: true })
    expect(fs.existsSync(path.join(r.path, 'f'))).toBe(false)
    expect(conflicted(r, 'f')).toBe(false)
  })

  it('accepts the deletion', async () => {
    const r = deletedOnMain('Accept')
    expect(await resolve(r, 'f', { take: 'delete' }, (await conf(r, 'f')).stamp)).toMatchObject({ ok: true })
    expect(fs.existsSync(path.join(r.path, 'f'))).toBe(false)
    expect(conflicted(r, 'f')).toBe(false)
    expect(run(r.path, 'ls-files', '--', 'f').trim()).toBe('')
  })

  it('binary takes one side', async () => {
    const dir = path.join(root, 'Binary')
    fs.mkdirSync(dir)
    run(dir, 'init', '-q')
    fs.writeFileSync(path.join(dir, 'b.bin'), Buffer.from([0, 1, 2]))
    commit(dir, 'base')
    run(dir, 'checkout', '-q', '-b', 'feature')
    fs.writeFileSync(path.join(dir, 'b.bin'), Buffer.from([0, 1, 3]))
    commit(dir, 'feature')
    run(dir, 'checkout', '-q', 'main')
    fs.writeFileSync(path.join(dir, 'b.bin'), Buffer.from([0, 1, 4]))
    commit(dir, 'main')
    run(dir, 'checkout', '-q', 'feature')
    REPOS.push(dir)
    const r = { name: 'Binary', path: dir }
    tryRun(dir, 'rebase', 'main')
    const c = await conf(r, 'b.bin')
    expect(c.binary).toBe(true)
    expect(c.stages.left).toBeNull()
    expect(c.stages.right).toBeNull()
    expect(c.working).toBeNull()
    expect(await resolve(r, 'b.bin', { take: 'right' }, c.stamp)).toMatchObject({ ok: true })
    expect([...fs.readFileSync(path.join(dir, 'b.bin'))]).toEqual([0, 1, 3])
    expect(conflicted(r, 'b.bin')).toBe(false)
  })

  it('unresolve restores the conflict after add', async () => {
    const r = diverged('Unresolve')
    tryRun(r.path, 'rebase', 'main')
    const c = await conf(r, 'f')
    await resolve(r, 'f', { take: 'text', text: 'done\n', bom: false }, c.stamp)
    expect(conflicted(r, 'f')).toBe(false)
    const stamp = await call('git:stamp', r, r.path, REG(), { kind: 'files', paths: ['f'] })
    expect(await call('git:unresolve', r, r.path, REG(), 'f', stamp)).toMatchObject({ ok: true })
    expect(fs.readFileSync(path.join(r.path, 'f'), 'utf8')).toMatch(/<<<<<<</)
    expect(conflicted(r, 'f')).toBe(true)
    expect(await xy(r, 'f')).toBe('UU')
  })

  it('refuses a stale resolve', async () => {
    const r = diverged('StaleResolve')
    tryRun(r.path, 'rebase', 'main')
    const c = await conf(r, 'f')
    write(r.path, 'f', 'edited elsewhere\n')
    expect(await resolve(r, 'f', { take: 'left' }, c.stamp)).toMatchObject({ ok: false, stale: true })
    expect(conflicted(r, 'f')).toBe(true)
  })

  it('refuses paths in .git and outside the worktree', async () => {
    const r = diverged('Escape')
    tryRun(r.path, 'rebase', 'main')
    await expect(conf(r, '.git/config')).rejects.toThrow()
    await expect(resolve(r, '../x', { take: 'left' }, 'x')).rejects.toThrow()
  })
})

describe('git:unresolve and special files', { timeout: 60000 }, () => {
  const stampOf = (r, rel) => call('git:stamp', r, r.path, REG(), { kind: 'files', paths: [rel] })
  const unresolve = async (r, rel) => call('git:unresolve', r, r.path, REG(), rel, await stampOf(r, rel))

  function deletedOnMain(name) {
    const dir = path.join(root, name)
    fs.mkdirSync(dir)
    run(dir, 'init', '-q')
    write(dir, 'f', 'base\n'); write(dir, 'g', 'keep\n'); commit(dir, 'base')
    run(dir, 'checkout', '-q', '-b', 'feature')
    write(dir, 'f', 'feature\n'); commit(dir, 'feature edit')
    run(dir, 'checkout', '-q', 'main')
    run(dir, 'rm', '-q', 'f'); run(dir, 'commit', '-qm', 'main deletes')
    run(dir, 'checkout', '-q', 'feature')
    REPOS.push(dir)
    tryRun(dir, 'rebase', 'main')
    return { name, path: dir }
  }

  it('unresolve restores a conflict that was missing a side', async () => {
    const r = deletedOnMain('UnDU')
    await resolve(r, 'f', { take: 'right' }, (await conf(r, 'f')).stamp)
    expect(conflicted(r, 'f')).toBe(false)
    expect(await unresolve(r, 'f')).toMatchObject({ ok: true })
    expect(conflicted(r, 'f')).toBe(true)
    expect(await xy(r, 'f')).toBe('DU')
    expect((await conf(r, 'f')).kind).toBe('deleted-by-left')
  })

  it('unresolve works after a delete of a both-modified file', async () => {
    const r = diverged('UnRm')
    tryRun(r.path, 'rebase', 'main')
    expect(await resolve(r, 'f', { take: 'delete' }, (await conf(r, 'f')).stamp)).toMatchObject({ ok: true })
    expect(await unresolve(r, 'f')).toMatchObject({ ok: true })
    expect(await xy(r, 'f')).toBe('UU')
    expect(fs.readFileSync(path.join(r.path, 'f'), 'utf8')).toMatch(/<<<<<<</)
  })

  it('unresolve refuses a never-conflicted modified file and keeps the edit', async () => {
    const r = diverged('UnClean')
    write(r.path, 'f', 'my edit\n')
    expect(await unresolve(r, 'f')).toMatchObject({ ok: false, detail: 'Nothing to undo for f.' })
    expect(fs.readFileSync(path.join(r.path, 'f'), 'utf8')).toBe('my edit\n')
  })

  it('unresolve refuses a still-conflicted file and keeps the draft', async () => {
    const r = diverged('UnStill')
    tryRun(r.path, 'rebase', 'main')
    write(r.path, 'f', 'half done\n')
    expect(await unresolve(r, 'f')).toMatchObject({ ok: false, detail: 'Still conflicted — nothing to undo.' })
    expect(fs.readFileSync(path.join(r.path, 'f'), 'utf8')).toBe('half done\n')
  })

  it('unresolve refuses a resolved file edited since', async () => {
    const r = diverged('UnEdited')
    tryRun(r.path, 'rebase', 'main')
    await resolve(r, 'f', { take: 'text', text: 'done\n', bom: false }, (await conf(r, 'f')).stamp)
    write(r.path, 'f', 'done and more\n')
    expect(await unresolve(r, 'f')).toMatchObject({ ok: false, detail: 'f has changes since it was resolved.' })
    expect(fs.readFileSync(path.join(r.path, 'f'), 'utf8')).toBe('done and more\n')
    expect(conflicted(r, 'f')).toBe(false)
  })

  it('a symlink conflict is not text and refuses a text resolve', async () => {
    const dir = path.join(root, 'Link')
    fs.mkdirSync(dir)
    run(dir, 'init', '-q')
    write(dir, 'x', 'x\n'); commit(dir, 'base')
    const setLink = target => {
      const oid = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: dir, input: target }).toString().trim()
      run(dir, 'update-index', '--add', '--cacheinfo', `120000,${oid},l`)
      run(dir, 'commit', '-qm', `link ${target}`)
    }
    run(dir, 'checkout', '-q', '-b', 'feature')
    setLink('feature-target')
    run(dir, 'checkout', '-q', 'main')
    setLink('main-target')
    run(dir, 'checkout', '-q', 'feature')
    REPOS.push(dir)
    const r = { name: 'Link', path: dir }
    tryRun(dir, 'rebase', 'main')
    const c = await conf(r, 'l')
    expect(c).toMatchObject({ binary: true, symlink: true, working: null })
    expect(c.stages).toEqual({ base: null, left: null, right: null })
    expect(await resolve(r, 'l', { take: 'text', text: 'oops\n', bom: false }, c.stamp)).toMatchObject({ ok: false })
    expect(conflicted(r, 'l')).toBe(true)
    expect(await resolve(r, 'l', { take: 'right' }, c.stamp)).toMatchObject({ ok: true })
    expect(conflicted(r, 'l')).toBe(false)
    expect(run(dir, 'ls-files', '-s', '--', 'l')).toMatch(/^120000 /)
  })

  it('a working file that cannot be read is an error, not binary', async () => {
    const r = diverged('Unreadable')
    tryRun(r.path, 'rebase', 'main')
    fs.rmSync(path.join(r.path, 'f'))
    fs.mkdirSync(path.join(r.path, 'f'))
    await expect(conf(r, 'f')).rejects.toThrow()
  })
})

describe('unresolve guards (resolution record)', { timeout: 90000 }, () => {
  const stampOf = (r, rel) => call('git:stamp', r, r.path, REG(), { kind: 'files', paths: [rel] })
  const unresolve = async (r, rel) => call('git:unresolve', r, r.path, REG(), rel, await stampOf(r, rel))
  const records = r => path.join(r.path, '.git', 'nexusmd-resolutions.json')
  const index = r => run(r.path, 'ls-files', '-s')
  const CHANGED = 'f has changes since it was resolved.'

  it('refuses a file recreated after a delete resolution', async () => {
    const r = diverged('RecDel')
    tryRun(r.path, 'rebase', 'main')
    await resolve(r, 'f', { take: 'delete' }, (await conf(r, 'f')).stamp)
    write(r.path, 'f', 'my new work\n')
    const before = index(r)
    expect(await unresolve(r, 'f')).toMatchObject({ ok: false, detail: CHANGED })
    expect(fs.readFileSync(path.join(r.path, 'f'), 'utf8')).toBe('my new work\n')
    expect(index(r)).toBe(before)
  })

  it('refuses an edit staged after resolving', async () => {
    const r = diverged('Staged')
    tryRun(r.path, 'rebase', 'main')
    await resolve(r, 'f', { take: 'text', text: 'done\n', bom: false }, (await conf(r, 'f')).stamp)
    write(r.path, 'f', 'done plus\n'); run(r.path, 'add', 'f')
    const before = index(r)
    expect(await unresolve(r, 'f')).toMatchObject({ ok: false, detail: CHANGED })
    expect(fs.readFileSync(path.join(r.path, 'f'), 'utf8')).toBe('done plus\n')
    expect(index(r)).toBe(before)
  })

  it('refuses a resolution made outside NexusMD', async () => {
    const r = diverged('Outside')
    tryRun(r.path, 'rebase', 'main')
    write(r.path, 'f', 'by hand\n'); run(r.path, 'add', 'f')
    expect(await unresolve(r, 'f')).toMatchObject({ ok: false, detail: 'f was resolved outside NexusMD \u2014 undo it there.' })
    expect(fs.readFileSync(path.join(r.path, 'f'), 'utf8')).toBe('by hand\n')
    expect(conflicted(r, 'f')).toBe(false)
  })

  it('clears the record when the rebase finishes', async () => {
    const r = diverged('Cleared')
    tryRun(r.path, 'rebase', 'main')
    await resolve(r, 'f', { take: 'text', text: 'done\n', bom: false }, (await conf(r, 'f')).stamp)
    expect(fs.existsSync(records(r))).toBe(true)
    expect(await act(r, r.path, 'continue')).toMatchObject({ ok: true })
    expect(fs.existsSync(records(r))).toBe(false)
  })

  it('clears the record when the rebase is aborted', async () => {
    const r = diverged('Aborted')
    tryRun(r.path, 'rebase', 'main')
    await resolve(r, 'f', { take: 'left' }, (await conf(r, 'f')).stamp)
    expect(fs.existsSync(records(r))).toBe(true)
    expect(await act(r, r.path, 'abort')).toMatchObject({ ok: true })
    expect(fs.existsSync(records(r))).toBe(false)
  })
})

describe('a whole rebase resolved in the workspace', { timeout: 120000 }, () => {
  it('full rebase resolved in the workspace', async () => {
    const dir = path.join(root, 'Story')
    fs.mkdirSync(dir)
    run(dir, 'init', '-q')
    write(dir, 'f', 'base\n'); write(dir, 'g', 'base\n'); commit(dir, 'base')
    run(dir, 'checkout', '-q', '-b', 'feature')
    write(dir, 'f', 'feature f\n'); commit(dir, 'feature f')
    write(dir, 'g', 'feature g\n'); commit(dir, 'feature g')
    run(dir, 'checkout', '-q', 'main')
    write(dir, 'f', 'main f\n'); commit(dir, 'main f')
    write(dir, 'g', 'main g\n'); commit(dir, 'main g')
    run(dir, 'checkout', '-q', 'feature')
    REPOS.push(dir)
    const r = { name: 'Story', path: dir }
    const records = path.join(dir, '.git', 'nexusmd-resolutions.json')

    expect(tryRun(dir, 'rebase', 'main')).toMatch(/CONFLICT/)
    let s = await status(r)
    expect(s.operationInfo).toMatchObject({ kind: 'rebase', step: 1, total: 2 })
    expect(s.operationInfo.replaying.subject).toBe('feature f')

    const first = await resolve(r, 'f', { take: 'text', text: 'merged f\n', bom: false }, (await conf(r, 'f')).stamp)
    expect(first).toMatchObject({ ok: true })
    expect(conflicted(r, 'f')).toBe(false)
    expect(await act(r, dir, 'continue')).toMatchObject({ ok: false, conflict: true, operation: 'Rebase in progress' })

    s = await status(r)
    expect(s.operation).toBe('Rebase in progress')
    expect(s.operationInfo).toMatchObject({ kind: 'rebase', step: 2, total: 2 })
    expect(s.operationInfo.replaying.subject).toBe('feature g')
    const second = await resolve(r, 'g', { take: 'right' }, (await conf(r, 'g')).stamp)
    expect(second).toMatchObject({ ok: true })
    expect(await act(r, dir, 'continue')).toMatchObject({ ok: true })

    s = await status(r)
    expect(s.operation).toBeFalsy()
    expect(s.operationInfo).toBeNull()
    expect(run(dir, 'log', '--format=%s', 'main..feature').trim().split(/\r?\n/)).toEqual(['feature g', 'feature f'])
    expect(fs.readFileSync(path.join(dir, 'f'), 'utf8')).toBe('merged f\n')
    expect(fs.readFileSync(path.join(dir, 'g'), 'utf8')).toBe('feature g\n')
    expect(fs.existsSync(records)).toBe(false)
    expect(fs.existsSync(marker(r))).toBe(false)
  })
})
