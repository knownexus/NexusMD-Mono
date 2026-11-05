// Finds the places main-process code swallows an error without a trace: a `catch` whose block holds
// nothing (or only comments), and a `.catch(() => {})` handler. (`.catch(() => null)` is not one: it
// turns the failure into a value the code then acts on, like stat() finding no file.)
// Used by the logging guard test, which keeps the list from growing. A swallow that is deliberate
// goes through ignore() (@nexusmd/main-kit/logging), which logs it, so it is not found here.
//
//   node apps/desktop/build/silent-catches.mjs      lists them

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
export const repoRoot = join(here, '..', '..', '..')

// Main-process code: the shell, every app's src/main, and the shared main-process kit.
export const SCAN_ROOTS = ['apps/desktop/electron', 'packages/main-kit/src']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'assets', 'renderer', 'e2e'])

// (A `//` comment runs to the end of its line, so it cannot be cut short and have a `/*` inside it start a block comment.)
const COMMENTS = String.raw`(?:\s|//[^\n]*(?![^\n])|/\*[\s\S]*?\*/)*`
const EMPTY_CATCH = new RegExp(String.raw`\bcatch\s*(?:\([^)]*\))?\s*\{${COMMENTS}\}`, 'g')
const EMPTY_PROMISE_CATCH = new RegExp(
  String.raw`\.catch\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)?\s*=>\s*\{${COMMENTS}\}\s*\)`,
  'g',
)

// emitter.on('error', () => {}): an error event nobody reports (a write to a process that has exited)
const EMPTY_ERROR_LISTENER = new RegExp(
  String.raw`\.on\??\.?\(\s*['"]error['"]\s*,\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)?\s*=>\s*\{${COMMENTS}\}\s*\)`,
  'g',
)

function* sourceFiles(dir, { skip = SKIP_DIRS, ext = /\.(cjs|js|mjs)$/ } = {}) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!skip.has(entry.name)) yield* sourceFiles(full, { skip, ext })
    } else if (ext.test(entry.name) && !/\.test\.[cm]?jsx?$/.test(entry.name)) {
      yield full
    }
  }
}

/** Every swallowed error in `text`, as { line, snippet }. */
export function findSilentCatches(text) {
  const found = []
  for (const re of [EMPTY_CATCH, EMPTY_PROMISE_CATCH, EMPTY_ERROR_LISTENER]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text))) {
      found.push({ line: text.slice(0, m.index).split('\n').length, snippet: m[0].replace(/\s+/g, ' ').slice(0, 90) })
    }
  }
  return found.sort((a, b) => a.line - b.line)
}

/** The module roots to scan: SCAN_ROOTS plus modules/<id>/src/main for each app. */
export function scanRoots(root = repoRoot) {
  const roots = SCAN_ROOTS.map(r => join(root, r))
  for (const m of readdirSync(join(root, 'modules'), { withFileTypes: true })) {
    if (m.isDirectory()) roots.push(join(root, 'modules', m.name, 'src', 'main'))
  }
  return roots
}

/** { 'path/to/file.cjs': [{ line, snippet }] } for every file with a swallowed error. */
export function scanSilentCatches(root = repoRoot) {
  const result = {}
  for (const dir of scanRoots(root)) {
    let files
    try { files = [...sourceFiles(dir)] } catch { continue } // an app with no main-process code
    for (const file of files) {
      const hits = findSilentCatches(readFileSync(file, 'utf8'))
      if (hits.length) result[relative(root, file).split(sep).join('/')] = hits
    }
  }
  return result
}


/** Every main-process source file as { file, text } (file relative to the repo, with forward slashes). */
export function readMainSources(root = repoRoot) {
  const out = []
  for (const dir of scanRoots(root)) {
    let files
    try { files = [...sourceFiles(dir)] } catch { continue } // an app with no main-process code
    for (const file of files) out.push({ file: relative(root, file).split(sep).join('/'), text: readFileSync(file, 'utf8') })
  }
  return out
}

