// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn as nodeSpawn, execFileSync } from 'child_process'
import { register } from './git.cjs'

// Reviewing, staging and unstaging a file first reads the state of just those files. That read must
// not scan the whole repository for untracked files: in a repo with tens of thousands of them it
// turned every click into seconds, to look at one tracked file.
let root
const handlers = {}
let spawned = []
const saved = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM }
const run = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
const call = (channel, ...args) => handlers[channel](null, ...args)
const spy = (exe, args, opts) => { spawned.push(args); return nodeSpawn(exe, args, opts) }
const repo = { name: 'Big' }
const REG = () => [repo.path]
const stamp = paths => call('git:stamp', repo, repo.path, REG(), { kind: 'files', paths })
// A status that lists untracked files for the whole repository (no pathspec after the flags).
const scansWholeRepo = a => a.includes('status') && a.includes('--untracked-files=all') && !a.includes('--')

beforeAll(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-scan-')))
  const globalConfig = path.join(root, 'gitconfig')
  fs.writeFileSync(globalConfig, '[user]\n\tname = Test\n\temail = test@example.invalid\n[core]\n\tautocrlf = false\n')
  process.env.GIT_CONFIG_GLOBAL = globalConfig
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  repo.path = path.join(root, 'Big')
  fs.mkdirSync(repo.path)
  run(repo.path, 'init', '-b', 'main')
  fs.writeFileSync(path.join(repo.path, 'a.txt'), 'one\n')
  fs.writeFileSync(path.join(repo.path, 'b.txt'), 'one\n')
  fs.writeFileSync(path.join(repo.path, 'old name.txt'), 'content that is long enough to be detected as a rename\n'.repeat(5))
  run(repo.path, 'add', '.')
  run(repo.path, 'commit', '-m', 'Initial')
  fs.mkdirSync(path.join(repo.path, 'out'))
  for (let i = 0; i < 200; i++) fs.writeFileSync(path.join(repo.path, 'out', `g${i}.js`), 'x\n')
  register({ handle: (channel, fn) => { handlers[channel] = fn } }, { spawn: spy, logger: { scope: () => ({ error: () => {}, info: () => {} }) } })
}, 60000)

afterAll(() => {
  if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved.global
  if (saved.nosystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = saved.nosystem
  fs.rmSync(root, { recursive: true, force: true })
})

beforeEach(() => { spawned = [] })

describe('reading the state of the files being reviewed or written', () => {
  it('does not scan the whole repository for untracked files when the files are tracked', async () => {
    fs.appendFileSync(path.join(repo.path, 'a.txt'), 'two\n')
    await stamp(['a.txt'])
    expect(spawned.some(scansWholeRepo)).toBe(false)
  })

  it('gives a tracked file the same stamp however many untracked files sit elsewhere', async () => {
    const before = await stamp(['a.txt'])
    fs.writeFileSync(path.join(repo.path, 'out', 'another.js'), 'y\n')
    expect(await stamp(['a.txt'])).toBe(before)
  })

  it('changes the stamp when the tracked file itself changes', async () => {
    const before = await stamp(['b.txt'])
    fs.appendFileSync(path.join(repo.path, 'b.txt'), 'edited\n')
    expect(await stamp(['b.txt'])).not.toBe(before)
  })

  it('still sees an untracked file, scanning only that path', async () => {
    const file = path.join(repo.path, 'fresh.txt')
    fs.writeFileSync(file, 'new\n')
    const before = await stamp(['fresh.txt'])
    expect(spawned.some(scansWholeRepo)).toBe(false)
    expect(spawned.some(a => a.includes('status') && a.includes('--untracked-files=all') && a.includes('fresh.txt'))).toBe(true)
    fs.appendFileSync(file, 'more\n')
    expect(await stamp(['fresh.txt'])).not.toBe(before)
  })

  it('treats the same status records as before for a staged rename, from either name', async () => {
    run(repo.path, 'mv', 'old name.txt', 'new name.txt')
    const viaNew = await stamp(['new name.txt'])
    const viaOld = await stamp(['old name.txt'])
    expect(viaNew).toMatch(/^[0-9a-f]{64}$/)
    expect(viaOld).toMatch(/^[0-9a-f]{64}$/)
    // Renaming back must change what both names report.
    run(repo.path, 'mv', 'new name.txt', 'old name.txt')
    expect(await stamp(['new name.txt'])).not.toBe(viaNew)
  })
})
