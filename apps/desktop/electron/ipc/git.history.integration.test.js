// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { parseLog, parseNameStatus, parseCommitDetails, parseRefList, parseDiff } from '@nexusmd/core'
import { register } from './git.cjs'

let root
const handlers = {}
const saved = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM }
const run = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
const call = (channel, ...args) => handlers[channel](null, ...args)
const repo = name => ({ name, path: path.join(root, name) })
const REG = () => ['Work', 'Layout'].map(n => path.join(root, n))
const write = (r, file, text) => fs.writeFileSync(path.join(r.path, file), text)
const commit = (r, msg) => { run(r.path, 'add', '-A'); run(r.path, 'commit', '-qm', msg) }
const q = over => ({ ref: 'HEAD', filter: 'all', base: null, search: null, limit: 200, ...over })
const subjects = async (r, cwd, query) => parseLog((await call('git:log', r, cwd, REG(), query)).text).filter(x => x.commit).map(x => x.commit.subject)

beforeAll(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-gith-')))
  const globalConfig = path.join(root, 'gitconfig')
  fs.writeFileSync(globalConfig, '[user]\n\tname = Ana Ñ\n\temail = ana@example.invalid\n[core]\n\tautocrlf = false\n')
  process.env.GIT_CONFIG_GLOBAL = globalConfig
  process.env.GIT_CONFIG_NOSYSTEM = '1'

  run(root, 'init', '-q', '-b', 'main', '--bare', 'remote.git')
  const w = repo('Work')
  fs.mkdirSync(w.path)
  run(w.path, 'init', '-q', '-b', 'main')
  write(w, 'f', '1\n'); commit(w, 'c1 a.b')
  write(w, 'f', '2\n'); commit(w, 'c2 a.b')
  write(w, 'g', 'x\n'); commit(w, 'axb')
  run(w.path, 'remote', 'add', 'origin', path.join(root, 'remote.git'))
  run(w.path, 'push', '-q', 'origin', 'HEAD:main')
  run(w.path, 'fetch', '-q', 'origin')
  write(w, 'f', '3\n'); commit(w, 'c3 [x] ünïcode')
  run(w.path, 'tag', 'v1', 'HEAD~1')
  run(w.path, 'checkout', '-q', '-b', 'side', 'HEAD~1')
  write(w, 's', 's\n'); commit(w, 'side')
  run(w.path, 'checkout', '-q', 'main')
  run(w.path, 'merge', '-q', '--no-ff', 'side', '-m', 'Merge side')
  run(w.path, 'branch', 'doomed')
  // A repo-level request to verify signatures with a "gpg" that leaves a marker if it ever runs.
  const gpg = path.join(root, 'fake-gpg.sh')
  fs.writeFileSync(gpg, `#!/bin/sh\necho ran > "${path.join(root, 'gpg-ran')}"\nexit 1\n`)
  fs.chmodSync(gpg, 0o755)
  run(w.path, 'config', 'log.showSignature', 'true')
  run(w.path, 'config', 'gpg.program', gpg)

  // A .bare layout: the repository's only worktree entry is the bare one.
  const layout = repo('Layout')
  fs.mkdirSync(layout.path)
  run(layout.path, 'clone', '-q', '--bare', w.path, '.bare')
  fs.writeFileSync(path.join(layout.path, '.git'), 'gitdir: ./.bare\n')

  register({ handle: (channel, fn) => { handlers[channel] = fn } }, { logger: { scope: () => ({ error: () => {}, info: () => {} }) } })
}, 60000)

