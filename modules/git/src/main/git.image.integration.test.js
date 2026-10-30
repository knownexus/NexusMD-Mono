// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { register } from './git.cjs'

let root
// The repository is built once into `template`; each test reads its own copy.
let template
let copies = 0
const handlers = {}
const saved = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM }
const run = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
const call = (channel, ...args) => handlers[channel](null, ...args)
const repo = { name: 'Work', path: null }
const REG = () => [repo.path]
const disk = file => path.join(repo.path, file)
const image = (rel, side) => call('git:readImage', repo, repo.path, REG(), rel, side)
// Not decodable pictures: the handler only moves bytes, so any distinct bytes will do.
const bytes = tag => Buffer.from(`\x89PNG fake ${tag}`, 'latin1')
const dataOf = r => Buffer.from(r.url.split(',')[1], 'base64')

beforeAll(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-gitimg-')))
  const globalConfig = path.join(root, 'gitconfig')
  fs.writeFileSync(globalConfig, '[user]\n\tname = Test\n\temail = test@example.invalid\n[core]\n\tautocrlf = false\n')
  process.env.GIT_CONFIG_GLOBAL = globalConfig
  process.env.GIT_CONFIG_NOSYSTEM = '1'

  repo.path = template = path.join(root, 'Work')
  fs.mkdirSync(repo.path)
  run(repo.path, 'init', '-b', 'main')
  fs.mkdirSync(disk('img'))
  fs.writeFileSync(disk('img/logo.png'), bytes('head'))
  fs.writeFileSync(disk('notes.txt'), 'text\n')
  fs.writeFileSync(disk('big.png'), Buffer.alloc(10 * 1024 * 1024 + 1))
  run(repo.path, 'add', '.')
  run(repo.path, 'commit', '-m', 'Initial')
  // The index now differs from HEAD, and the working tree from the index.
  fs.writeFileSync(disk('img/logo.png'), bytes('index'))
  run(repo.path, 'add', 'img/logo.png')
  fs.writeFileSync(disk('img/logo.png'), bytes('working'))
  fs.writeFileSync(disk('new.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')

  register({ handle: (channel, fn) => { handlers[channel] = fn } }, { logger: { scope: () => ({ error: () => {}, info: () => {} }) } })
})

afterAll(() => {
  if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved.global
  if (saved.nosystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = saved.nosystem
  fs.rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  repo.path = path.join(root, `Work${++copies}`)
  fs.cpSync(template, repo.path, { recursive: true })
})

describe('git workspace image reads against a real repository', () => {
  it('reads the working tree, index and HEAD versions as data URLs', async () => {
    const working = await image('img/logo.png', 'working')
    expect(working).toMatchObject({ mime: 'image/png', size: bytes('working').length })
    expect(working.url).toMatch(/^data:image\/png;base64,/)
    expect(dataOf(working)).toEqual(bytes('working'))
    expect(dataOf(await image('img/logo.png', 'index'))).toEqual(bytes('index'))
    expect(dataOf(await image('img/logo.png', 'head'))).toEqual(bytes('head'))
  })

  it('types by extension, including an untracked SVG', async () => {
    const svg = await image('new.svg', 'working')
    expect(svg.mime).toBe('image/svg+xml')
    expect(dataOf(svg).toString()).toContain('<svg')
  })

  it('says a side is missing rather than failing', async () => {
    expect(await image('new.svg', 'head')).toEqual({ missing: true })
    expect(await image('new.svg', 'index')).toEqual({ missing: true })
    expect(await image('img/gone.png', 'working')).toEqual({ missing: true })
  })

  it('refuses non-images, unknown sides, oversize files, and anything outside the worktree', async () => {
    await expect(image('notes.txt', 'working')).rejects.toThrow("isn't an image type")
    await expect(image('img/logo.png', 'stash')).rejects.toThrow('Unknown image side')
    await expect(image('big.png', 'working')).rejects.toThrow('too large')
    await expect(image('big.png', 'head')).rejects.toThrow('too large')
    await expect(image('../Outside/logo.png', 'working')).rejects.toThrow('Invalid file path')
    await expect(image('.git/x.png', 'working')).rejects.toThrow('Not a worktree file')
    await expect(call('git:readImage', repo, repo.path, [path.join(root, 'Other')], 'img/logo.png', 'working')).rejects.toThrow('Not a registered repository')
  })
})