// Code that runs in a window: the shell's renderer, every app's src/renderer, and the shared packages
// they load. (apps/web is the browser build, where the console is the right place to log.)
export const RENDERER_ROOTS = [
  'apps/desktop/src', 'packages/core/src', 'packages/ui/src', 'packages/shell-sdk/src', 'packages/web-adapters/src', 'packages/editor-kit/src',
]
const RENDERER_SKIP_DIRS = new Set(['node_modules', 'dist', 'assets', 'e2e'])

/** The roots to scan for renderer code: RENDERER_ROOTS plus modules/<id>/src/renderer for each app. */
export function rendererRoots(root = repoRoot) {
  const roots = RENDERER_ROOTS.map(r => join(root, r))
  for (const m of readdirSync(join(root, 'modules'), { withFileTypes: true })) {
    if (m.isDirectory()) roots.push(join(root, 'modules', m.name, 'src', 'renderer'))
  }
  return roots
}

/** Every renderer source file as { file, text } (file relative to the repo, with forward slashes). */
export function readRendererSources(root = repoRoot) {
  const out = []
  for (const dir of rendererRoots(root)) {
    let files
    try { files = [...sourceFiles(dir, { skip: RENDERER_SKIP_DIRS, ext: /\.(js|jsx|mjs)$/ })] } catch { continue } // an app with no renderer code
    for (const file of files) out.push({ file: relative(root, file).split(sep).join('/'), text: readFileSync(file, 'utf8') })
  }
  return out
}

// Swallowed errors in window code that are deliberate and cannot go through ignore(): each with its reason.
// (A swallow that can, goes through ignore() from @nexusmd/core, which logs it, so it is not found here.)
export const RENDERER_SILENT_EXCEPTIONS = [
  { file: 'packages/core/src/log.js', why: 'the logger cannot log its own failure, so it must never throw into the caller' },
  { file: 'packages/core/src/modules/account/account-sync.js', line: 'chain = run.catch', why: 'only keeps the serial chain alive; the error still reaches the caller through `run`' },
  { file: 'packages/core/src/modules/devenv/protocol.js', why: 'a malformed control line is shown as output, so nothing is lost' },
]
// `line`, when given, is text the source line holding the swallow must contain.
const rendererExcepted = (file, lineText) => RENDERER_SILENT_EXCEPTIONS.some(r => r.file === file && (!r.line || lineText.includes(r.line)))

/** { 'path/file.js': [{ line, snippet }] } for every window-code file with a swallowed error that is not an exception. */
export function scanRendererSilentCatches(root = repoRoot) {
  const out = {}
  for (const { file, text } of readRendererSources(root)) {
    const lines = text.split(/\r?\n/)
    const hits = findSilentCatches(text).filter(h => !rendererExcepted(file, lines[h.line - 1] ?? ''))
    if (hits.length) out[file] = hits
  }
  return out
}

/** { 'path/file.js': count }, the form the baseline is kept in. */
export function rendererSilentCatchCounts(root = repoRoot) {
  return Object.fromEntries(Object.entries(scanRendererSilentCatches(root)).map(([f, h]) => [f, h.length]).sort(([a], [b]) => a.localeCompare(b)))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--renderer-baseline')) {
    // node apps/desktop/build/silent-catches.mjs --renderer-baseline > apps/desktop/electron/renderer-silent-catches.baseline.json
    console.log(JSON.stringify(rendererSilentCatchCounts(), null, 2))
  } else {
    const renderer = process.argv.includes('--renderer')
    const result = renderer ? scanRendererSilentCatches() : scanSilentCatches()
    let n = 0
    for (const [file, hits] of Object.entries(result)) for (const h of hits) { n++; console.log(`${file}:${h.line}  ${h.snippet}`) }
    console.log(`
${n} silent catches in ${Object.keys(result).length} files (${renderer ? 'window code' : 'main process'})`)
  }
}