afterAll(() => {
  if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved.global
  if (saved.nosystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = saved.nosystem
  fs.rmSync(root, { recursive: true, force: true })
})

describe('git workspace history against real repositories', () => {
  it('lists the whole history in topo order with parsed refs', async () => {
    const w = repo('Work')
    const r = await call('git:log', w, w.path, REG(), q())
    const rows = parseLog(r.text).filter(x => x.commit).map(x => x.commit)
    expect(rows.map(c => c.subject)).toEqual(['Merge side', 'side', 'c3 [x] ünïcode', 'axb', 'c2 a.b', 'c1 a.b'])
    expect(rows[0].refs).toEqual(expect.arrayContaining([{ kind: 'head', name: 'HEAD' }, { kind: 'branch', name: 'main' }, { kind: 'branch', name: 'doomed' }]))
    expect(rows[3].refs).toEqual(expect.arrayContaining([{ kind: 'tag', name: 'v1' }, { kind: 'remote', name: 'origin/main' }]))
    expect(r.tip).toBe(run(w.path, 'rev-parse', 'HEAD').trim())
    expect(r.truncated).toBe(false)
  })

  it('unpushed lists exactly the commits no remote has, and marks them', async () => {
    const w = repo('Work')
    expect(await subjects(w, w.path, q({ filter: 'unpushed' }))).toEqual(['Merge side', 'side', 'c3 [x] ünïcode'])
    const r = await call('git:log', w, w.path, REG(), q())
    const expected = run(w.path, 'rev-list', 'HEAD', '--not', '--remotes').split('\n').filter(Boolean)
    expect([...r.unpushed].sort()).toEqual(expected.sort())
  })

  it('since base matches git log base..ref', async () => {
    const w = repo('Work')
    const r = await call('git:log', w, w.path, REG(), q({ filter: 'sinceBase', base: 'refs/remotes/origin/main' }))
    const oids = parseLog(r.text).filter(x => x.commit).map(x => x.commit.oid)
    expect(oids.sort()).toEqual(run(w.path, 'rev-list', 'origin/main..HEAD').split('\n').filter(Boolean).sort())
  })

  it('matches search text literally', async () => {
    const w = repo('Work')
    expect(await subjects(w, w.path, q({ search: { kind: 'message', text: '[x]' } }))).toEqual(['c3 [x] ünïcode'])
    expect(await subjects(w, w.path, q({ search: { kind: 'message', text: 'a.b' } }))).toEqual(['c2 a.b', 'c1 a.b'])
    expect(await subjects(w, w.path, q({ search: { kind: 'message', text: '--all' } }))).toEqual([])
    // Case folding is ASCII-only: every git call runs under LC_ALL=C (stage 1), so 'ñ' doesn't find 'Ñ'.
    expect(await subjects(w, w.path, q({ search: { kind: 'author', text: 'Ñ' } }))).toHaveLength(6)
    expect(await subjects(w, w.path, q({ search: { kind: 'author', text: 'ANA' } }))).toHaveLength(6)
    // Git's default history simplification applies, exactly as `git log -- s` in a terminal.
    expect(await subjects(w, w.path, q({ search: { kind: 'path', text: 's' } }))).toEqual(run(w.path, 'log', '--format=%s', '--', 's').split('\n').filter(Boolean))
    expect(await subjects(w, w.path, q({ search: { kind: 'path', text: 's' } }))).toEqual(['side'])
  })

  it('shows a branch that is not checked out', async () => {
    const w = repo('Work')
    expect(await subjects(w, w.path, q({ ref: 'refs/heads/side' }))).toEqual(['side', 'axb', 'c2 a.b', 'c1 a.b'])
  })

  it('compares a merge with either parent', async () => {
    const w = repo('Work')
    const head = run(w.path, 'rev-parse', 'HEAD').trim()
    const d = parseCommitDetails((await call('git:commitDetails', w, w.path, REG(), head)).details)
    expect(d.parents).toHaveLength(2)
    expect(d.message).toBe('Merge side')
    const vs1 = parseNameStatus((await call('git:commitFiles', w, w.path, REG(), head, d.parents[0])).files)
    const vs2 = parseNameStatus((await call('git:commitFiles', w, w.path, REG(), head, d.parents[1])).files)
    expect(vs1).toEqual([{ status: 'A', score: null, oldPath: null, path: 's' }])
    expect(vs2).toEqual([{ status: 'M', score: null, oldPath: null, path: 'f' }])
    await expect(call('git:commitFiles', w, w.path, REG(), head, head)).rejects.toThrow('Not a parent of that commit')
  })

  it('diffs a root commit as all added', async () => {
    const w = repo('Work')
    const rootOid = run(w.path, 'rev-list', '--max-parents=0', 'HEAD').trim()
    expect(parseNameStatus((await call('git:commitFiles', w, w.path, REG(), rootOid, null)).files)).toEqual([{ status: 'A', score: null, oldPath: null, path: 'f' }])
    const d = await call('git:commitDiff', w, w.path, REG(), rootOid, null, ['f'])
    const file = parseDiff(d.text).files[0]
    expect(file.status).toBe('added')
    expect(file.hunks[0].lines.map(l => l.kind)).toEqual(['add'])
  })

  it('reads branch history from a .bare layout\'s bare entry', async () => {
    const l = repo('Layout')
    const bare = path.join(l.path, '.bare')
    const refs = parseRefList((await call('git:refs', l, bare, REG())).refs).map(r => r.ref)
    expect(refs).toContain('refs/heads/side')
    expect(await subjects(l, bare, q({ ref: 'refs/heads/side' }))).toEqual(['side', 'axb', 'c2 a.b', 'c1 a.b'])
  })

  it('never runs gpg, even when the repository asks for signatures', () => {
    expect(fs.existsSync(path.join(root, 'gpg-ran'))).toBe(false)
  })

  it('refuses a branch deleted after the refs were read', async () => {
    const w = repo('Work')
    const refs = parseRefList((await call('git:refs', w, w.path, REG())).refs).map(r => r.ref)
    expect(refs).toContain('refs/heads/doomed')
    run(w.path, 'branch', '-D', 'doomed')
    await expect(call('git:log', w, w.path, REG(), q({ ref: 'refs/heads/doomed' }))).rejects.toThrow('That branch no longer exists.')
  })

  it('reports the remote HEAD and shallowness', async () => {
    const w = repo('Work')
    // git 2.48+ records origin/HEAD on fetch; older git doesn't, so set it either way.
    run(w.path, 'update-ref', '--no-deref', '-d', 'refs/remotes/origin/HEAD')
    expect(await call('git:refs', w, w.path, REG())).toMatchObject({ originHead: null, shallow: false })
    run(w.path, 'remote', 'set-head', 'origin', 'main')
    expect(await call('git:refs', w, w.path, REG())).toMatchObject({ originHead: 'refs/remotes/origin/main', shallow: false })
  })
})
