// @vitest-environment node
// The pure parts of the source-branch module: reading config text and refs from disk.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'

const { readConfigSource, readRefOid, defaultBranch } = createRequire(import.meta.url)('./git-source.cjs')

describe('readConfigSource', () => {
  const text = [
    '[core]', '\tbare = false',
    '[branch "other"]', '\tnexusBase = refs/heads/nope',
    '[branch "feat/x"]', '\tremote = origin', '\tnexusBase = refs/heads/main',
    '[branch "quoted"]', '\tnexusBase = "refs/remotes/origin/main"',
    '[BRANCH "mixed"]', '\tNexusBase = refs/heads/dev',
  ].join('\r\n')

  it('finds nexusBase under the branch section, quoted or not, in any key casing', () => {
    expect(readConfigSource(text, 'feat/x')).toBe('refs/heads/main')
    expect(readConfigSource(text, 'quoted')).toBe('refs/remotes/origin/main')
    expect(readConfigSource(text, 'mixed')).toBe('refs/heads/dev')
  })

  it('does not read another branch section, and matches the branch name exactly', () => {
    expect(readConfigSource(text, 'missing')).toBeNull()
    expect(readConfigSource(text, 'Feat/x')).toBeNull()
    expect(readConfigSource('[branch "a"]\n\tremote = origin\n[branch "b"]\n\tnexusBase = refs/heads/x', 'a')).toBeNull()
  })
})

describe('readRefOid and defaultBranch', () => {
  let dir
  const A = 'a'.repeat(40)
  const B = 'b'.repeat(40)
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-src-'))
    fs.mkdirSync(path.join(dir, 'refs', 'heads'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'refs', 'remotes', 'origin'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'refs', 'heads', 'loose'), A + '\n')
    fs.writeFileSync(path.join(dir, 'packed-refs'), `# pack-refs\r\n${B} refs/heads/packed\r\n^${A}\r\n`)
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('reads a loose ref, a packed ref, and null for a missing one', () => {
    expect(readRefOid(dir, 'refs/heads/loose')).toBe(A)
    expect(readRefOid(dir, 'refs/heads/packed')).toBe(B)
    expect(readRefOid(dir, 'refs/heads/none')).toBeNull()
  })

  it('picks origin/HEAD, else main, else master, else null', () => {
    expect(defaultBranch(dir)).toBeNull()
    fs.writeFileSync(path.join(dir, 'refs', 'heads', 'master'), A)
    expect(defaultBranch(dir)).toBe('master')
    fs.writeFileSync(path.join(dir, 'refs', 'heads', 'main'), A)
    expect(defaultBranch(dir)).toBe('main')
    fs.writeFileSync(path.join(dir, 'refs', 'remotes', 'origin', 'HEAD'), 'ref: refs/remotes/origin/trunk\n')
    expect(defaultBranch(dir)).toBe('trunk')
  })
})
