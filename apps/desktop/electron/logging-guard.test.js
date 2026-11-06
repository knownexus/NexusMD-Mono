// @vitest-environment node
// The rules that keep "no error without a clear log" true as the code changes. They read the main-process
// source (the shell, every app's src/main, the shared main-process kit) and fail on:
//   1. a swallowed error: an empty catch block or .catch(() => {}); use ignore() from
//      @nexusmd/main-kit/logging, which logs what was ignored and why
//   2. registering IPC on electron's own ipcMain instead of the logged one the shell hands out
//   3. console.* calls, which bypass the per-module logs; use ctx.log or moduleLogger()
// Every exception is listed here with the reason, and a stale exception fails too.

import { describe, it, expect } from 'vitest'
import { readMainSources, readRendererSources, findSilentCatches, rendererSilentCatchCounts, RENDERER_SILENT_EXCEPTIONS } from '../build/silent-catches.mjs'
import rendererSilentBaseline from './renderer-silent-catches.baseline.json'
import { untracedCatchCounts, findUntracedCatches } from '../build/untraced-catches.mjs'
import untracedBaseline from './untraced-catches.baseline.json'

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

// Code that runs in a window (apps/desktop/src, each app's src/renderer, the shared packages). Its logs
// reach the hub through rendererLog() in @nexusmd/core, so console calls are listed here with the reason.
const rendererSources = readRendererSources()
const CONSOLE_ALLOWED_RENDERER = [
  { file: 'packages/ui/src/views/regex-tester-helpers.js', why: 'sample code shown to the user, inside a string' },
]

// console.<level>( at the start of a statement or after an operator, not in a comment or a string.
function findConsoleCalls(text) {
  const hits = []
  text.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
    if (/(^|[^\w$.'"`])(?:window\.|globalThis\.)?console\.(log|info|warn|error|debug)\s*\(/.test(line)) hits.push({ line: i + 1, snippet: line.trim().slice(0, 90) })
  })
  return hits
}

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

  it('logs from windows through rendererLog, not console', () => {
    const violations = []
    for (const { file, text } of rendererSources) {
      const allowed = CONSOLE_ALLOWED_RENDERER.filter(r => matches(r, file))
      findConsoleCalls(text).forEach(hit => {
        if (!allowed.some(r => !r.snippet || hit.snippet.includes(r.snippet))) violations.push(`${file}:${hit.line}  ${hit.snippet}`)
      })
    }
    expect(violations, `Use rendererLog('<module>', '<scope>') from @nexusmd/core; it reaches the log hub under that module:\n${violations.join('\n')}`).toEqual([])
  })

  it('has no stale exceptions for renderer console calls', () => {
    for (const rule of CONSOLE_ALLOWED_RENDERER) {
      const used = rendererSources.some(({ file, text }) => matches(rule, file) && findConsoleCalls(text).some(h => !rule.snippet || h.snippet.includes(rule.snippet)))
      expect(used, `exception no longer needed: ${rule.file} (${rule.why})`).toBe(true)
    }
  })

  // Window code still has swallowed errors from before this guard (a baseline per file). They are worked down by
  // converting them to ignore(log, why, err) from @nexusmd/core, which logs what was ignored. The baseline only
  // goes down: a new one fails here, and so does converting one without lowering the baseline, so it stays honest.
  it('adds no swallowed error to window code (the baseline only goes down)', () => {
    const counts = rendererSilentCatchCounts()
    const grew = [], shrank = []
    for (const file of new Set([...Object.keys(counts), ...Object.keys(rendererSilentBaseline)])) {
      const now = counts[file] ?? 0, was = rendererSilentBaseline[file] ?? 0
      if (now > was) grew.push(`${file}: ${now} (baseline ${was})`)
      else if (now < was) shrank.push(`${file}: ${now} (baseline ${was})`)
    }
    expect(grew, `A swallowed error is new here. Use ignore(log, 'why', err) from @nexusmd/core instead of an empty catch or .catch(() => {}):\n${grew.join('\n')}`).toEqual([])
    expect(shrank, `Fewer than the baseline, good. Lower it: node apps/desktop/build/silent-catches.mjs --renderer-baseline > apps/desktop/electron/renderer-silent-catches.baseline.json\n${shrank.join('\n')}`).toEqual([])
  })

  // The wider rule behind "no error goes unlogged": handling an error is fine, handling it SILENTLY is not. A catch that
  // returns a fallback, shows a message, or throws a different error without the cause leaves nothing to find afterwards
  // (the sign-in screen that said "Cannot reach the server" and nothing else). Code from before this rule is a baseline per
  // file, worked down by logging through ignore(log, why, err) or the logger; the baseline only goes down. A new
  // handled error must log (log.warn(...), ignore(...)) or rethrow the error (throw e / { cause: e }).
  it('adds no handled error that leaves no trace (the baseline only goes down)', () => {
    const counts = untracedCatchCounts([...sources, ...rendererSources])
    const grew = [], shrank = []
    for (const file of new Set([...Object.keys(counts), ...Object.keys(untracedBaseline)])) {
      const now = counts[file] ?? 0, was = untracedBaseline[file] ?? 0
      if (now > was) grew.push(`${file}: ${now} (baseline ${was})`)
      else if (now < was) shrank.push(`${file}: ${now} (baseline ${was})`)
    }
    const list = (rows) => rows.join('\n')
    expect(grew, `A handled error here leaves no trace in the log. Log it (log.warn('what failed', err), or ignore(log, 'why it is fine', err) if it is expected), or rethrow it with its cause. See apps/desktop/build/untraced-catches.mjs for what counts. List: node apps/desktop/build/untraced-catches.mjs\n${list(grew)}`).toEqual([])
    expect(shrank, `Fewer than the baseline, good. Lower it: node apps/desktop/build/untraced-catches.mjs --baseline > apps/desktop/electron/untraced-catches.baseline.json\n${list(shrank)}`).toEqual([])
  })

  it('finds the handled errors it is meant to', () => {
    expect(findUntracedCatches('try { a() } catch { b = 1 }')).toHaveLength(1)
    expect(findUntracedCatches("try { a() } catch (e) { log.warn('x', e) }")).toHaveLength(0)
  })

  it('has no stale exceptions for swallowed errors in window code', () => {
    for (const rule of RENDERER_SILENT_EXCEPTIONS) {
      const src = rendererSources.find(s => s.file === rule.file)
      const lines = src?.text.split(/\r?\n/) ?? []
      const used = !!src && findSilentCatches(src.text).some(h => !rule.line || (lines[h.line - 1] ?? '').includes(rule.line))
      expect(used, `exception no longer needed: ${rule.file} (${rule.why})`).toBe(true)
    }
  })

  it('finds the console calls it is meant to', () => {
    const text = [
      "console.error('x')",
      '  console.warn(`y`, err)',
      "// console.log('commented out')",
      " * console.info('in a doc comment')",
      "const s = 'console.log is just text'",
      "log.error('fine')",
      "window.console.debug('z')",
    ].join('\n')
    expect(findConsoleCalls(text).map(h => h.line)).toEqual([1, 2, 7])
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

  it('does not take a catch that does something for an empty one, even when its comment mentions a block comment', () => {
    const text = [
      'try { a() } catch (e) {',
      '  // not routed through /api/triage/*; see the file comment',
      '  setError(e.message)',
      '}',
      'const x = 1 /* closes here */',
    ].join('\n')
    expect(findSilentCatches(text)).toEqual([])
  })
})
