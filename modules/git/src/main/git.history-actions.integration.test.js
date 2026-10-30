// @vitest-environment node
// History's actions against real git: Reset to here (soft, mixed, hard) and Cherry-pick onto another worktree.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { parseNumstat } from '@nexusmd/core'
import { register } from './git.cjs'

let root
const handlers = {}
const saved = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM }
const run = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
const call = (channel, ...args) => handlers[channel](null, ...args)
const R = name => ({ name, path: path.join(root, name) })
const REG = () => ['Hist', 'Pick'].map(n => path.join(root, n))
const write = (dir, file, text) => fs.writeFileSync(path.join(dir, file), text)
const commit = (dir, msg) => { run(dir, 'add', '-A'); run(dir, 'commit', '-qm', msg) }
const head = dir => run(dir, 'rev-parse', 'HEAD').trim()
const subjects = (dir, range = 'HEAD') => run(dir, 'log', '--format=%s', range).split('\n').filter(Boolean)

async function act(repo, wt, kind, options = {}) {
  const p = await call('git:preview', repo, wt, REG(), kind, options)
  if (!p.eligible) return { previewRefused: p.reason }
  return call('git:run', repo, wt, REG(), kind, options, p.stamp)
}

beforeAll(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-gith-')))
  const globalConfig = path.join(root, 'gitconfig')
  fs.writeFileSync(globalConfig, '[user]\n\tname = Ana\n\temail = ana@example.invalid\n[core]\n\tautocrlf = false\n[init]\n\tdefaultBranch = main\n')
  process.env.GIT_CONFIG_GLOBAL = globalConfig
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  run(root, 'init', '-q', '--bare', 'remote.git')
  for (const name of ['Hist', 'Pick']) {
    const w = R(name).path
    fs.mkdirSync(w)
    run(w, 'init', '-q')
    write(w, 'f', '1\n'); commit(w, 'c1')
  }
  const h = R('Hist').path
  run(h, 'remote', 'add', 'origin', path.join(root, 'remote.git'))
  run(h, 'push', '-q', '-u', 'origin', 'main')

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

describe('history actions against real repositories', { timeout: 180000 }, () => {
  it('reset soft keeps the work staged, mixed keeps it unstaged, and lists what leaves the branch', async () => {
    const h = R('Hist')
    const c1 = head(h.path)
    write(h.path, 'a', 'a\n'); commit(h.path, 'add a')
    write(h.path, 'b', 'b\n'); commit(h.path, 'add b')
    const p = await call('git:preview', h, h.path, REG(), 'reset', { oid: c1, mode: 'soft' })
    expect(p.details).toMatchObject({ mode: 'soft', branch: 'main', subject: 'c1', count: 2, pushed: 0, dirty: false })
    expect(p.details.leaves.map(c => c.subject)).toEqual(['add b', 'add a'])
    expect(await call('git:run', h, h.path, REG(), 'reset', { oid: c1, mode: 'soft' }, p.stamp)).toMatchObject({ ok: true })
    expect(head(h.path)).toBe(c1)
    expect(run(h.path, 'diff', '--cached', '--name-only').split('\n').filter(Boolean)).toEqual(['a', 'b'])
    run(h.path, 'commit', '-qm', 'a and b')

    expect(await act(h, h.path, 'reset', { oid: c1 })).toMatchObject({ ok: true })
    expect(head(h.path)).toBe(c1)
    expect(run(h.path, 'diff', '--cached', '--name-only')).toBe('')
    expect(run(h.path, 'status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean).sort()).toEqual(['?? a', '?? b'])
    commit(h.path, 'a and b again')
  })

  it('reset hard throws away uncommitted changes; pushed commits are counted; a stale preview changes nothing', async () => {
    const h = R('Hist')
    const c1 = run(h.path, 'rev-list', '--max-parents=0', 'HEAD').trim()
    run(h.path, 'push', '-q')
    write(h.path, 'f', 'dirty\n')
    let p = await call('git:preview', h, h.path, REG(), 'reset', { oid: c1, mode: 'hard' })
    expect(p.reason).toBeNull()
    expect(p.details).toMatchObject({ mode: 'hard', count: 1, pushed: 1, dirty: true, lost: ['f'] })
    // An already-modified file edited again after the preview: status is unchanged, but it is refused as stale.
    write(h.path, 'f', 'dirtier\n')
    expect(await call('git:run', h, h.path, REG(), 'reset', { oid: c1, mode: 'hard' }, p.stamp)).toMatchObject({ ok: false, stale: true })
    expect(fs.readFileSync(path.join(h.path, 'f'), 'utf8')).toBe('dirtier\n')
    // So is a status change (staging it). A staged new file is listed too; an untracked one isn't touched.
    p = await call('git:preview', h, h.path, REG(), 'reset', { oid: c1, mode: 'hard' })
    run(h.path, 'add', 'f')
    expect(await call('git:run', h, h.path, REG(), 'reset', { oid: c1, mode: 'hard' }, p.stamp)).toMatchObject({ ok: false, stale: true })
    write(h.path, 'staged-new', 's\n'); run(h.path, 'add', 'staged-new'); write(h.path, 'untracked', 'u\n')
    expect((await call('git:preview', h, h.path, REG(), 'reset', { oid: c1, mode: 'hard' })).details.lost).toEqual(['f', 'staged-new'])
    expect((await call('git:preview', h, h.path, REG(), 'reset', { oid: c1, mode: 'mixed' })).details.lost).toEqual([])
    p = await call('git:preview', h, h.path, REG(), 'reset', { oid: c1, mode: 'hard' })
    expect(await call('git:run', h, h.path, REG(), 'reset', { oid: c1, mode: 'hard' }, p.stamp)).toMatchObject({ ok: true })
    expect(head(h.path)).toBe(c1)
    expect(fs.readFileSync(path.join(h.path, 'f'), 'utf8')).toBe('1\n')
    expect(fs.existsSync(path.join(h.path, 'a'))).toBe(false)
    expect(fs.existsSync(path.join(h.path, 'staged-new'))).toBe(false)
    expect(fs.readFileSync(path.join(h.path, 'untracked'), 'utf8')).toBe('u\n')
    fs.rmSync(path.join(h.path, 'untracked'))
    run(h.path, 'reset', '-q', '--hard', 'origin/main')
  })

  it('reset refuses HEAD itself, commits off the branch, and unknown modes', async () => {
    const h = R('Hist')
    expect((await act(h, h.path, 'reset', { oid: head(h.path) })).previewRefused).toBe('main is already at that commit.')
    run(h.path, 'checkout', '-qb', 'off')
    write(h.path, 'off', 'o\n'); commit(h.path, 'off the branch')
    const off = head(h.path)
    run(h.path, 'checkout', '-q', 'main')
    expect((await act(h, h.path, 'reset', { oid: off })).previewRefused).toBe('Reset only moves main back to one of its own commits.')
    const c1 = run(h.path, 'rev-list', '--max-parents=0', 'HEAD').trim()
    expect((await act(h, h.path, 'reset', { oid: c1, mode: 'keep' })).previewRefused).toMatch(/Unknown reset mode/)
    expect(head(h.path)).not.toBe(c1)
  })

  it('cherry-picks onto another worktree with -x, warns of overlap, and stops on a conflict', async () => {
    const p = R('Pick')
    const target = path.join(p.path, 'feature')
    run(p.path, 'worktree', 'add', '-q', '-b', 'feature', target)
    fs.appendFileSync(path.join(p.path, '.git', 'info', 'exclude'), '/feature/\n')
    write(p.path, 'new', 'n\n'); commit(p.path, 'pick me')
    const pick = head(p.path)
    // The detail panel's line counts come with the file list.
    const listed = await call('git:commitFiles', p, p.path, REG(), pick, run(p.path, 'rev-parse', 'HEAD~1').trim())
    expect([...parseNumstat(listed.numstat)]).toEqual([['new', { added: 1, removed: 0 }]])
    const preview = await call('git:preview', p, target, REG(), 'cherryPick', { oid: pick, x: true })
    expect(preview.details).toMatchObject({ branch: 'feature', subject: 'pick me', files: 1, overlap: [], x: true })
    expect(await call('git:run', p, target, REG(), 'cherryPick', { oid: pick, x: true }, preview.stamp)).toMatchObject({ ok: true })
    expect(subjects(target)[0]).toBe('pick me')
    expect(run(target, 'log', '-1', '--format=%B')).toContain(`(cherry picked from commit ${pick})`)
    expect(head(p.path)).toBe(pick)

    const c1 = run(p.path, 'rev-list', '--max-parents=0', 'HEAD').trim()
    expect((await act(p, target, 'cherryPick', { oid: c1 })).previewRefused).toBe('feature already has that commit.')

    write(target, 'f', 'feature\n'); commit(target, 'feature edits f')
    write(p.path, 'f', 'main\n'); commit(p.path, 'main edits f')
    const clash = head(p.path)
    const q = await call('git:preview', p, target, REG(), 'cherryPick', { oid: clash })
    expect(q.details.overlap).toEqual(['f'])
    expect(await call('git:run', p, target, REG(), 'cherryPick', { oid: clash }, q.stamp)).toMatchObject({ ok: false, conflict: true, operation: 'Cherry-pick in progress' })
    expect((await act(p, target, 'cherryPick', { oid: clash })).previewRefused).toMatch(/Cherry-pick in progress/)
    expect(await act(p, target, 'abort')).toMatchObject({ ok: true })
    expect(subjects(target)[0]).toBe('feature edits f')

    write(target, 'f', 'dirty\n')
    expect((await act(p, target, 'cherryPick', { oid: clash })).previewRefused).toBe('Cherry-pick needs a clean worktree - stash first.')
  })

  it('resets to the upstream as last fetched, throwing away local commits and tracked changes but not untracked files', async () => {
    const h = R('Hist')
    run(h.path, 'reset', '-q', '--hard', 'origin/main')
    expect((await act(h, h.path, 'resetUpstream')).previewRefused).toBe('main already matches origin/main.')
    write(h.path, 'up', 'u\n'); commit(h.path, 'on the remote')
    run(h.path, 'push', '-q', 'origin', 'main')
    const upstream = head(h.path)
    run(h.path, 'reset', '-q', '--hard', 'HEAD~1')
    write(h.path, 'mine', 'm\n'); commit(h.path, 'local only')
    write(h.path, 'f', 'edited\n')
    write(h.path, 'loose', 'l\n')

    const p = await call('git:preview', h, h.path, REG(), 'resetUpstream', {})
    expect(p.details).toMatchObject({ oid: upstream, upstream: 'origin/main', branch: 'main', incoming: 1, lost: ['f'] })
    expect(p.details.leaves.map(c => c.subject)).toEqual(['local only'])
    write(h.path, 'f', 'edited again\n')
    expect(await call('git:run', h, h.path, REG(), 'resetUpstream', {}, p.stamp)).toMatchObject({ ok: false, stale: true })

    expect(await act(h, h.path, 'resetUpstream')).toMatchObject({ ok: true })
    expect(head(h.path)).toBe(upstream)
    expect(fs.readFileSync(path.join(h.path, 'f'), 'utf8')).toBe('1\n')
    expect(fs.existsSync(path.join(h.path, 'mine'))).toBe(false)
    expect(fs.readFileSync(path.join(h.path, 'loose'), 'utf8')).toBe('l\n')
    fs.rmSync(path.join(h.path, 'loose'))
  })

  it('deletes a branch with its worktree, keeping the remote branch; not the main folder\'s branch, nor one with changes', async () => {
    const h = R('Hist')
    expect((await act(h, h.path, 'branchDelete')).previewRefused).toBe("main is checked out in the repository's main folder. Switch that folder to another branch first.")
    const target = path.join(h.path, 'gone')
    run(h.path, 'worktree', 'add', '-q', '-b', 'gone', target)
    write(target, 'pushed', 'p\n'); commit(target, 'pushed already')
    run(target, 'push', '-q', '-u', 'origin', 'gone')
    write(target, 'only', 'o\n'); commit(target, 'only here')
    write(target, 'stray', 's\n')
    expect((await act(h, target, 'branchDelete')).previewRefused).toMatch(/uncommitted or untracked files/)
    fs.rmSync(path.join(target, 'stray'))

    const p = await call('git:preview', h, target, REG(), 'branchDelete', {})
    expect(p.details).toMatchObject({ branch: 'gone', upstream: 'origin/gone' })
    expect(p.details.lost.map(c => c.subject)).toEqual(['only here'])
    expect(await call('git:run', h, target, REG(), 'branchDelete', {}, p.stamp)).toMatchObject({ ok: true })
    expect(fs.existsSync(target)).toBe(false)
    expect(run(h.path, 'branch', '--list', 'gone').trim()).toBe('')
    expect(run(h.path, 'ls-remote', '--heads', 'origin', 'gone')).toMatch(/refs\/heads\/gone/)
  })
})
