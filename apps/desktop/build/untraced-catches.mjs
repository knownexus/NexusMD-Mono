// Finds the places code handles an error and carries on without leaving a trace in the log: a `catch` whose block neither logs
// nor rethrows the error, and a `.catch(handler)` that does the same. Handling an error is allowed; handling it *silently* is
// what makes a problem impossible to find afterwards (a sign-in screen that says "Cannot reach the server" and nothing else).
//
// Traced means one of:
//   - the block calls a logger (log.warn(...), modLog.error(...), ctx.log.info(...), log.scope('x').warn(...), logger.warn(...)),
//     ignore(...) or reportRenderError(...)  (the sanctioned way to ignore an error on purpose: it logs what was ignored)
//   - the block throws something that mentions the error (`throw e`, `throw new X('..', { cause: e })`): it goes on to be logged
//   - a `.catch(handler)` whose handler is a name or a member (handleError, reject: it is that function's to handle), or
//     ignored(...), or an inline function that is traced by the rules above
// A logger call or a throw inside a function the block merely declares does not count: that function may never run.
//
// Used by the logging guard test, which keeps the count per file from growing. Errors that do not throw (a 4xx answer, a retry that
// quietly worked) are not found here: windows log failed and refused requests themselves (@nexusmd/core's installFetchLogging).
//
//   node apps/desktop/build/untraced-catches.mjs      lists them, per file

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readMainSources, readRendererSources } from './silent-catches.mjs'

const require = createRequire(import.meta.url)
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

const LOG_CALLEE = /(?:^|\.)\w*[lL]og\w*(?:\.scope\([^)]*\))*\.(?:error|warn|info|debug)$/
const SANCTIONED = new Set(['ignore', 'ignored', 'reportRenderError'])
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod'])

const mentions = (node, name) => {
  if (!node || !name) return false
  let hit = false
  const walk = (n) => {
    if (hit || !n || typeof n.type !== 'string') return
    if (n.type === 'Identifier' && n.name === name) { hit = true; return }
    for (const key of Object.keys(n)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue
      const v = n[key]
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v.type === 'string') walk(v)
    }
  }
  walk(node)
  return hit
}

/** Does this block (not counting functions it only declares) log, ignore on purpose, or rethrow the error? */
function blockIsTraced(path, src, param) {
  let traced = false
  path.traverse({
    Function(inner) { inner.skip() },
    CallExpression(call) {
      const c = call.node.callee
      if (c.type === 'Identifier' && SANCTIONED.has(c.name)) { traced = true; call.stop(); return }
      if (c.type === 'MemberExpression' && LOG_CALLEE.test(src.slice(c.start, c.end))) { traced = true; call.stop() }
    },
    ThrowStatement(t) {
      if (mentions(t.node.argument, param)) { traced = true; t.stop() }
    },
  })
  return traced
}

/** @returns {{ line: number, snippet: string }[]} */
export function findUntracedCatches(src) {
  let ast
  try {
    ast = parser.parse(src, { sourceType: 'unambiguous', plugins: ['jsx'], allowReturnOutsideFunction: true, errorRecovery: false })
  } catch (err) {
    throw new Error(`the source could not be read, so its handled errors cannot be checked: ${err.message}`)
  }
  const lines = src.split(/\r?\n/)
  const hits = []
  const add = (line) => hits.push({ line, snippet: (lines[line - 1] ?? '').trim().slice(0, 120) })

  traverse(ast, {
    CatchClause(path) {
      const param = path.node.param && path.node.param.type === 'Identifier' ? path.node.param.name : null
      if (!blockIsTraced(path.get('body'), src, param)) add(path.node.loc.start.line)
    },
    CallExpression(path) {
      const c = path.node.callee
      if (c.type !== 'MemberExpression' || c.computed || c.property.name !== 'catch' || path.node.arguments.length === 0) return
      const handler = path.node.arguments[0]
      if (handler.type === 'Identifier' || handler.type === 'MemberExpression') return // handed to a function that handles it
      if (handler.type === 'CallExpression') {
        const h = handler.callee
        if (h.type === 'Identifier' && SANCTIONED.has(h.name)) return // ignored(log, 'why')
        add(c.property.loc.start.line)
        return
      }
      if (handler.type === 'ArrowFunctionExpression' || handler.type === 'FunctionExpression') {
        const param = handler.params[0]?.type === 'Identifier' ? handler.params[0].name : null
        const handlerPath = path.get('arguments.0')
        // An arrow with an expression body is the expression itself: `err => log.warn(..)` or `() => null`.
        if (handler.body.type !== 'BlockStatement') {
          const b = handler.body
          const traced = (b.type === 'CallExpression' && ((b.callee.type === 'Identifier' && SANCTIONED.has(b.callee.name))
            || (b.callee.type === 'MemberExpression' && LOG_CALLEE.test(src.slice(b.callee.start, b.callee.end)))))
          if (!traced) add(c.property.loc.start.line)
          return
        }
        if (!blockIsTraced(handlerPath.get('body'), src, param)) add(c.property.loc.start.line)
        return
      }
      add(c.property.loc.start.line)
    },
  })
  return hits.sort((a, b) => a.line - b.line)
}

/** { 'path/file.js': [{ line, snippet }] } for every main-process and window source file with an untraced handled error. */
export function scanUntracedCatches(sources = [...readMainSources(), ...readRendererSources()]) {
  const out = {}
  for (const { file, text } of sources) {
    const hits = findUntracedCatches(text)
    if (hits.length) out[file] = hits
  }
  return out
}

/** { 'path/file.js': count }, the form the baseline is kept in. */
export function untracedCatchCounts(sources) {
  return Object.fromEntries(Object.entries(scanUntracedCatches(sources)).map(([f, h]) => [f, h.length]).sort(([a], [b]) => a.localeCompare(b)))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--baseline')) {
    // node apps/desktop/build/untraced-catches.mjs --baseline > apps/desktop/electron/untraced-catches.baseline.json
    console.log(JSON.stringify(untracedCatchCounts(), null, 2))
  } else {
    let n = 0
    const result = scanUntracedCatches()
    for (const [file, hits] of Object.entries(result)) for (const h of hits) { n++; console.log(`${file}:${h.line}  ${h.snippet}`) }
    console.log(`\n${n} handled errors with no trace in ${Object.keys(result).length} files`)
  }
}
