// @vitest-environment node
// The rules that keep "no error without a clear log" true as the code changes. They read the main-process
// source (the shell, every app's src/main, the shared main-process kit) and fail on:
//   1. a swallowed error: an empty catch block or .catch(() => {}); use ignore() from
//      @nexusmd/main-kit/logging, which logs what was ignored and why
//   2. registering IPC on electron's own ipcMain instead of the logged one the shell hands out
//   3. console.* calls, which bypass the per-module logs; use ctx.log or moduleLogger()
// Every exception is listed here with the reason, and a stale exception fails too.

import { describe, it, expect } from 'vitest'
import { readMainSources, findSilentCatches } from '../build/silent-catches.mjs'

const sources = readMainSources()

// file: a path, or a RegExp over the path; snippet: only the hit containing it (default: any)
const SILENT_CATCH_ALLOWED = [
  { file: /^packages\/main-kit\/src\/logging\//, why: 'the logger cannot log its own failure, so it must never throw into the caller' },
  { file: 'modules/api-client/src/main/bruno-prelude.sandbox.js', why: 'runs inside the script sandbox, which has no logger; the result carries the error' },
  { file: 'modules/git/src/main/git-shell.cjs', snippet: 'catch { }', why: 'PowerShell text inside a JS string, not JavaScript' },
]

// Files that may take ipcMain from electron directly.
const RAW_IPCMAIN_ALLOWED = [
  { file: 'apps/desktop/electron/main.cjs', why: 'wraps it: this is where the logged ipcMain is made' },
  { file: 'apps/desktop/electron/tray.cjs', why: 'only calls ipcMain.emit to trigger an existing handler; registers nothing' },
]

// Files that may call console.* directly.
const CONSOLE_ALLOWED = [
  { file: 'apps/desktop/electron/main.cjs', why: 'patches console to go through the logger' },
  { file: /^packages\/main-kit\/src\/logging\//, why: 'the logger itself, where the console is the last resort' },
  { file: 'modules/api-client/src/main/bruno-prelude.sandbox.js', why: 'runs inside the script sandbox, where console is the script\'s own' },
]

const matches = (rule, file) => (rule.file instanceof RegExp ? rule.file.test(file) : rule.file === file)

describe('logging guard', () => {
  it('finds main-process sources to check', () => {
    const files = sources.map(s => s.file)
    expect(files).toContain('apps/desktop/electron/main.cjs')
    expect(files).toContain('modules/git/src/main/git.cjs')
    expect(files).toContain('packages/main-kit/src/safe-file.cjs')
  })

  it('swallows no error without logging it', () => {
    const violations = []
    for (const { file, text } of sources) {
      for (const hit of findSilentCatches(text)) {
        const allowed = SILENT_CATCH_ALLOWED.some(r => matches(r, file) && (!r.snippet || hit.snippet.includes(r.snippet)))
        if (!allowed) violations.push(`${file}:${hit.line}  ${hit.snippet}`)
      }
    }
    expect(violations, `Use ignore(log, 'why', err) from @nexusmd/main-kit/logging instead:\n${violations.join('\n')}`).toEqual([])
  })

  it('has no stale exceptions for swallowed errors', () => {
    for (const rule of SILENT_CATCH_ALLOWED) {
      const used = sources.some(({ file, text }) => matches(rule, file) && findSilentCatches(text).some(h => !rule.snippet || h.snippet.includes(rule.snippet)))
      expect(used, `exception no longer needed: ${rule.file} (${rule.why})`).toBe(true)
    }
  })

  it('registers IPC only through the logged ipcMain', () => {
    const takesRaw = /\{[^}]*\bipcMain\b[^}]*\}\s*=\s*require\(\s*['"]electron['"]\s*\)/
    const violations = sources
      .filter(({ file, text }) => takesRaw.test(text) && !RAW_IPCMAIN_ALLOWED.some(r => matches(r, file)))
      .map(s => s.file)
    expect(violations, 'Take ipcMain as a parameter (the shell passes the logged one) or use ctx.ipcMain').toEqual([])
  })

  it('has no stale exceptions for the raw ipcMain', () => {
    const takesRaw = /\{[^}]*\bipcMain\b[^}]*\}\s*=\s*require\(\s*['"]electron['"]\s*\)/
    for (const rule of RAW_IPCMAIN_ALLOWED) {
      expect(sources.some(s => matches(rule, s.file) && takesRaw.test(s.text)), `exception no longer needed: ${rule.file}`).toBe(true)
    }
  })

  it('logs through the logger, not console', () => {
    const calls = /\bconsole\.(log|info|warn|error|debug)\s*\(/
    const violations = []
    for (const { file, text } of sources) {
      if (CONSOLE_ALLOWED.some(r => matches(r, file))) continue
      text.split('\n').forEach((line, i) => { if (calls.test(line) && !/^\s*(\/\/|\*)/.test(line)) violations.push(`${file}:${i + 1}  ${line.trim().slice(0, 90)}`) })
    }
    expect(violations, `Use ctx.log or moduleLogger() from @nexusmd/main-kit/logging:\n${violations.join('\n')}`).toEqual([])
  })

  it('finds the patterns it is meant to', () => {
    const text = [
      'try { a() } catch { /* x */ }',
      'try { a() } catch (e) {}',
      'p.catch(() => {})',
      'p.catch(e => { /* nothing */ })',
      'p.catch(() => null)',
      "try { a() } catch (err) { ignore(log, 'why', err) }",
      'try { a() } catch (err) { log.warn(err) }',
      "child.stdin.on('error', () => {});",
      "child.stdin.on?.('error', () => { /* ignore */ });",
      "child.stdin.on('error', ignored(log, 'why'));",
      "child.on('error', e => log.error(e));",
    ].join('\n')
    expect(findSilentCatches(text).map(h => h.line)).toEqual([1, 2, 3, 4, 8, 9])
  })
})
