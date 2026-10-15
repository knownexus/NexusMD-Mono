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
const tryRun = (cwd, ...args) => { try { return run(cwd, ...args) } catch (e) { return `ERR ${e.stderr}` } }
const call = (channel, ...args) => handlers[channel](null, ...args)
const R = name => ({ name, path: path.join(root, name) })
const REG = () => ['Work', 'Other', 'Rebase', 'Hooked'].map(n => path.join(root, n))
const write = (dir, file, text) => fs.writeFileSync(path.join(dir, file), text)
const commit = (dir, msg) => { run(dir, 'add', '-A'); run(dir, 'commit', '-qm', msg) }
const head = dir => run(dir, 'rev-parse', 'HEAD').trim()
const subjects = (dir, range = 'HEAD') => run(dir, 'log', '--format=%s', range).split('\n').filter(Boolean)

// Preview, then run with the preview's stamp: the normal flow.
async function act(repo, wt, kind, options = {}) {
  const p = await call('git:preview', repo, wt, REG(), kind, options)
  if (!p.eligible) return { previewRefused: p.reason }
  return call('git:run', repo, wt, REG(), kind, options, p.stamp)
}

beforeAll(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-gita-')))
  const globalConfig = path.join(root, 'gitconfig')
  fs.writeFileSync(globalConfig, '[user]\n\tname = Ana\n\temail = ana@example.invalid\n[core]\n\tautocrlf = false\n[init]\n\tdefaultBranch = main\n')
  process.env.GIT_CONFIG_GLOBAL = globalConfig
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  run(root, 'init', '-q', '--bare', 'remote.git')

  const w = R('Work').path
  fs.mkdirSync(w)
  run(w, 'init', '-q')
  write(w, 'f', '1\n'); commit(w, 'c1')
  run(w, 'remote', 'add', 'origin', path.join(root, 'remote.git'))
  run(w, 'push', '-q', '-u', 'origin', 'main')

  // A second clone that moves the remote on.
  run(root, 'clone', '-q', path.join(root, 'remote.git'), 'Other')

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

describe('stage 4 actions against real repositories', () => {
  it('fetches, then fast-forwards; refuses a fast-forward once both sides moved', async () => {
    const work = R('Work')
    const other = R('Other').path
    write(other, 'f', '2\n'); commit(other, 'c2 from other'); run(other, 'push', '-q')
    expect(await act(work, work.path, 'fetch')).toMatchObject({ ok: true })
    const p = await call('git:preview', work, work.path, REG(), 'pull', { mode: 'ff' })
    expect(p.details).toMatchObject({ behind: 1, ahead: 0, incoming: [expect.objectContaining({ subject: 'c2 from other' })] })
    expect(await call('git:run', work, work.path, REG(), 'pull', { mode: 'ff' }, p.stamp)).toMatchObject({ ok: true })
    expect(subjects(work.path)[0]).toBe('c2 from other')

    write(other, 'o', 'o\n'); commit(other, 'c3 from other'); run(other, 'push', '-q')
    write(work.path, 'w', 'w\n'); commit(work.path, 'local work')
    await act(work, work.path, 'fetch')
    expect((await act(work, work.path, 'pull', { mode: 'ff' })).previewRefused).toMatch(/both moved on/)
    expect(await act(work, work.path, 'pull', { mode: 'rebase' })).toMatchObject({ ok: true })
    expect(subjects(work.path).slice(0, 2)).toEqual(['local work', 'c3 from other'])
  })

  it('a rejected push says to pull first, and offers nothing else', async () => {
    const work = R('Work')
    const other = R('Other').path
    run(other, 'pull', '-q', '--rebase')
    write(other, 'x', 'x\n'); commit(other, 'remote moves'); run(other, 'push', '-q')
    const r = await act(work, work.path, 'push', { remote: 'origin' })
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/^The remote has commits you don't have - pull first\./)
    await act(work, work.path, 'fetch')
    expect(await act(work, work.path, 'pull', { mode: 'merge' })).toMatchObject({ ok: true })
    expect(await act(work, work.path, 'push', { remote: 'origin' })).toMatchObject({ ok: true })
  })

  it('the first push of a branch sets its upstream', async () => {
    const work = R('Work')
    expect(await act(work, work.path, 'branch', { name: 'feature/one', checkout: true })).toMatchObject({ ok: true })
    const p = await call('git:preview', work, work.path, REG(), 'push', { remote: 'origin' })
    expect(p.details).toMatchObject({ newBranch: true, setUpstream: true, dest: 'feature/one' })
    expect(await call('git:run', work, work.path, REG(), 'push', { remote: 'origin' }, p.stamp)).toMatchObject({ ok: true })
    expect(run(work.path, 'rev-parse', '--abbrev-ref', '@{upstream}').trim()).toBe('origin/feature/one')
    expect(await act(work, work.path, 'checkout', { branch: 'refs/heads/main' })).toMatchObject({ ok: true })
    expect(run(work.path, 'branch', '--show-current').trim()).toBe('main')
  })

  it('refuses a stale preview and changes nothing', async () => {
    const work = R('Work')
    const p = await call('git:preview', work, work.path, REG(), 'branch', { name: 'later' })
    write(work.path, 'terminal', 't\n'); commit(work.path, 'made in a terminal')
    const before = head(work.path)
    expect(await call('git:run', work, work.path, REG(), 'branch', { name: 'later' }, p.stamp)).toEqual({ ok: false, stale: true, detail: 'Changed since the preview. Preview again.' })
    expect(head(work.path)).toBe(before)
    expect(tryRun(work.path, 'rev-parse', '--verify', '--quiet', 'refs/heads/later')).toMatch(/^ERR/)
  })

  it('adds a worktree where devenv would, reusing a local branch, and removes it only when clean', async () => {
    const work = R('Work')
    await act(work, work.path, 'fetch')
    const target = path.join(work.path, 'feature-one')
    // feature/one exists locally (from the push test), so it is reused rather than duplicated.
    expect(await act(work, work.path, 'worktreeAdd', { ref: 'refs/remotes/origin/feature/one', path: target })).toMatchObject({ ok: true })
    expect(run(target, 'branch', '--show-current').trim()).toBe('feature/one')
    expect((await act(work, work.path, 'worktreeAdd', { ref: 'refs/heads/main', path: path.join(root, 'outside') })).previewRefused).toMatch(/inside the repository folder/)
    write(target, 'dirty', 'd\n')
    const refused = await act(work, target, 'worktreeRemove', { path: target })
    expect(refused.ok).toBe(false)
    expect(fs.existsSync(target)).toBe(true)
    fs.rmSync(path.join(target, 'dirty'))
    expect(await act(work, target, 'worktreeRemove', { path: target })).toMatchObject({ ok: true })
    expect(fs.existsSync(target)).toBe(false)
    expect(tryRun(work.path, 'rev-parse', '--verify', 'refs/heads/feature/one')).not.toMatch(/^ERR/)
  })

  it('stashes, applies, pops and drops by commit id', async () => {
    const work = R('Work')
    write(work.path, 'f', 'stashed edit\n')
    expect(await act(work, work.path, 'stashPush', { message: 'first' })).toMatchObject({ ok: true })
    write(work.path, 'f', 'second edit\n')
    expect(await act(work, work.path, 'stashPush', { message: 'second' })).toMatchObject({ ok: true })
    const [second, first] = run(work.path, 'stash', 'list', '--format=%H').split('\n').filter(Boolean)
    expect(await act(work, work.path, 'stashPop', { oid: first })).toMatchObject({ ok: true })
    expect(fs.readFileSync(path.join(work.path, 'f'), 'utf8')).toBe('stashed edit\n')
    expect(run(work.path, 'stash', 'list', '--format=%H').trim()).toBe(second)
    run(work.path, 'checkout', '--', 'f')
    // Dropping by oid still finds `second` after the list shifted.
    const p = await call('git:preview', work, work.path, REG(), 'stashDrop', { oid: second })
    expect(await call('git:run', work, work.path, REG(), 'stashDrop', { oid: second }, p.stamp)).toMatchObject({ ok: true })
    expect(run(work.path, 'stash', 'list')).toBe('')
    expect((await act(work, work.path, 'stashApply', { oid: second })).previewRefused).toBe('That stash no longer exists.')
  })

  it('reverts a commit, and a merge with a chosen parent', async () => {
    const work = R('Work')
    write(work.path, 'r', 'r\n'); commit(work.path, 'to revert')
    expect(await act(work, work.path, 'revert', { oid: head(work.path) })).toMatchObject({ ok: true })
    expect(fs.existsSync(path.join(work.path, 'r'))).toBe(false)
    run(work.path, 'checkout', '-q', '-b', 'side')
    write(work.path, 's', 's\n'); commit(work.path, 'side')
    run(work.path, 'checkout', '-q', 'main')
    run(work.path, 'merge', '-q', '--no-ff', '--no-edit', 'side')
    const merge = head(work.path)
    expect((await act(work, work.path, 'revert', { oid: merge })).previewRefused).toMatch(/which parent/)
    expect(await act(work, work.path, 'revert', { oid: merge, parent: 1 })).toMatchObject({ ok: true })
    expect(fs.existsSync(path.join(work.path, 's'))).toBe(false)
  })

  it('interactive rebase reorders, squashes and rewords with the messages given', async () => {
    const r = R('Rebase')
    fs.mkdirSync(r.path)
    run(r.path, 'init', '-q')
    for (const n of [1, 2, 3, 4]) { write(r.path, `f${n}`, `${n}\n`); commit(r.path, `c${n}`) }
    const [c4, c3, c2, base] = run(r.path, 'rev-list', 'HEAD').split('\n').filter(Boolean)
    const rows = [
      { oid: c3, action: 'pick', message: null },
      { oid: c2, action: 'squash', message: 'c3 and c2' },
      { oid: c4, action: 'reword', message: 'c4 renamed' },
    ]
    expect(await act(r, r.path, 'rebaseInteractive', { base, rows })).toMatchObject({ ok: true })
    expect(subjects(r.path)).toEqual(['c4 renamed', 'c3 and c2', 'c1'])
    expect(fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('nexusmd-rebase-'))).toEqual([])
  })

  it('interactive rebase stops on a conflict, and Continue still applies later rewords', async () => {
    const r = R('Rebase')
    write(r.path, 'shared', 'base\n'); commit(r.path, 'base')
    const base = head(r.path)
    write(r.path, 'shared', 'one\n'); commit(r.path, 'one')
    write(r.path, 'shared', 'two\n'); commit(r.path, 'two')
    write(r.path, 'other', 'x\n'); commit(r.path, 'three')
    const [three, two, one] = run(r.path, 'rev-list', `${base}..HEAD`).split('\n').filter(Boolean)
    // Swapping one and two makes "two" apply onto base: a conflict on `shared`.
    const rows = [{ oid: two, action: 'pick' }, { oid: one, action: 'pick' }, { oid: three, action: 'reword', message: 'three renamed' }]
    const res = await act(r, r.path, 'rebaseInteractive', { base, rows })
    expect(res).toMatchObject({ ok: false, conflict: true, operation: 'Rebase in progress' })
    expect((await act(r, r.path, 'continue')).previewRefused).toMatch(/Resolve and stage/)
    // Resolve every stop the same way: keep "two"'s version of the file.
    for (let i = 0; i < 3; i++) {
      if (!fs.existsSync(path.join(r.path, '.git', 'rebase-merge'))) break
      write(r.path, 'shared', 'two\n')
      run(r.path, 'add', 'shared')
      const c = await act(r, r.path, 'continue')
      if (c.ok) break
    }
    expect(fs.existsSync(path.join(r.path, '.git', 'rebase-merge'))).toBe(false)
    expect(subjects(r.path).slice(0, 1)).toEqual(['three renamed'])
    expect(fs.existsSync(path.join(r.path, '.git', 'nexusmd-rebase-plan'))).toBe(false)
  })

  it('abort undoes a stopped rebase and removes the plan', async () => {
    const r = R('Rebase')
    const base = head(r.path)
    write(r.path, 'shared', 'A\n'); commit(r.path, 'A')
    write(r.path, 'shared', 'B\n'); commit(r.path, 'B')
    const [b, a] = run(r.path, 'rev-list', `${base}..HEAD`).split('\n').filter(Boolean)
    const before = head(r.path)
    const res = await act(r, r.path, 'rebaseInteractive', { base, rows: [{ oid: b, action: 'pick' }, { oid: a, action: 'pick' }] })
    expect(res.conflict).toBe(true)
    expect(fs.existsSync(path.join(r.path, '.git', 'nexusmd-rebase-plan'))).toBe(true)
    expect(await act(r, r.path, 'abort')).toMatchObject({ ok: true })
    expect(head(r.path)).toBe(before)
    expect(fs.existsSync(path.join(r.path, '.git', 'nexusmd-rebase-plan'))).toBe(false)
  })

  it('refuses to rewrite pushed commits or merges', async () => {
    const work = R('Work')
    await act(work, work.path, 'fetch')
    const base = run(work.path, 'rev-parse', 'HEAD~3').trim()
    const range = run(work.path, 'rev-list', '--reverse', `${base}..HEAD`).split('\n').filter(Boolean)
    const r = await act(work, work.path, 'rebaseInteractive', { base, rows: range.map(oid => ({ oid, action: 'pick' })) })
    expect(r.previewRefused).toMatch(/haven't been pushed|without merge commits/)
  })

  it('hooks run, see none of the helper\'s variables, and a rejecting pre-push hook stops the push', async () => {
    const h = R('Hooked')
    run(root, 'clone', '-q', path.join(root, 'remote.git'), 'Hooked')
    const log = path.join(root, 'hook.log')
    fs.writeFileSync(path.join(h.path, '.git', 'hooks', 'post-checkout'), `#!/bin/sh\necho "ERAN=$ELECTRON_RUN_AS_NODE" >> "${log}"\n`, { mode: 0o755 })
    fs.writeFileSync(path.join(h.path, '.git', 'hooks', 'pre-push'), '#!/bin/sh\necho "pushing is off today" >&2\nexit 1\n', { mode: 0o755 })
    const p = await call('git:preview', h, h.path, REG(), 'branch', { name: 'hooked', checkout: true })
    expect(p.programs).toEqual(['post-checkout hook', 'pre-push hook'])
    expect(await call('git:run', h, h.path, REG(), 'branch', { name: 'hooked', checkout: true }, p.stamp)).toMatchObject({ ok: true })
    expect(fs.readFileSync(log, 'utf8').trim()).toBe('ERAN=')
    write(h.path, 'h', 'h\n'); commit(h.path, 'hooked work')
    const r = await act(h, h.path, 'push', { remote: 'origin' })
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/pushing is off today/)
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() !== 0)('a repository another user owns is refused with the safe.directory hint', async () => {
    const o = R('Owned')
    fs.mkdirSync(o.path)
    run(o.path, 'init', '-q')
    execFileSync('chown', ['-R', '65534:65534', o.path])
    const p = await call('git:preview', o, o.path, [...REG(), o.path], 'fetch', {}).catch(e => ({ thrown: e.message }))
    // The worktree list itself already fails under git's ownership check, so nothing runs.
    expect(JSON.stringify(p)).toMatch(/dubious ownership|safe\.directory/)
  })
})
