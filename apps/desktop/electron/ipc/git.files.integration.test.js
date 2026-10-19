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
const call = (channel, ...args) => handlers[channel](null, ...args)
const repo = { name: 'Work', path: null }
const REG = () => [repo.path]
const disk = file => path.join(repo.path, file)
const read = file => call('git:readFile', repo, repo.path, REG(), file)
const save = (file, text, options) => call('git:writeFile', repo, repo.path, REG(), file, text, options)

beforeAll(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-gitf-')))
  const globalConfig = path.join(root, 'gitconfig')
  fs.writeFileSync(globalConfig, '[user]\n\tname = Test\n\temail = test@example.invalid\n[core]\n\tautocrlf = false\n')
  process.env.GIT_CONFIG_GLOBAL = globalConfig
  process.env.GIT_CONFIG_NOSYSTEM = '1'

  repo.path = path.join(root, 'Work')
  fs.mkdirSync(repo.path)
  run(repo.path, 'init', '-b', 'main')
  fs.writeFileSync(disk('.gitignore'), '*.log\n')
  fs.writeFileSync(disk('story.txt'), 'one\ntwo\n')
  run(repo.path, 'add', '.')
  run(repo.path, 'commit', '-m', 'Initial')
  fs.writeFileSync(disk('new.txt'), 'untracked\n')
  fs.writeFileSync(disk('ignored.log'), 'noise\n')

  register({ handle: (channel, fn) => { handlers[channel] = fn } }, { logger: { scope: () => ({ error: () => {}, info: () => {} }) } })
}, 60000)

afterAll(() => {
  if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved.global
  if (saved.nosystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = saved.nosystem
  fs.rmSync(root, { recursive: true, force: true })
})

// Real git on Windows starts a process per command, so a test can take well over the 5 s default.
describe('git workspace file editor against a real repository', { timeout: 60000 }, () => {
  it('lists tracked and untracked files but not ignored ones', async () => {
    const { files, truncated } = await call('git:files', repo, repo.path, REG())
    expect(files).toContain('story.txt')
    expect(files).toContain('new.txt')
    expect(files).not.toContain('ignored.log')
    expect(truncated).toBe(false)
  })

  it('reads a file with its stamp', async () => {
    expect(await read('story.txt')).toEqual({ text: 'one\ntwo\n', bom: false, stamp: expect.stringMatching(/^[0-9a-f]{64}$/) })
  })

  it('writes with the expected stamp and returns the new one', async () => {
    const { stamp } = await read('story.txt')
    const r = await save('story.txt', 'one\ntwo\nthree\n', { expectedStamp: stamp })
    expect(r.ok).toBe(true)
    expect(fs.readFileSync(disk('story.txt'), 'utf8')).toBe('one\ntwo\nthree\n')
    expect(r.stamp).toBe((await read('story.txt')).stamp)
  })

  it('refuses a stale write unless overwrite is set', async () => {
    const { stamp } = await read('story.txt')
    fs.writeFileSync(disk('story.txt'), 'edited elsewhere\n')
    const r = await save('story.txt', 'mine\n', { expectedStamp: stamp })
    expect(r).toMatchObject({ ok: false, conflict: true })
    expect(fs.readFileSync(disk('story.txt'), 'utf8')).toBe('edited elsewhere\n')
    expect(await save('story.txt', 'mine\n', { expectedStamp: stamp, overwrite: true })).toMatchObject({ ok: true })
    expect(fs.readFileSync(disk('story.txt'), 'utf8')).toBe('mine\n')
  })

  it('keeps CRLF and a BOM', async () => {
    const { stamp } = await read('new.txt')
    await save('new.txt', 'a\r\nb\r\n', { expectedStamp: stamp, bom: true })
    const bytes = fs.readFileSync(disk('new.txt'))
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(bytes.subarray(3).toString()).toBe('a\r\nb\r\n')
    expect(await read('new.txt')).toMatchObject({ text: 'a\r\nb\r\n', bom: true })
  })

  it('refuses binary and oversized files, saying why', async () => {
    fs.writeFileSync(disk('bin.dat'), Buffer.from([1, 0, 2]))
    fs.writeFileSync(disk('big.txt'), 'x'.repeat(1024 * 1024 + 1))
    await expect(read('bin.dat')).rejects.toThrow(/isn't a text file/)
    await expect(read('big.txt')).rejects.toThrow(/too large/)
  })

  it('refuses paths outside the worktree or inside .git', async () => {
    const config = fs.readFileSync(path.join(repo.path, '.git', 'config'), 'utf8')
    fs.mkdirSync(disk('sub'), { recursive: true })
    const rels = ['../x', 'C:\\x', '.git/config', '.GIT/HEAD', 'sub/../.git/config', '//host/share/x']
    if (process.platform === 'win32') rels.push('.git\\config', 'sub\\..\\.git\\HEAD', 'GIT~1/config', '\\\\host\\share\\x')
    for (const rel of rels) {
      await expect(read(rel), rel).rejects.toThrow(/Not a worktree file|Invalid file path/)
      await expect(save(rel, 'boom', { expectedStamp: 'x', overwrite: true }), rel).rejects.toThrow(/Not a worktree file|Invalid file path/)
    }
    expect(fs.existsSync(path.join(root, 'x'))).toBe(false)
    expect(fs.readFileSync(path.join(repo.path, '.git', 'config'), 'utf8')).toBe(config)
  })

  it('refuses a link that leads into .git, and a nested .git folder', async () => {
    const config = fs.readFileSync(path.join(repo.path, '.git', 'config'), 'utf8')
    try { fs.symlinkSync(path.join(repo.path, '.git'), disk('gitlink'), 'junction') } catch { return }
    await expect(read('gitlink/config')).rejects.toThrow(/Not a worktree file/)
    await expect(save('gitlink/config', 'boom', { overwrite: true })).rejects.toThrow(/Not a worktree file/)
    fs.mkdirSync(disk('nested/.git'), { recursive: true })
    fs.writeFileSync(disk('nested/.git/config'), 'x')
    await expect(read('nested/.git/config')).rejects.toThrow(/Not a worktree file/)
    expect(fs.readFileSync(path.join(repo.path, '.git', 'config'), 'utf8')).toBe(config)
    fs.rmSync(disk('gitlink'), { recursive: true, force: true })
  })

  it('does not overwrite a binary or oversized file', async () => {
    fs.writeFileSync(disk('bin2.dat'), Buffer.from([1, 0, 2]))
    fs.writeFileSync(disk('big2.txt'), 'x'.repeat(1024 * 1024 + 1))
    await expect(save('bin2.dat', 'text', { overwrite: true })).rejects.toThrow(/isn't a text file/)
    await expect(save('big2.txt', 'text', { overwrite: true })).rejects.toThrow(/too large/)
    expect([...fs.readFileSync(disk('bin2.dat'))]).toEqual([1, 0, 2])
  })

  it("refuses a missing file and a file that isn't registered", async () => {
    expect(await save('nope.txt', 'x', { expectedStamp: 'x' })).toEqual({ ok: false, missing: true })
    expect(fs.existsSync(disk('nope.txt'))).toBe(false)
    await expect(call('git:readFile', repo, repo.path, [path.join(root, 'Other')], 'story.txt')).rejects.toThrow('Not a registered repository')
  })
})
