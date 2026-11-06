// instrument.mjs — adds a start and an end report to every function in our own code, so a recording can show what ran,
// with what, and what came back (see runtime.js for what the reports call).
//
//   instrument(code, { filename, root })  ->  { code, map } | null
//
// A traced function becomes
//
//   function f(a) {
//     const __f = __nxt.on ? __nxt.enter("rel/path.js:12:0:f", this, arguments) : null;
//     try { …the body, with `return e` as `return __nxt.ret(__f, e)`, `await e` as
//           `__nxt.resume(__f, await __nxt.aw(__f, e))`, and a `ret` when it falls off the end… }
//     catch (__e) { __nxt.err(__f, __e); throw __e }
//   }
//
// so what it returns, throws and resolves is exactly what it did before. Not traced: other people's code
// (node_modules), tests, functions with JSX and hooks (they run on every render and would bury what the person is
// looking for), getters, setters, constructors, array-iteration callbacks, and anything in exclude.json.
// `for await` and `yield*` are not rewritten: a function that uses them still reports, but work between iterations is
// attributed to whichever frame is running then.
import babel from '@babel/core'
import { readFileSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const { transformSync, types: t, template } = babel

const MARK = Symbol('nxt')
const ITERATION = new Set(['map', 'filter', 'reduce', 'reduceRight', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flatMap', 'forEach', 'sort'])
const DEFAULT_EXCLUDE = JSON.parse(readFileSync(fileURLToPath(new URL('./exclude.json', import.meta.url)), 'utf8'))

const preamble = template.statement.ast(`
  var __nxt = globalThis.__nxt || (globalThis.__nxt = {
    on: false, enter() { return null }, ret(f, v) { return v }, err() {}, aw(f, v) { return v }, resume(f, v) { return v },
  });
`)

const nxt = (method, ...args) => t.callExpression(t.memberExpression(t.identifier('__nxt'), t.identifier(method)), args)
const F = () => t.identifier('__f')

function skipFile(rel, exclude) {
  if (/(^|\/)node_modules\//.test(rel) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) || /\.d\.ts$/.test(rel)) return true
  const files = [...(DEFAULT_EXCLUDE.files ?? []), ...(exclude.files ?? [])]
  return files.some(f => rel === f || (f.endsWith('/') && rel.startsWith(f)))
}

// The name the function goes by, for the report and for exclusion.
function nameOf(path) {
  const n = path.node
  const keyName = (k) => (t.isIdentifier(k) ? k.name : t.isStringLiteral(k) ? k.value : '')
  if (n.id?.name) return n.id.name
  if ((t.isObjectMethod(n) || t.isClassMethod(n) || t.isClassPrivateMethod(n)) && n.key) return t.isPrivateName(n.key) ? n.key.id.name : keyName(n.key)
  const p = path.parent
  if (t.isVariableDeclarator(p) && t.isIdentifier(p.id)) return p.id.name
  if (t.isAssignmentExpression(p)) return t.isIdentifier(p.left) ? p.left.name : t.isMemberExpression(p.left) ? keyName(p.left.property) : ''
  if (t.isObjectProperty(p) || t.isClassProperty(p)) return keyName(p.key)
  if (t.isExportDefaultDeclaration(p)) return 'default'
  return ''
}

function containsJsx(path) {
  let found = false
  path.traverse({
    JSXElement(p) { found = true; p.stop() },
    JSXFragment(p) { found = true; p.stop() },
    Function(p) { p.skip() }, // a handler inside a component is judged on its own
  })
  return found
}

function isIterationCallback(path) {
  const p = path.parent
  return (path.isArrowFunctionExpression() || path.isFunctionExpression()) && t.isCallExpression(p) && p.arguments.includes(path.node)
    && t.isMemberExpression(p.callee) && t.isIdentifier(p.callee.property) && ITERATION.has(p.callee.property.name)
}

const alreadyTraced = (body) => t.isBlockStatement(body) && t.isVariableDeclaration(body.body[0]) && t.isIdentifier(body.body[0].declarations[0]?.id, { name: '__f' })

// The arguments to report. A function has `arguments`; an arrow does not, so its own parameter list is used (a
// destructured parameter cannot be named, so it is reported as a marker).
function argumentsOf(node) {
  if (!t.isArrowFunctionExpression(node)) return t.identifier('arguments')
  const destructured = () => t.objectExpression([t.objectProperty(t.identifier('$cut'), t.stringLiteral('destructured'))])
  return t.arrayExpression(node.params.map((p) => {
    if (t.isIdentifier(p)) return t.identifier(p.name)
    if (t.isAssignmentPattern(p) && t.isIdentifier(p.left)) return t.identifier(p.left.name)
    if (t.isRestElement(p) && t.isIdentifier(p.argument)) return t.spreadElement(t.identifier(p.argument.name))
    return destructured()
  }))
}

/**
 * @param {string} code
 * @param {{ filename: string, root?: string, sourceType?: 'module'|'script'|'unambiguous',
 *           exclude?: { files?: string[], functions?: string[] } }} opts
 * @returns {{ code: string, map: object } | null}  null: nothing to trace, excluded, or it could not be parsed
 */
export function instrument(code, { filename, root = process.cwd(), sourceType = 'unambiguous', exclude = {} } = {}) {
  const rel = relative(root, filename).split(sep).join('/')
  if (skipFile(rel, exclude)) return null
  const skipNames = new Set([...(DEFAULT_EXCLUDE.functions ?? []), ...(exclude.functions ?? [])])
  let traced = 0

  const plugin = () => ({
    visitor: {
      Function(path) {
        const node = path.node
        if (node[MARK] || !node.loc) return
        // The stub this file declares for itself (see `preamble`) is not ours to trace, in this pass or the next.
        if (path.findParent((p) => p.isVariableDeclarator() && t.isIdentifier(p.node.id, { name: '__nxt' }))) return
        if (['get', 'set', 'constructor'].includes(node.kind)) return
        if (t.isBlockStatement(node.body) && node.body.body.length === 0) return
        if (alreadyTraced(node.body)) return
        const name = nameOf(path)
        if (/^use[A-Z]/.test(name) || skipNames.has(name)) return
        if (containsJsx(path) || isIterationCallback(path)) return

        node[MARK] = true
        const arrow = t.isArrowFunctionExpression(node)
        if (!t.isBlockStatement(node.body)) path.get('body').replaceWith(t.blockStatement([t.returnStatement(node.body)]))

        // Returns, awaits and yields of this function (not of the functions inside it).
        path.get('body').traverse({
          Function(p) { p.skip() },
          ReturnStatement(p) {
            if (p.node[MARK]) return
            p.node[MARK] = true
            p.node.argument = nxt('ret', F(), p.node.argument ?? t.identifier('undefined'))
          },
          AwaitExpression(p) {
            if (p.node[MARK]) return
            const inner = t.awaitExpression(nxt('aw', F(), p.node.argument))
            inner[MARK] = true
            p.replaceWith(nxt('resume', F(), inner))
          },
          YieldExpression(p) {
            if (p.node[MARK] || p.node.delegate) return
            const inner = t.yieldExpression(nxt('aw', F(), p.node.argument ?? t.identifier('undefined')))
            inner[MARK] = true
            p.replaceWith(nxt('resume', F(), inner))
          },
        })

        const id = `${rel}:${node.loc.start.line}:${node.loc.start.column}:${name || 'anonymous'}`
        const enter = t.variableDeclaration('const', [t.variableDeclarator(F(), t.conditionalExpression(
          t.memberExpression(t.identifier('__nxt'), t.identifier('on')),
          nxt('enter', t.stringLiteral(id), arrow ? t.unaryExpression('void', t.numericLiteral(0)) : t.thisExpression(), argumentsOf(node)),
          t.nullLiteral(),
        ))])
        const body = node.body
        const tryBlock = t.blockStatement([...body.body, t.expressionStatement(nxt('ret', F()))])
        const handler = t.catchClause(t.identifier('__e'), t.blockStatement([
          t.expressionStatement(nxt('err', F(), t.identifier('__e'))),
          t.throwStatement(t.identifier('__e')),
        ]))
        node.body = t.blockStatement([enter, t.tryStatement(tryBlock, handler)], body.directives)
        traced++
      },
      Program: { exit(path) { if (traced) path.unshiftContainer('body', t.cloneNode(preamble)) } },
    },
  })

  try {
    const out = transformSync(code, {
      filename, babelrc: false, configFile: false, sourceType, sourceMaps: true, retainLines: true, compact: false,
      parserOpts: { plugins: ['jsx'] }, plugins: [plugin],
    })
    return traced && out?.code ? { code: out.code, map: out.map } : null
  } catch {
    return null // a file Babel cannot read is left as it is; the build reports it in its own way
  }
}
