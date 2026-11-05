// trace-main.mjs — adds the call reports (packages/trace) to the main-process code that is shipped.
//
//   traceMainTree(stageDir)              the staged shell and main-kit, rewritten in place (installer/stage.mjs)
//   traceMainTree(stageDir, outDir)      the same, written to another folder (the source folder is not touched)
//   traceMainPlugin()                    the same for the main bundle of one app (build-split.mjs, a rolldown plugin)
//
// Which files are traced is main-rules.cjs: each path is first mapped back to where the file lives in the repository,
// so a report's id names the real source file whether the code is run from source or from an installed copy.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { instrument } from '@nexusmd/trace/instrument'

const require = createRequire(import.meta.url)
const { shouldTraceMain, sourcePathOf } = require('@nexusmd/trace/main-rules')
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const norm = (p) => p.replace(/\\/g, '/')

function* walk(dir, base = dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p, base)
    else yield { abs: p, rel: norm(p.slice(base.length + 1)) }
  }
}

/** @returns {{ files: number, traced: number }}  code files looked at, and how many were changed */
export function traceMainTree(srcDir, outDir = srcDir) {
  let files = 0
  let traced = 0
  const off = process.env.NEXUSMD_TRACE === '0' // a build made to measure what the reports cost
  for (const { abs, rel } of walk(srcDir)) {
    const to = join(outDir, rel)
    const isCode = /\.c?js$/.test(rel)
    if (isCode) files++
    const source = isCode ? sourcePathOf(rel) : null
    if (!off && source && shouldTraceMain(source)) {
      const out = instrument(readFileSync(abs, 'utf8'), { filename: join(REPO, source), root: REPO, sourceType: 'script' })
      if (out) {
        mkdirSync(dirname(to), { recursive: true })
        writeFileSync(to, out.code)
        traced++
        continue
      }
    }
    if (outDir !== srcDir) { mkdirSync(dirname(to), { recursive: true }); cpSync(abs, to) }
  }
  return { files, traced }
}

/** A rolldown (or Rollup) plugin for an app's main-process bundle. */
export function traceMainPlugin({ root = REPO } = {}) {
  const base = norm(root).replace(/\/$/, '') + '/'
  return {
    name: 'nexusmd-trace-main',
    transform(code, id) {
      const file = norm(id.split('?')[0])
      if (process.env.NEXUSMD_TRACE === '0' || !file.startsWith(base)) return null
      if (!shouldTraceMain(file.slice(base.length))) return null
      const out = instrument(code, { filename: file, root, sourceType: 'unambiguous' })
      return out ? { code: out.code, map: out.map } : null
    },
  }
}
