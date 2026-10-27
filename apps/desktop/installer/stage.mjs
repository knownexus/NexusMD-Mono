// Stages what goes inside app.asar for the Windows build: the main process and its icons, with a
// package.json that lists only what the main process itself needs. Packaging straight from
// apps/desktop would pull in every app's package (and mssql, CodeMirror, ...) through its
// dependencies, so an app the user did not tick would still be on the disk.
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const desktop = resolve(here, '..')
const repo = resolve(desktop, '..', '..')
export const stageDir = join(repo, 'dist', 'desktop', 'stage')

// What electron/*.cjs requires from node_modules (not counting the apps, which are loaded from their folders).
const MAIN_DEPENDENCIES = ['electron-log', 'electron-updater', '@nexusmd/main-kit']

export function stagedPackageJson(pkg) {
  const dependencies = {}
  for (const name of MAIN_DEPENDENCIES) {
    if (!(name in pkg.dependencies)) throw new Error(`apps/desktop does not depend on ${name}`)
    dependencies[name] = pkg.dependencies[name]
  }
  return {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    author: pkg.author,
    license: pkg.license,
    main: pkg.main,
    dependencies,
  }
}

// The folder of an installed package, found the way Node would from the folder that needs it.
function findPackage(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
    if (dirname(dir) === dir) throw new Error(`Cannot find "${name}" from ${from}`)
  }
}

// The packages the main process needs and everything they need in turn: name -> folder.
export function productionClosure(roots, from = desktop) {
  const found = new Map()
  const visit = (name, fromDir) => {
    if (found.has(name)) return
    let dir
    try { dir = findPackage(name, fromDir) } catch (err) { if (found.optional?.has(name)) return; throw err }
    found.set(name, dir)
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    for (const dep of Object.keys(pkg.dependencies || {})) visit(dep, dir)
    for (const dep of Object.keys(pkg.optionalDependencies || {})) { try { visit(dep, dir) } catch { /* optional */ } }
  }
  for (const root of roots) visit(root, from)
  return found
}

export function stage() {
  const pkg = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'))
  rmSync(stageDir, { recursive: true, force: true })
  mkdirSync(stageDir, { recursive: true })
  cpSync(join(desktop, 'electron'), join(stageDir, 'electron'), { recursive: true, filter: src => !/\.test\.(js|cjs)$/.test(src) })
  cpSync(join(desktop, 'assets'), join(stageDir, 'assets'), { recursive: true })
  for (const [name, dir] of productionClosure(MAIN_DEPENDENCIES)) {
    cpSync(dir, join(stageDir, 'node_modules', name), { recursive: true })
  }
  writeFileSync(join(stageDir, 'package.json'), JSON.stringify(stagedPackageJson(pkg), null, 2))
  return stageDir
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(`Staged ${stage()}`)
