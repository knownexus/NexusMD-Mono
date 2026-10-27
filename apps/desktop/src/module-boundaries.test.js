import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Each folder under modules/ is an app that can be installed on its own, so it
// must never reach into another app. It may only use the shared packages below
// (plus its own files and third-party dependencies).
const MODULES_DIR = path.resolve(__dirname, '../../../modules')
const SHARED = [
  '@nexusmd/shell-sdk',
  '@nexusmd/ui',
  '@nexusmd/core',
  '@nexusmd/editor-kit',
  '@nexusmd/main-kit',
  '@nexusmd/web-adapters',
]
const SOURCE = /\.(js|jsx|mjs|cjs)$/
const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (SOURCE.test(e.name)) out.push(p)
  }
  return out
}

function moduleIds() {
  if (!fs.existsSync(MODULES_DIR)) return []
  return fs.readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name !== 'node_modules')
    .map(e => e.name)
}

// Pure check so it can be tested against fixtures as well as the real tree.
export function findViolations(moduleId, file, source, modulesDir = MODULES_DIR) {
  const own = path.join(modulesDir, moduleId)
  const bad = []
  for (const m of source.matchAll(IMPORT)) {
    const spec = m[1] || m[2] || m[3] || m[4]
    if (!spec) continue
    if (spec.startsWith('.')) {
      const target = path.resolve(path.dirname(file), spec)
      if (target !== own && !target.startsWith(own + path.sep)) {
        bad.push(`${spec} leaves modules/${moduleId}`)
      }
    } else if (spec.startsWith('@nexusmd/')) {
      if (!SHARED.some(s => spec === s || spec.startsWith(s + '/'))) {
        bad.push(`${spec} is not a shared package`)
      }
    }
  }
  return bad
}

describe('module boundaries', () => {
  it('flags relative imports that leave the module', () => {
    const own = path.join(MODULES_DIR, 'git')
    const file = path.join(own, 'src', 'a.js')
    expect(findViolations('git', file, `import x from '../../editor/src/b.js'`)).toHaveLength(1)
    expect(findViolations('git', file, `import x from './b.js'`)).toHaveLength(0)
  })
  it('flags other modules\' packages but allows shared ones', () => {
    const file = path.join(MODULES_DIR, 'git', 'src', 'a.js')
    expect(findViolations('git', file, `import x from '@nexusmd/app-editor'`)).toHaveLength(1)
    expect(findViolations('git', file, `import x from '@nexusmd/ui'`)).toHaveLength(0)
    expect(findViolations('git', file, `const y = require('@nexusmd/core/x')`)).toHaveLength(0)
  })

  for (const id of moduleIds()) {
    it(`modules/${id} imports only shared packages and itself`, () => {
      const violations = []
      for (const file of walk(path.join(MODULES_DIR, id))) {
        for (const v of findViolations(id, file, fs.readFileSync(file, 'utf8'))) {
          violations.push(`${path.relative(MODULES_DIR, file)}: ${v}`)
        }
      }
      expect(violations).toEqual([])
    })

    it(`modules/${id}/package.json depends on no other module`, () => {
      const pkgPath = path.join(MODULES_DIR, id, 'package.json')
      if (!fs.existsSync(pkgPath)) return
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.devDependencies })
      expect(deps.filter(d => d.startsWith('@nexusmd/app-'))).toEqual([])
    })
  }
})
