// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { main } = require('./git-editor.cjs')
const HELPER = path.join(__dirname, 'git-editor.cjs')

let dir, gitDir, planFile
const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const write = (rel, text) => { const f = path.join(gitDir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f }

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd editor '))
  gitDir = path.join(dir, '.git')
  planFile = path.join(dir, 'plan.json')
  fs.writeFileSync(planFile, JSON.stringify({ todo: `pick ${B}\nreword ${A}\n`, messages: { [A]: 'Renamed' } }))
})
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('git-editor helper', () => {
  it('sequence mode writes the planned todo', () => {
    const todo = write('rebase-merge/git-rebase-todo', 'pick x\n')
    expect(main(['sequence', todo], { NEXUSMD_REBASE_PLAN: planFile })).toBe(0)
    expect(fs.readFileSync(todo, 'utf8')).toBe(`pick ${B}\nreword ${A}\n`)
  })
  it('message mode writes the message for the commit being edited', () => {
    write('rebase-merge/done', `pick ${B}\nreword ${A} old subject\n`)
    const msg = write('COMMIT_EDITMSG', 'old subject\n')
    expect(main(['message', msg], { NEXUSMD_REBASE_PLAN: planFile })).toBe(0)
    expect(fs.readFileSync(msg, 'utf8')).toBe('Renamed\n')
  })
  it('leaves git\'s message alone without a planned message or outside a rebase', () => {
    write('rebase-merge/done', `pick ${B}\n`)
    const msg = write('COMMIT_EDITMSG', 'keep me\n')
    expect(main(['message', msg], { NEXUSMD_REBASE_PLAN: planFile })).toBe(0)
    expect(fs.readFileSync(msg, 'utf8')).toBe('keep me\n')
    fs.rmSync(path.join(gitDir, 'rebase-merge'), { recursive: true })
    expect(main(['message', msg], { NEXUSMD_REBASE_PLAN: planFile })).toBe(0)
    expect(fs.readFileSync(msg, 'utf8')).toBe('keep me\n')
  })
  it('refuses an unknown mode', () => {
    expect(main(['other', 'x'], { NEXUSMD_REBASE_PLAN: planFile })).toBe(2)
  })
  it('as a child process: works from a path with spaces, and fails loudly without a plan', () => {
    const todo = write('rebase-merge/git-rebase-todo', 'pick x\n')
    const ok = spawnSync(process.execPath, [HELPER, 'sequence', todo], { env: { ...process.env, NEXUSMD_REBASE_PLAN: planFile } })
    expect(ok.status).toBe(0)
    expect(fs.readFileSync(todo, 'utf8')).toContain(`reword ${A}`)
    const bad = spawnSync(process.execPath, [HELPER, 'sequence', todo], { env: { ...process.env, NEXUSMD_REBASE_PLAN: path.join(dir, 'missing.json') } })
    expect(bad.status).toBe(1)
    expect(bad.stderr.toString()).toMatch(/^nexusmd editor: /)
  })
})
