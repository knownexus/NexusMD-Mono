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

const COMMENTS = String.raw`(?:\s|//[^\n]*|/\*[\s\S]*?\*/)*`
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

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* sourceFiles(full)
    } else if (/\.(cjs|js|mjs)$/.test(entry.name) && !/\.test\.[cm]?js$/.test(entry.name)) {
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = scanSilentCatches()
  let n = 0
  for (const [file, hits] of Object.entries(result)) for (const h of hits) { n++; console.log(`${file}:${h.line}  ${h.snippet}`) }
  console.log(`\n${n} silent catches in ${Object.keys(result).length} files`)
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
