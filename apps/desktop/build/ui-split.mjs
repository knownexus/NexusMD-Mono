// Which app each file of @nexusmd/ui belongs to, for the split build.
//
// @nexusmd/ui holds both what every app shares (icons, contexts, toasts) and the screens of single
// apps (the planner, the calendar, the database manager...). Web and mobile import it whole, so the
// files stay where they are; the split build works out who uses what instead:
//   - a file only ONE app reaches (through the names it imports from '@nexusmd/ui', and from there
//     through relative imports) is that app's: it is built into that app's folder;
//   - any other file reached is shared: the shell exposes it once, as part of '@nexusmd/ui';
//   - a file nothing in the desktop app reaches is in neither.
// So an app that is not installed leaves none of its screens behind.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(here, '..', '..', '..')
const SHELL = 'shell'
const SOURCE = /\.(jsx?|cjs|mjs)$/
const TEST = /\.(test|spec)\./

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

function resolveRelative(from, specifier) {
  const base = resolve(dirname(from), specifier)
  for (const candidate of [base, `${base}.js`, `${base}.jsx`, join(base, 'index.js')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

// Every module specifier a source file imports or re-exports (a dynamic import counts too).
export function specifiersOf(source) {
  const found = []
  for (const m of source.matchAll(/(?:\bimport|\bexport)\s*(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(m[1] || m[2])
  return found
}

// The names the barrel exports, each with the file it comes from.
export function barrelNames(uiSrc) {
  const barrel = join(uiSrc, 'index.js')
  const names = new Map()
  for (const m of readFileSync(barrel, 'utf8').matchAll(/export\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    const file = resolveRelative(barrel, m[2])
    for (const entry of m[1].split(',').map(s => s.trim()).filter(Boolean)) names.set(entry.split(/\s+as\s+/).pop(), file)
  }
  return names
}

// The names a folder's code imports from '@nexusmd/ui'. Anything else we cannot follow (a namespace
// import, a default import) is an error: it would let a file be shared by accident.
export function uiImportsOf(dir) {
  const names = new Set()
  for (const file of walk(dir).filter(f => SOURCE.test(f) && !TEST.test(f))) {
    const source = readFileSync(file, 'utf8')
    for (const m of source.matchAll(/\bimport\s*([^'";]*?)\s*from\s*'@nexusmd\/ui'/g)) {
      const clause = m[1].trim()
      const braces = clause.match(/^\{([\s\S]*)\}$/)
      if (!braces) throw new Error(`${file}: "import ${clause} from '@nexusmd/ui'" cannot be split by app; use named imports.`)
      for (const entry of braces[1].split(',').map(s => s.trim()).filter(Boolean)) names.add(entry.split(/\s+as\s+/)[0])
    }
    if (/\bexport\s*(\*|\{[^}]*\})\s*from\s*'@nexusmd\/ui'/.test(source)) throw new Error(`${file}: re-exporting '@nexusmd/ui' cannot be split by app.`)
  }
  return names
}

function reachFrom(files, uiSrc) {
  const seen = new Set()
  const queue = [...files]
  while (queue.length) {
    const file = queue.pop()
    if (!file || seen.has(file)) continue
    seen.add(file)
    for (const spec of specifiersOf(readFileSync(file, 'utf8'))) {
      if (!spec.startsWith('.')) continue
      const next = resolveRelative(file, spec)
      if (next && next.startsWith(uiSrc + sep) && SOURCE.test(next) && !TEST.test(next)) queue.push(next)
    }
  }
  return seen
}

// owners: Map(absolute ui file -> app id | 'shell-shared'); apps: the ids that own at least one file.
// A file reached by exactly one app and by nothing else is that app's.
export function analyzeUi(root = repoRoot, extraConsumers = {}) {
  const uiSrc = join(root, 'packages', 'ui', 'src')
  const names = barrelNames(uiSrc)
  const consumers = { ...extraConsumers }
  const modulesDir = join(root, 'modules')
  for (const id of readdirSync(modulesDir)) {
    if (existsSync(join(modulesDir, id, 'app.manifest.json'))) consumers[id] = join(modulesDir, id, 'src')
  }
  consumers[SHELL] = join(root, 'apps', 'desktop', 'src')
  consumers['editor-kit'] = join(root, 'packages', 'editor-kit', 'src')

  const reached = {}
  for (const [id, dir] of Object.entries(consumers)) {
    const wanted = uiImportsOf(dir)
    const unknown = [...wanted].filter(n => !names.has(n))
    if (unknown.length) throw new Error(`${id} imports ${unknown.join(', ')} from '@nexusmd/ui', which does not export ${unknown.length > 1 ? 'them' : 'it'}.`)
    reached[id] = reachFrom([...wanted].map(n => names.get(n)), uiSrc)
  }

  const appIds = Object.keys(consumers).filter(id => existsSync(join(modulesDir, id, 'app.manifest.json')))
  const owners = new Map()
  const everything = new Set(Object.values(reached).flatMap(s => [...s]))
  for (const file of everything) {
    const who = Object.keys(reached).filter(id => reached[id].has(file))
    owners.set(file, who.length === 1 && appIds.includes(who[0]) ? who[0] : 'shared')
  }
  return { uiSrc, names, owners, appIds }
}

export const sharedFiles = analysis => [...analysis.owners].filter(([, owner]) => owner === 'shared').map(([file]) => file).sort()
export const ownedFiles = (analysis, id) => [...analysis.owners].filter(([, owner]) => owner === id).map(([file]) => file).sort()

// The names an app imports that live in its own files: those it builds in, the rest come from the shell.
export function ownedNames(analysis, id) {
  return [...analysis.names].filter(([, file]) => analysis.owners.get(file) === id).map(([name, file]) => ({ name, file }))
}

// Every name a file exports, so two shared files exporting the same one (which `export *` would drop
// silently) can be caught.
export function exportedNames(source) {
  const names = new Set()
  for (const m of source.matchAll(/\bexport\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  for (const m of source.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const entry of m[1].split(',').map(s => s.trim()).filter(Boolean)) names.add(entry.split(/\s+as\s+/).pop())
  }
  return names
}

export function exportCollisions(files) {
  const seen = new Map()
  const clashes = []
  for (const file of files) {
    for (const name of exportedNames(readFileSync(file, 'utf8'))) {
      if (name === 'default') continue
      if (seen.has(name)) clashes.push(`${name} (${seen.get(name)} and ${file})`)
      else seen.set(name, file)
    }
  }
  return clashes
}

// '@nexusmd/ui' as the shell exposes it: every shared file, and no app's screens.
export function sharedUiEntrySource(analysis) {
  const files = sharedFiles(analysis)
  const clashes = exportCollisions(files)
  if (clashes.length) throw new Error(`Shared @nexusmd/ui files export the same name twice: ${clashes.join('; ')}`)
  return files.map(file => `export * from ${JSON.stringify(file.split(sep).join('/'))}`).join('\n') + '\n'
}

// '@nexusmd/ui' as one app's build sees it: its own screens straight from their files, everything else
// from the shell's copy (which the page's import map supplies).
export function appUiBarrelSource(analysis, id) {
  const lines = ["export * from '@nexusmd/ui'"]
  for (const { name, file } of ownedNames(analysis, id)) lines.push(`export { ${name} } from ${JSON.stringify(file.split(sep).join('/'))}`)
  return lines.join('\n') + '\n'
}

export const relativeToUi = (analysis, file) => relative(analysis.uiSrc, file).split(sep).join('/')
