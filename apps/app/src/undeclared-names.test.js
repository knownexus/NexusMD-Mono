// Guards against the white screen: a component or helper used in a source file without being
// imported, declared, or put on `window` by another module throws a ReferenceError on first render
// and React unmounts the whole app. Builds do not catch it (bundlers leave unknown names alone),
// so this reads every source file and fails on a name nothing defines.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'

const traverse = _traverse.default ?? _traverse
const SRC = path.resolve(import.meta.dirname)

// Globals the browser, the WebView and the language provide.
const PLATFORM = new Set(`window document console localStorage sessionStorage navigator location history screen
  fetch setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame queueMicrotask
  requestIdleCallback Promise Set Map WeakMap WeakSet Array Object String Number Boolean Date Math JSON RegExp Error
  TypeError RangeError Symbol BigInt Reflect Proxy Intl Function parseInt parseFloat isNaN isFinite NaN Infinity
  undefined globalThis arguments encodeURIComponent decodeURIComponent encodeURI decodeURI URL URLSearchParams Blob File
  FileReader FormData Headers Request Response AbortController AbortSignal Event CustomEvent KeyboardEvent MouseEvent
  Node Element HTMLElement HTMLInputElement Image Audio Notification MutationObserver ResizeObserver
  IntersectionObserver DOMParser XMLSerializer getComputedStyle getSelection matchMedia btoa atob crypto indexedDB
  alert confirm prompt structuredClone TextEncoder TextDecoder Uint8Array ArrayBuffer performance Worker CSS Option
  innerWidth innerHeight scrollTo open process Buffer`.split(/\s+/))

const files = []
;(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p)
    else if (/\.(jsx?|mjs)$/.test(name) && !/\.test\./.test(name)) files.push(p)
  }
})(SRC)

const parseFile = file => parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx'] })

// Names some module puts on `window` (Object.assign(window, { ... }) or window.X = ...), which other
// files may then use as bare globals.
function windowAssigned(ast) {
  const names = new Set()
  traverse(ast, {
    CallExpression(p) {
      const { callee, arguments: args } = p.node
      const isAssign = callee.type === 'MemberExpression' && callee.object.name === 'Object' && callee.property.name === 'assign'
      if (isAssign && args[0]?.type === 'Identifier' && args[0].name === 'window' && args[1]?.type === 'ObjectExpression') {
        for (const prop of args[1].properties) if (prop.key?.name) names.add(prop.key.name)
      }
    },
    AssignmentExpression(p) {
      let left = p.node.left
      // `export const X = window.X = ...` chains
      if (left.type === 'MemberExpression' && left.object.name === 'window' && left.property.name) names.add(left.property.name)
    },
  })
  return names
}

describe('every name the app uses is defined somewhere', () => {
  const asts = new Map(files.map(f => [f, parseFile(f)]))
  const onWindow = new Set([...asts.values()].flatMap(ast => [...windowAssigned(ast)]))

  it('scans the app sources', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('finds the names modules put on window', () => {
    expect(onWindow.has('usePersisted')).toBe(true)
    expect(onWindow.has('HelmApi')).toBe(true)
  })

  it('has no name that is used but never imported, declared or put on window', () => {
    const missing = []
    for (const [file, ast] of asts) {
      traverse(ast, {
        Program(p) {
          for (const [name, ref] of Object.entries(p.scope.globals)) {
            if (!PLATFORM.has(name) && !onWindow.has(name)) {
              missing.push(`${path.relative(SRC, file)}:${ref.loc?.start.line} ${name}`)
            }
          }
        },
      })
    }
    expect(missing).toEqual([])
  })
})
